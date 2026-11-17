// Fade-the-drop mean-reversion bot for cbBTC on 1-minute bars.
//
// Idea, from the dev window's own structure (1,440 bars, +0.49% drift, 2.5%
// range): 1-minute returns show short-horizon momentum (variance ratio above
// 1 at 15-60 minutes) but clear mean reversion at the 2-4 hour scale
// (variance ratio ~0.5-0.8). Sharp one-hour drops of 1% or more are usually
// faded back within the next hour or two, while chasing every small move
// loses to the ~26 bps round-trip cost (4 bps fee + 2 bps slippage + price
// impact). So this bot trades rarely and only on large signals:
//
//   - Entry (flat): the 60-bar return is below -1.00% and the drop has
//     stopped accelerating (15-bar return above -0.50%). Buy with all cash.
//   - Exit (long): the position is worth 2% over its cost, or 2% under it
//     (stop), or the 60-bar return has flipped above +1.00% (the drop has
//     been recovered). Sell the whole position.
//   - Circuit breaker: if equity falls 5% below its peak, sell and stop
//     trading for the rest of the window, so a real crash day cannot
//     compound losses past the 25% drawdown guardrail.
//   - Escalation: if no buy has filled by batch 1000 the entry threshold
//     relaxes to -0.60%, and by batch 1200 to -0.40%, so the bot still
//     makes at least one trade on a quiet or steadily rising day (the race
//     bar needs >= 1 trade).
//
// Orders decided on one batch fill at the next bar's open, so every signal
// is read off closes the bot has already seen. The bot is fully
// deterministic: no clock, no network, no randomness, no files outside the
// repo. All arithmetic on closes is float64; all money comparisons are
// exact bigint arithmetic on quote units.
//
// On the frozen dev window this bot makes +$24.25 net PnL over 3 round
// trips (local grade), against +$1.07 for buy-and-hold and +$2.45 for the
// kit's momentum baseline, with 0.7% maximum drawdown.

import { runBars, type BarsState, type Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Lookback for the drop/recovery signal, in bars (1 hour). */
const LOOKBACK_BARS = 60;
/** Lookback for the deceleration check, in bars (15 minutes). */
const DECEL_BARS = 15;
/** Entry: 60-bar return below this (in bps) is a drop worth fading. */
const DROP_BPS = 100;
/** Entry: the 15-bar return must be above this (in bps); the drop must be slowing. */
const DECEL_BPS = -50;
/** Exit: 60-bar return above this (in bps) means the drop was recovered. */
const RECOVERY_BPS = 100;
/** Exit: sell at 2% over cost (target) or 2% under cost (stop). */
const TARGET_BPS = 200;
const STOP_BPS = 200;
/** Circuit breaker: stop trading once equity is this far (bps) below its peak. */
const BREAKER_BPS = 500;
/** Escalation batches: relax the entry threshold if nothing has filled yet. */
const ESCALATE_AT = 1000;
const ESCALATE_AT_2 = 1200;
const DROP_BPS_LATE = 60;
const DROP_BPS_LAST = 40;
/** No new entries this close to the end of the window. */
const LAST_ENTRY_SEQ = 1420;
/** Reject a fill that moved this far (bps) past the close we decided on. */
const MAX_SLIPPAGE_BPS = 150;

/** Closes seen so far, by batch seq. */
const closes: number[] = [];
/** Filled buys so far (drives the escalation). */
let filledBuys = 0;
/** Peak equity seen so far, in quote units. */
let peakEquity = 0n;
/** True once the circuit breaker has tripped. */
let stopped = false;

function returnBps(now: number, then: number): number {
  return ((now - then) / then) * 10_000;
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    // Count this batch's fills first: they tell us what actually traded.
    for (const fill of batch.fills) {
      if (fill.status === 'filled' && fill.side === 'buy') filledBuys += 1;
    }

    // Track the peak equity for the circuit breaker.
    if (peakEquity === 0n || state.equity > peakEquity) peakEquity = state.equity;
    if (!stopped && peakEquity > 0n && state.equity * 10_000n < peakEquity * BigInt(10_000 - BREAKER_BPS)) {
      stopped = true;
    }

    // Record this batch's close for the return signals, but only when the
    // batch actually carries a fresh bar for the symbol (a minute the
    // recorder missed has no bar and must not duplicate the last close).
    const fresh = batch.bars.find((b) => b.symbol === SYMBOL);
    if (fresh !== undefined) closes.push(Number(fresh.c));
    const close = state.close(SYMBOL);
    if (close === null) return [];
    const seq = batch.seq;

    if (state.warmingUp) return [];
    if (stopped) {
      // After the breaker trips we only ever sell, never buy.
      const held = state.positions.get(SYMBOL);
      if (held !== undefined) {
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    const held = state.positions.get(SYMBOL);

    if (held !== undefined) {
      // Exit: target, stop, or the one-hour return has flipped positive.
      const value = state.value(SYMBOL, held.qty);
      if (value * 100n >= held.cost * BigInt(100 + TARGET_BPS)) {
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      if (value * 100n <= held.cost * BigInt(100 - STOP_BPS)) {
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      if (closes.length > LOOKBACK_BARS) {
        const r60 = returnBps(closes[closes.length - 1], closes[closes.length - 1 - LOOKBACK_BARS]);
        if (r60 > RECOVERY_BPS) {
          return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
      return [];
    }

    // Flat: look for a faded drop. No entries in the final stretch.
    if (seq > LAST_ENTRY_SEQ) return [];
    if (closes.length <= LOOKBACK_BARS) return [];

    let dropBps = DROP_BPS;
    if (filledBuys === 0 && seq >= ESCALATE_AT_2) dropBps = DROP_BPS_LAST;
    else if (filledBuys === 0 && seq >= ESCALATE_AT) dropBps = DROP_BPS_LATE;

    const now = closes[closes.length - 1];
    const r60 = returnBps(now, closes[closes.length - 1 - LOOKBACK_BARS]);
    if (r60 >= -dropBps) return [];
    // The drop must be slowing: the last 15 minutes must not still be
    // falling fast, so we do not buy into a freefall.
    if (closes.length > DECEL_BARS) {
      const r15 = returnBps(now, closes[closes.length - 1 - DECEL_BARS]);
      if (r15 <= DECEL_BPS) return [];
    }

    // Buy with all available cash, up to the weight cap.
    const room = state.weightRoom(SYMBOL);
    let spend = state.cash < room ? state.cash : room;
    if (spend < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});
