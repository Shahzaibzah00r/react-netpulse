import { useCallback, useEffect, useRef, useState } from "react";
import { probe } from "./probe";
import { getRetryDelay } from "./backoff";
import { OfflineQueue } from "./queue";
import type {
  ConnectionQuality,
  NetworkStatusOptions,
  NetworkStatusResult,
} from "./types";

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_PROBE_URL = "https://www.gstatic.com/generate_204";
const DEFAULT_PROBE_INTERVAL = 10_000; // 10 s
const DEFAULT_PROBE_TIMEOUT = 5_000; //  5 s
const DEFAULT_MAX_RETRIES = Infinity;
const DEFAULT_BACKOFF = "exponential" as const;
const NOOP = () => {};

// ── Network Information API ───────────────────────────────────────────────────

function getConnectionQuality(): ConnectionQuality {
  if (typeof navigator === "undefined") return null;
  // Network Information API — Chrome/Edge only (2026), gracefully absent elsewhere
  const nav = navigator as Navigator & {
    connection?: { type?: string; effectiveType?: string };
    mozConnection?: { type?: string; effectiveType?: string };
    webkitConnection?: { type?: string; effectiveType?: string };
  };
  const conn = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
  if (conn == null) return null;
  if (conn.type === "wifi") return "wifi";
  const eff = conn.effectiveType;
  if (eff === "2g" || eff === "3g" || eff === "4g") return eff;
  return "unknown";
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Tracks real internet connectivity by periodically sending a lightweight
 * HEAD probe to a configurable URL.
 *
 * Unlike `navigator.onLine`, this accurately detects captive portals, broken
 * routers, and LANs with no upstream internet access.
 *
 * @example
 * ```tsx
 * const { isOnline, retry, queue } = useNetworkStatus({
 *   backoff:   'exponential',
 *   onOffline: () => toast.error('Connection lost'),
 *   onOnline:  () => toast.success('Back online!'),
 * });
 * ```
 */
export function useNetworkStatus(
  options: NetworkStatusOptions = {},
): NetworkStatusResult {
  // Stable options ref — re-assigned after every render so the probe function
  // always reads the latest values without needing to be recreated.
  const optsRef = useRef(options);
  useEffect(() => {
    optsRef.current = options;
  });

  // ── State (only what causes visible UI changes) ───────────────────────────
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [isChecking, setIsChecking] = useState(false);
  const [quality, setQuality] =
    useState<ConnectionQuality>(getConnectionQuality);
  const [retryCount, setRetryCount] = useState(0);
  const [lastOnlineAt, setLastOnlineAt] = useState<Date | null>(null);
  const [lastOfflineAt, setLastOfflineAt] = useState<Date | null>(null);
  const [queueSize, setQueueSize] = useState(0);

  // ── Refs (mutable values that must not trigger re-renders) ────────────────
  const isOnlineRef = useRef(isOnline); // mirror of isOnline for callback use
  const retryCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const queueRef = useRef(new OfflineQueue());
  const runProbeRef = useRef<() => Promise<void>>(async () => {});

  // scheduleProbe — stable reference; reading runProbeRef.current at call time
  // guarantees the latest probe function is always used.
  const scheduleProbe = useCallback((delayMs: number) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runProbeRef.current(), delayMs);
  }, []);

  // ── Mount effect ──────────────────────────────────────────────────────────
  // Runs once on mount (scheduleProbe is stable → [scheduleProbe] = run once).
  // Reads from refs inside the probe runner so it is never stale.
  useEffect(() => {
    if (typeof window === "undefined") return; // SSR guard

    // Define the probe runner. Stored in a ref so scheduleProbe can call it
    // after a timer fires, even if React has re-rendered in between.
    runProbeRef.current = async () => {
      const {
        probeUrl = DEFAULT_PROBE_URL,
        probeTimeout = DEFAULT_PROBE_TIMEOUT,
        probeInterval = DEFAULT_PROBE_INTERVAL,
        backoff = DEFAULT_BACKOFF,
        maxRetries = DEFAULT_MAX_RETRIES,
        onOnline = NOOP,
        onOffline = NOOP,
      } = optsRef.current;

      // Cancel any in-flight probe and start a fresh one.
      abortCtrlRef.current?.abort();
      abortCtrlRef.current = new AbortController();

      setIsChecking(true);
      const wasOnline = isOnlineRef.current;
      const result = await probe(
        probeUrl,
        probeTimeout,
        abortCtrlRef.current.signal,
      );

      // Component unmounted mid-probe — bail to avoid state updates on a dead tree.
      if (abortCtrlRef.current.signal.aborted) return;

      setIsChecking(false);
      setQuality(getConnectionQuality());

      if (result !== wasOnline) {
        // ── Connectivity state changed ──────────────────────────────────────
        isOnlineRef.current = result;
        setIsOnline(result);

        if (result) {
          setLastOnlineAt(new Date());
          retryCountRef.current = 0;
          setRetryCount(0);
          onOnline();
          await queueRef.current.drain();
          setQueueSize(0);
          scheduleProbe(probeInterval);
        } else {
          setLastOfflineAt(new Date());
          onOffline();
          retryCountRef.current = 1;
          setRetryCount(1);
          scheduleProbe(getRetryDelay(backoff, probeInterval, 0));
        }
        return;
      }

      if (!result) {
        // ── Still offline — continue backoff retries ────────────────────────
        if (retryCountRef.current < maxRetries) {
          const delay = getRetryDelay(
            backoff,
            probeInterval,
            retryCountRef.current,
          );
          retryCountRef.current += 1;
          setRetryCount(retryCountRef.current);
          scheduleProbe(delay);
        }
        // maxRetries reached → stop retrying (user can still call retry() manually)
        return;
      }

      // ── Still online — schedule next routine health check ─────────────────
      scheduleProbe(probeInterval);
    };

    // Kick off first probe immediately on mount.
    runProbeRef.current();

    // Browser online/offline events fire instantly (no probe needed for offline).
    const handleOnline = () => runProbeRef.current();

    const handleOffline = () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      isOnlineRef.current = false;
      setIsOnline(false);
      setLastOfflineAt(new Date());
      const {
        onOffline = NOOP,
        backoff = DEFAULT_BACKOFF,
        probeInterval = DEFAULT_PROBE_INTERVAL,
      } = optsRef.current;
      onOffline();
      retryCountRef.current = 1;
      setRetryCount(1);
      scheduleProbe(getRetryDelay(backoff, probeInterval, 0));
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      abortCtrlRef.current?.abort(); // cancel any in-flight probe
    };
  }, [scheduleProbe]);

  // ── Public API ────────────────────────────────────────────────────────────

  const retry = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    runProbeRef.current();
  }, []);

  const queue = useCallback((fn: () => void | Promise<void>) => {
    if (isOnlineRef.current) {
      fn();
    } else {
      queueRef.current.enqueue(fn);
      setQueueSize(queueRef.current.size);
    }
  }, []);

  return {
    isOnline,
    isChecking,
    quality,
    retryCount,
    lastOnlineAt,
    lastOfflineAt,
    retry,
    queue,
    queueSize,
  };
}
