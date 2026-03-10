# react-netpulse

Real internet connectivity detection for React. Goes beyond `navigator.onLine`.

[![npm version](https://img.shields.io/npm/v/react-netpulse)](https://www.npmjs.com/package/react-netpulse)
[![bundle size](https://img.shields.io/bundlephobia/minzip/react-netpulse)](https://bundlephobia.com/package/react-netpulse)
[![license](https://img.shields.io/npm/l/react-netpulse)](LICENSE)

---

## Why not `navigator.onLine`?

`navigator.onLine` returns `true` if the device is connected to **any** network — including hotel WiFi login pages, LANs with no upstream routing, and cables plugged into powered-off routers. Your users will see no error banner despite having no usable internet.

`react-netpulse` sends a real HTTP probe request to verify actual connectivity.

---

## Features

| | react-netpulse | react-detect-offline | use-network |
|---|:---:|:---:|:---:|
| Real HTTP probe (not just `navigator.onLine`) | ✅ | ❌ | ❌ |
| Exponential / linear / fixed backoff | ✅ | ❌ | ❌ |
| Connection quality (2G / 3G / 4G / WiFi) | ✅ | ❌ | ❌ |
| Offline action queue | ✅ | ❌ | ❌ |
| "Back online" toast | ✅ | ❌ | ❌ |
| `prefers-reduced-motion` respected | ✅ | ❌ | ❌ |
| TypeScript-first | ✅ | ❌ | partial |
| Zero runtime dependencies (core) | ✅ | ❌ | ✅ |
| SSR safe (Next.js, Remix, Gatsby) | ✅ | partial | ✅ |
| Tree-shakeable | ✅ | ❌ | ✅ |

---

## Install

```bash
npm install react-netpulse
# or
yarn add react-netpulse
# or
pnpm add react-netpulse
```

**Peer dependencies:** React ≥ 17 and react-dom ≥ 17 (already installed in any React project).

---

## Quick Start

### Drop-in banner — zero configuration

```tsx
// _app.tsx / layout.tsx
import { NetworkBanner } from 'react-netpulse';

export default function Layout({ children }) {
  return (
    <>
      <NetworkBanner />
      {children}
    </>
  );
}
```

### Custom UI with the hook

```tsx
import { useNetworkStatus } from 'react-netpulse';

function ConnectionIndicator() {
  const { isOnline, isChecking, quality, retry } = useNetworkStatus();

  if (isOnline) return null;

  return (
    <div className="offline-bar">
      {isChecking ? 'Checking connection…' : 'No internet connection'}
      <button onClick={retry}>Retry</button>
    </div>
  );
}
```

### Offline action queue

```tsx
const { queue } = useNetworkStatus();

// Works whether online (runs immediately) or offline (queued until reconnected)
const handleSave = () => {
  queue(() => api.saveEntry(formData));
};
```

### Callbacks

```tsx
useNetworkStatus({
  onOffline: () => toast.error('Connection lost — your changes are saved locally.'),
  onOnline:  () => toast.success('Back online — syncing…'),
});
```

---

## API

### `useNetworkStatus(options?)`

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `probeUrl` | `string` | `'https://www.gstatic.com/generate_204'` | URL for the HEAD probe request |
| `probeInterval` | `number` | `10000` | Milliseconds between probes while online |
| `probeTimeout` | `number` | `5000` | Milliseconds before probe times out |
| `maxRetries` | `number` | `Infinity` | Max retries after going offline |
| `backoff` | `'fixed' \| 'linear' \| 'exponential'` | `'exponential'` | Retry spacing strategy |
| `onOnline` | `() => void` | — | Fired once when connectivity is restored |
| `onOffline` | `() => void` | — | Fired once when connectivity is lost |

#### Returns

| Property | Type | Description |
|----------|------|-------------|
| `isOnline` | `boolean` | `true` when last HTTP probe succeeded |
| `isChecking` | `boolean` | `true` while a probe is in-flight |
| `quality` | `'2g' \| '3g' \| '4g' \| 'wifi' \| 'unknown' \| null` | Network Info API quality |
| `retryCount` | `number` | Consecutive failed probes since going offline |
| `lastOnlineAt` | `Date \| null` | Timestamp of last confirmed online state |
| `lastOfflineAt` | `Date \| null` | Timestamp of last detected offline state |
| `retry` | `() => void` | Cancel pending probe, run one immediately |
| `queue` | `(fn: () => void \| Promise<void>) => void` | Queue action for reconnect |
| `queueSize` | `number` | Number of waiting queued actions |

---

### `<NetworkBanner />`

Accepts all hook options, plus:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `onlineMessageDuration` | `number` | `3000` | Ms to show "Back online" before hiding |
| `messages.offline` | `string` | `'No Internet Connection'` | Offline message |
| `messages.reconnecting` | `string` | `'Reconnecting…'` | While probing message |
| `messages.online` | `string` | `'✓ Back Online'` | On reconnect message |
| `zIndex` | `number` | `9999` | CSS z-index |

---

## Captive Portal Detection

The default probe URL (`gstatic.com/generate_204`) uses `mode: 'no-cors'` — an opaque response proves we reached a server, but cannot distinguish real internet from a captive portal redirect.

For true captive portal detection, point `probeUrl` at your own health endpoint:

```tsx
// Your API returns 200 only when your server (and thus real internet) is reachable
<NetworkBanner probeUrl="/api/healthz" />
```

---

## Next.js App Router

The `<NetworkBanner>` is pre-marked with `'use client'`. No extra config needed.

If you use only `useNetworkStatus` in your own Server Component tree, wrap it in a client boundary:

```tsx
'use client';
import { useNetworkStatus } from 'react-netpulse';
```

---

## License

MIT © Your Name
