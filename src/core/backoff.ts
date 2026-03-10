import type { BackoffStrategy } from "./types";

/** Caps exponential and linear backoff at 60 seconds to keep retries sensible. */
const MAX_DELAY_MS = 60_000;

/**
 * Returns the milliseconds to wait before the next retry probe.
 *
 * | Strategy      | Formula                                    | Example (base = 10 s)       |
 * |---------------|--------------------------------------------|-----------------------------|
 * | `fixed`       | `base`                                     | 10 s, 10 s, 10 s …          |
 * | `linear`      | `base × (n + 1)`                           | 10 s, 20 s, 30 s …          |
 * | `exponential` | `min(base × 2ⁿ, 60 s)`                    | 10 s, 20 s, 40 s, 60 s …   |
 *
 * @param strategy   - Which backoff curve to apply.
 * @param baseMs     - The base interval in milliseconds (`probeInterval`).
 * @param retryIndex - Zero-based retry index (0 = first retry after going offline).
 */
export function getRetryDelay(
  strategy: BackoffStrategy,
  baseMs: number,
  retryIndex: number,
): number {
  switch (strategy) {
    case "linear":
      return Math.min(baseMs * (retryIndex + 1), MAX_DELAY_MS);
    case "exponential":
      return Math.min(baseMs * Math.pow(2, retryIndex), MAX_DELAY_MS);
    case "fixed":
    default:
      return baseMs;
  }
}
