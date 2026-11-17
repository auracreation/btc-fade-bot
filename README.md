# btc-fade-bot

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/auracreation/btc-fade-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/auracreation/btc-fade-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A fade-the-drop mean-reversion bot that trades Coinbase Wrapped BTC (cbBTC) on 1-minute Orca Whirlpool bars with $1,000 of paper money, built for make.fun's "Race a BTC trading bot live for 24 hours" bounty.

## Strategy

On the frozen dev window (1,440 bars, +0.49% drift, 2.5% range), 1-minute returns show momentum at 15-60 minute horizons but clear mean reversion at the 2-4 hour scale. Sharp one-hour drops of 1% or more are usually faded back within an hour or two, while chasing every small move loses to the ~26 bps round-trip cost (4 bps fee + 2 bps slippage + price impact). So the bot trades rarely and only on large signals:

- **Entry** (flat): the 60-bar return is below -1.00% and the drop has stopped accelerating (15-bar return above -0.50%). Buys with all cash.
- **Exit** (long): the position is worth 2% over its cost, or 2% under it (stop), or the 60-bar return has flipped above +1.00% (the drop was recovered). Sells the whole position.
- **Circuit breaker**: if equity falls 5% below its peak, sells and stops trading for the rest of the window.
- **Escalation**: if no buy has filled by batch 1000 the entry threshold relaxes to -0.60%, and by batch 1200 to -0.40%, so the bot still makes at least one trade on a quiet or steadily rising day.

The bot is fully deterministic: no clock, no network, no randomness, no files outside the repo.

## Results (dev window, local grade)

- **Net PnL: +$24.25** over 3 round trips, 6 trades, win rate 1.00, max drawdown 0.72%, 0 rejected orders
- Buy-and-hold on the same window: +$1.07; the kit's momentum baseline: +$2.45

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1`: newline-delimited JSON on stdin/stdout, one reply per batch. It runs under Node 22 with the standard library only; `vendor/makefun-bars.ts` is a byte-identical copy of the kit's SDK shim.

---

<sub>Entered on [make.fun](https://make.fun/?ref=z1j4n66g&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
