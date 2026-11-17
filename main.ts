import { runBars } from './vendor/makefun-bars.ts';
import { createStrategy } from './strategy.ts';

await runBars({ onBatch: createStrategy() });
