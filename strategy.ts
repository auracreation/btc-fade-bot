import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const DROP_BPS = 110;
const DECEL_BPS = -40;
const TARGET_BPS = 180n;
const STOP_BPS = 100n;
const BREAKER_BPS = 200n;
const RECOVERY_WAIT_BARS = 180;
const MAX_HOLD_BARS = 480;
const MAX_SLIPPAGE_BPS = 150;

export function createStrategy(): (state: BarsState, batch: Batch) => OrderInput[] {
  const closes: number[] = [];
  let filledBuys = 0;
  let entrySeq = -1;
  let peakEquity = 0n;
  let stopped = false;

  return (state, batch) => {
    for (const fill of batch.fills) {
      if (fill.status === 'filled' && fill.side === 'buy') {
        filledBuys += 1;
        entrySeq = batch.seq;
      }
    }
    if (state.equity > peakEquity) peakEquity = state.equity;
    if (state.equity * 10_000n <= peakEquity * (10_000n - BREAKER_BPS)) stopped = true;

    const fresh = batch.bars.find(bar => bar.symbol === SYMBOL);
    if (fresh !== undefined) {
      closes.push(Number(fresh.c));
      if (closes.length > 121) closes.shift();
    }
    if (state.warmingUp || state.close(SYMBOL) === null) return [];

    const held = state.positions.get(SYMBOL);
    const sell = (maxSlippage = MAX_SLIPPAGE_BPS): OrderInput[] => held === undefined ? [] : [{
      side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: maxSlippage,
    }];
    // Risk liquidation must remain executable after a gap; the entry price cap is unsuitable.
    if (stopped) return sell(10_000);

    const returnBps = (bars: number): number => {
      if (closes.length <= bars) return 0;
      const now = closes[closes.length - 1];
      const then = closes[closes.length - 1 - bars];
      return ((now - then) / then) * 10_000;
    };

    if (held !== undefined) {
      const value = state.value(SYMBOL, held.qty);
      const age = batch.seq - entrySeq;
      if (value * 10_000n <= held.cost * (10_000n - STOP_BPS)) return sell(10_000);
      if (entrySeq >= 0 && age >= MAX_HOLD_BARS) return sell(10_000);
      if (fresh === undefined) return [];
      if (value * 10_000n >= held.cost * (10_000n + TARGET_BPS)) return sell();
      // A fast bounce can continue; give it time before accepting the recovery exit.
      if (entrySeq >= 0 && age >= RECOVERY_WAIT_BARS && returnBps(60) > 100) return sell();
      return [];
    }

    const scoredSeq = batch.seq - state.warmupBars;
    if (fresh === undefined || closes.length <= 120 || scoredSeq > 1420) return [];
    const signal = returnBps(60) < -DROP_BPS && returnBps(15) > DECEL_BPS && returnBps(120) > -400;
    // The race requires a filled trade; an idle day gets only a 1% late allocation.
    const participation = filledBuys === 0 && scoredSeq >= 1200;
    if (!signal && !participation) return [];

    const room = state.weightRoom(SYMBOL);
    const available = state.cash < room ? state.cash : room;
    const spend = signal ? available : available / 100n;
    if (spend < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  };
}
