"use client"; // Next.js App Router — this component uses hooks and DOM APIs

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNetworkStatus } from "../core/useNetworkStatus";
import type { NetworkStatusOptions } from "../core/types";
import { WifiOffIcon } from "./icons/WifiOffIcon";
import { WifiOnIcon } from "./icons/WifiOnIcon";

// ── CSS injected once into <head> ─────────────────────────────────────────────
// A single <style> tag, inserted once regardless of how many <NetworkBanner>
// instances are mounted. The STYLE_ID guard prevents duplication.

const STYLE_ID = "react-netpulse-styles";
const CSS = `
@keyframes rnp-in  {
  from { transform: translate(-50%, -110%); opacity: 0; }
  to   { transform: translate(-50%,    0%); opacity: 1; }
}
@keyframes rnp-out {
  from { transform: translate(-50%,    0%); opacity: 1; }
  to   { transform: translate(-50%, -110%); opacity: 0; }
}
@keyframes rnp-shake {
  0%, 100% { transform: translateX(0);   }
  25%       { transform: translateX(-4px); }
  75%       { transform: translateX( 4px); }
}
/* Respect user's motion preference (accessibility) */
@media (prefers-reduced-motion: reduce) {
  .rnp-icon   { animation: none !important; }
  .rnp-banner { animation-duration: 0ms !important; }
}
`;

function injectStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return; // already present
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface NetworkBannerProps extends Pick<
  NetworkStatusOptions,
  | "probeUrl"
  | "probeInterval"
  | "probeTimeout"
  | "maxRetries"
  | "backoff"
  | "onOnline"
  | "onOffline"
> {
  /**
   * Milliseconds to show the "Back online" confirmation before auto-hiding.
   * @default 3000
   */
  onlineMessageDuration?: number;

  /** Override any of the three displayed strings. */
  messages?: {
    /** Shown when offline and probe is not in-flight. @default 'No Internet Connection' */
    offline?: string;
    /** Shown while a probe is in-flight. @default 'Reconnecting…' */
    reconnecting?: string;
    /** Shown briefly after reconnecting. @default '✓ Back Online' */
    online?: string;
  };

  /**
   * CSS `z-index` of the banner.
   * @default 9999
   */
  zIndex?: number;

  /**
   * Custom icon rendered when the connection is offline.
   * Replaces the default animated WiFi-off SVG.
   * Any `React.ReactNode` is accepted — an SVG, an image, a component, etc.
   *
   * @example
   * ```tsx
   * <NetworkBanner offlineIcon={<MyIcon size={20} />} />
   * ```
   */
  offlineIcon?: React.ReactNode;

  /**
   * Custom icon rendered when the connection is restored.
   * Replaces the default WiFi-on SVG.
   */
  onlineIcon?: React.ReactNode;

  /**
   * Extra inline styles merged into the banner container.
   * Your values take precedence over the defaults, so you can override
   * colour, padding, border-radius, font — anything.
   *
   * @example
   * ```tsx
   * <NetworkBanner bannerStyle={{ borderRadius: 0, fontSize: 16 }} />
   * ```
   */
  bannerStyle?: React.CSSProperties;

  /**
   * Extra inline styles merged into the Retry button.
   */
  buttonStyle?: React.CSSProperties;

  /**
   * Extra CSS class name(s) added to the banner container.
   * Useful when you prefer targeting the element from a stylesheet or
   * CSS-in-JS system rather than using `bannerStyle`.
   */
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * A zero-dependency, portal-based connectivity banner.
 *
 * Renders at the top-centre of the viewport via `createPortal(…, document.body)`.
 * Animates in when offline, shows a brief "Back Online" toast on reconnect, then
 * slides out. Respects `prefers-reduced-motion`.
 *
 * @example
 * ```tsx
 * // Drop into _app.tsx / layout.tsx — needs no props for basic use
 * <NetworkBanner />
 *
 * // With custom messages
 * <NetworkBanner
 *   messages={{ offline: 'No connection — changes saved locally' }}
 *   onlineMessageDuration={4000}
 * />
 * ```
 */
export function NetworkBanner({
  onlineMessageDuration = 3_000,
  messages = {},
  zIndex = 9_999,
  offlineIcon,
  onlineIcon,
  bannerStyle,
  buttonStyle,
  className,
  // Remaining props are forwarded to the hook
  probeUrl,
  probeInterval,
  probeTimeout,
  maxRetries,
  backoff,
  onOnline,
  onOffline,
}: NetworkBannerProps) {
  const { isOnline, isChecking, retry, retryCount } = useNetworkStatus({
    probeUrl,
    probeInterval,
    probeTimeout,
    maxRetries,
    backoff,
    onOnline,
    onOffline,
  });

  const [visible, setVisible] = useState(false);
  const [animOut, setAnimOut] = useState(false);
  const [showOnline, setShowOnline] = useState(false);

  const prevOnlineRef = useRef(isOnline);
  const isMountedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inject shared CSS once on client mount.
  useEffect(() => {
    injectStyles();
  }, []);

  // Track mounted state to guard timer callbacks after unmount.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  // Show / hide the banner in response to connectivity changes.
  // NOTE: showOnline is intentionally NOT in the dependency array — including it
  // would re-run this effect (and its cleanup) when we set showOnline=true,
  // which would clear the auto-hide timer before it fires.
  useEffect(() => {
    const wasOnline = prevOnlineRef.current;
    prevOnlineRef.current = isOnline;

    if (!isOnline) {
      // Went offline — cancel any pending hide timer and slide in.
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      setShowOnline(false);
      setAnimOut(false);
      setVisible(true);
      return;
    }

    if (isOnline && !wasOnline) {
      // Just came back online — show success toast, then auto-hide.
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      setShowOnline(true);
      setAnimOut(false);
      setVisible(true);

      timerRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        setAnimOut(true);

        timerRef.current = setTimeout(() => {
          if (!isMountedRef.current) return;
          setVisible(false);
          setShowOnline(false);
          setAnimOut(false);
        }, 380);
      }, onlineMessageDuration);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, onlineMessageDuration]);

  // SSR or not yet triggered — render nothing.
  if (typeof document === "undefined" || !visible) return null;

  const dismiss = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setAnimOut(true);
    timerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      setVisible(false);
      setShowOnline(false);
      setAnimOut(false);
    }, 380);
  };

  const {
    offline = "No Internet Connection",
    reconnecting = "Reconnecting\u2026",
    online = "\u2713 Back Online",
  } = messages;

  const isOffline = !showOnline;
  const bgColor = isOffline ? "#c62828" : "#2e7d32";

  const banner = (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={["rnp-banner", className].filter(Boolean).join(" ")}
      style={{
        // ── Defaults (can all be overridden via bannerStyle) ──────────────
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translate(-50%, 0)",
        zIndex,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px 10px 20px",
        borderRadius: 12,
        fontSize: 14,
        fontWeight: 600,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        lineHeight: 1.4,
        boxShadow: "0 6px 20px rgba(0,0,0,0.3)",
        backgroundColor: bgColor,
        color: "#fff",
        userSelect: "none",
        minWidth: 260,
        maxWidth: "90vw",
        whiteSpace: "nowrap",
        animation: animOut
          ? "rnp-out 0.38s ease forwards"
          : "rnp-in  0.38s ease forwards",
        // ── User overrides — spread last so they win ───────────────────────
        ...bannerStyle,
      }}
    >
      {/* Icon — uses custom icon if provided, falls back to built-in SVG */}
      <span
        className="rnp-icon"
        style={{
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          animation: isOffline ? "rnp-shake 0.9s ease infinite" : "none",
        }}
      >
        {isOffline
          ? (offlineIcon ?? <WifiOffIcon />)
          : (onlineIcon ?? <WifiOnIcon />)}
      </span>

      {/* Message */}
      <span style={{ flex: 1 }}>
        {isOffline ? (isChecking ? reconnecting : offline) : online}
        {isOffline && retryCount > 0 && (
          <span
            style={{
              marginLeft: 6,
              fontWeight: 400,
              fontSize: 11,
              opacity: 0.75,
            }}
          >
            (attempt #{retryCount})
          </span>
        )}
      </span>

      {/* Retry button — offline state only */}
      {isOffline && (
        <button
          onClick={retry}
          disabled={isChecking}
          aria-label="Retry connection"
          style={{
            marginLeft: 4,
            padding: "5px 14px",
            border: "none",
            borderRadius: 8,
            backgroundColor: isChecking
              ? "rgba(255,255,255,0.20)"
              : "rgba(255,255,255,0.92)",
            color: "#b71c1c",
            fontWeight: 700,
            fontSize: 12,
            fontFamily: "inherit",
            cursor: isChecking ? "not-allowed" : "pointer",
            flexShrink: 0,
            opacity: isChecking ? 0.65 : 1,
            transition: "opacity 0.15s",
            // User overrides
            ...buttonStyle,
          }}
        >
          {isChecking ? "Checking\u2026" : "Retry"}
        </button>
      )}

      {/* Close (×) button — always visible */}
      <button
        onClick={dismiss}
        aria-label="Close notification"
        style={{
          marginLeft: 6,
          padding: 0,
          width: 24,
          height: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          borderRadius: "50%",
          backgroundColor: "rgba(255,255,255,0.20)",
          color: "#fff",
          fontWeight: 700,
          fontSize: 14,
          fontFamily: "inherit",
          cursor: "pointer",
          flexShrink: 0,
          lineHeight: 1,
          transition: "background-color 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            "rgba(255,255,255,0.35)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.backgroundColor =
            "rgba(255,255,255,0.20)";
        }}
      >
        &#x2715;
      </button>
    </div>
  );

  return createPortal(banner, document.body);
}
