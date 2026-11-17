# btc-fade-bot

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/auracreation/btc-fade-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/auracreation/btc-fade-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A fade-the-drop mean-reversion bot that trades Coinbase Wrapped BTC (cbBTC) on 1-minute Orca Whirlpool bars with $1,000 of paper money, built for make.fun's "Race a BTC trading bot live for 24 hours" bounty.

## Strategy

The bot fades large drops and gives the recovery time to develop. It uses only completed bars already delivered by the replay:

- **Entry**: the 60-bar return is below -1.10%, the 15-bar return is above -0.40%, and the 120-bar return is above -4%. A qualifying signal uses available cash within the weight cap.
- **Exit**: sell at a mark 1.80% above cost, 1% below cost, or after 480 minutes. A 60-bar recovery above 1% can close the position only after 180 minutes from its actual buy fill.
- **Circuit breaker**: at a 2% equity decline from the observed peak, liquidate and stop. Orders execute at the next open, so gaps and trading costs can push the realized drawdown beyond 2%.
- **Participation**: if no buy has filled by batch 1200, allocate only 1% of available cash. This gives an idle day a chance to meet the race's minimum trade rule without relaxing the full-size signal. No new entry is opened after batch 1420.

The simulator charges 4 bps per fill, 2 bps slippage and the recorded pool's size-dependent impact. A mark-based target or stop does not guarantee that execution price or net return.

The bot is fully deterministic: no clock, no network, no randomness, no files outside the repo.

## Results (dev window, local grade)

- **Net PnL: +41.247443 USDC**, 3 round trips, 6 trades, maximum drawdown 0.7237081%, 0 rejected orders; two official-kit executions have identical action logs.
- At doubled simulator fees: +38.757626 USDC. The preserved baseline commit `1b45924a79f66252df5db32380d09c92ca86b27c` made +24.246507 USDC on the same data.
- Development results were used during research and are not an independent forecast. On four final holdout days of Binance BTC/USDT, mean simulated PnL was -15.702410 USDC per day, versus -18.394703 for the baseline; maximum drawdown was 2.4582%, versus 4.4704%. OKX prices on the same four days gave a similar candidate result. These are exchange-price proxies with assumed pool depth, not official cbBTC results or eight independent days. Parameters were frozen before the holdout was evaluated.
- The live race and official server evaluation decide the result. No real trading orders are placed.

## Run it

```sh
node main.ts
```

Run the regression tests with `node --test strategy.test.ts`.

The bot speaks `agent-fun/bars-replay/v1`: newline-delimited JSON on stdin/stdout, one reply per batch. It runs under Node 22 with the standard library only; `vendor/makefun-bars.ts` is a byte-identical copy of the kit's SDK shim.

---

<sub>Entered on [make.fun](https://make.fun/?ref=z1j4n66g&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
