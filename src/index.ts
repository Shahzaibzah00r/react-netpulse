// Core — framework-agnostic hook
export { useNetworkStatus } from "./core/useNetworkStatus";

// React UI component (optional — tree-shaken if unused)
export { NetworkBanner } from "./react/NetworkBanner";

// TypeScript types
export type {
  NetworkStatusOptions,
  NetworkStatusResult,
  ConnectionQuality,
  BackoffStrategy,
  QueuedAction,
} from "./core/types";
export type { NetworkBannerProps } from "./react/NetworkBanner";
