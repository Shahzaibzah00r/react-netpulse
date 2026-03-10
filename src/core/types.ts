// ── Connection Quality ────────────────────────────────────────────────────────

/** The perceived connection quality, sourced from the Network Information API. */
export type ConnectionQuality = "2g" | "3g" | "4g" | "wifi" | "unknown" | null;

// ── Backoff ───────────────────────────────────────────────────────────────────

/** Strategy used to space out retry probes when offline. */
export type BackoffStrategy = "fixed" | "linear" | "exponential";

// ── Queue ─────────────────────────────────────────────────────────────────────

/** An async-safe action to execute when connectivity is restored. */
export type QueuedAction = () => void | Promise<void>;

// ── Hook Options ──────────────────────────────────────────────────────────────

/** Configuration options for {@link useNetworkStatus}. All fields are optional. */
export interface NetworkStatusOptions {
  /**
   * URL to send a HEAD probe request to.
   * Defaults to Google's lightweight 204 endpoint — zero response body.
   * Point this at your own `/api/ping` for full captive-portal detection.
   * @default 'https://www.gstatic.com/generate_204'
   */
  probeUrl?: string;

  /**
   * Milliseconds between automatic probes while online.
   * @default 10_000
   */
  probeInterval?: number;

  /**
   * Milliseconds before a probe is considered timed out.
   * @default 5_000
   */
  probeTimeout?: number;

  /**
   * Maximum number of retry probes after going offline.
   * Pass `Infinity` to retry indefinitely.
   * @default Infinity
   */
  maxRetries?: number;

  /**
   * Retry spacing strategy when offline:
   * - `'fixed'`       — always `probeInterval`
   * - `'linear'`      — grows by `probeInterval` per retry
   * - `'exponential'` — doubles per retry, capped at 60 s
   * @default 'exponential'
   */
  backoff?: BackoffStrategy;

  /** Called once when connectivity is restored. */
  onOnline?: () => void;

  /** Called once when connectivity is lost. */
  onOffline?: () => void;
}

// ── Hook Result ───────────────────────────────────────────────────────────────

/** The object returned by {@link useNetworkStatus}. */
export interface NetworkStatusResult {
  /** `true` when the last HTTP probe succeeded (real internet verified). */
  isOnline: boolean;

  /** `true` while a probe request is in-flight. */
  isChecking: boolean;

  /**
   * Connection quality from the Network Information API.
   * `null` if the browser does not support the API (Firefox, Safari).
   */
  quality: ConnectionQuality;

  /** Number of consecutive failed probes since going offline. Resets to 0 when back online. */
  retryCount: number;

  /** Timestamp of the last verified online event. */
  lastOnlineAt: Date | null;

  /** Timestamp of the last detected offline event. */
  lastOfflineAt: Date | null;

  /**
   * Cancel any pending scheduled probe and run one immediately.
   * Useful for a manual "Retry" button.
   */
  retry: () => void;

  /**
   * If online, executes `fn` immediately.
   * If offline, adds `fn` to a queue that drains automatically on reconnect.
   */
  queue: (fn: QueuedAction) => void;

  /** Number of actions currently waiting in the offline queue. */
  queueSize: number;
}
