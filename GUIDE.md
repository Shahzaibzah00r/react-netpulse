# Building & Publishing react-netpulse

### A Complete Course Guide

---

## Table of Contents

1. [What We're Building & Why](#1-what-were-building--why)
2. [Project Setup](#2-project-setup)
3. [Architecture Overview](#3-architecture-overview)
4. [Chapter 4 — The Probe Function](#4-the-probe-function)
5. [Chapter 5 — Backoff Strategies](#5-backoff-strategies)
6. [Chapter 6 — The Offline Queue](#6-the-offline-queue)
7. [Chapter 7 — The Core Hook](#7-the-core-hook)
8. [Chapter 8 — The UI Component](#8-the-ui-component)
9. [Chapter 9 — Publishing to npm](#9-publishing-to-npm)
10. [Chapter 10 — Using the Package in a Project](#10-using-the-package-in-a-project)
11. [Chapter 11 — Advanced Patterns](#11-advanced-patterns)

---

## 1. What We're Building & Why

### The Problem with `navigator.onLine`

Every browser exposes `navigator.onLine`. It sounds perfect for detecting internet connectivity. It is not.

```js
// This returns true in ALL of these broken scenarios:
console.log(navigator.onLine); // → true

// Scenario A: Hotel WiFi — connected but login page blocks everything
// Scenario B: LAN cable to an unplugged router
// Scenario C: WiFi connected, ISP is down
// Scenario D: VPN connected, VPN dropped routing
```

`navigator.onLine` only tells you whether the device is connected to **a** network — not whether that network has a functioning path to the internet.

### Our Solution: HTTP Probing

We send a real HTTP `HEAD` request to a known URL. If it succeeds, we have internet. If it fails, we don't. No guessing.

```
Device → sends HEAD request → www.gstatic.com/generate_204
         ✓ 204 response    → isOnline = true
         ✗ timeout/error   → isOnline = false
```

### What Makes This Package Unique

Most connectivity packages (`react-detect-offline`, `use-network`) simply wrap `navigator.onLine`. We go further:

- **Real probe** — HTTP HEAD request, not `navigator.onLine`
- **Exponential backoff** — smart retry spacing when offline
- **Connection quality** — reads from the Network Information API
- **Offline action queue** — defer API calls until reconnected
- **Zero dependencies** — core hook has no runtime deps
- **TypeScript-first** — fully typed public API

---

## 2. Project Setup

### Prerequisites

```bash
node --version  # >= 18.0.0
npm --version   # >= 9.0.0
```

### Install Dev Dependencies

```bash
cd react-netpulse
npm install
```

### What Each Tool Does

| Tool | Purpose |
|------|---------|
| `tsup` | Bundles TypeScript into ESM + CJS with `.d.ts` declarations |
| `typescript` | Type checking and IDE intellisense |
| `react` + `@types/react` | Dev-only peer dep for writing/testing the component |

### Why `tsup` over Rollup/Webpack?

`tsup` is built on esbuild — it compiles TypeScript 10-100× faster than Rollup. For a library, we need:

- ESM output (`dist/index.js`) for modern bundlers
- CJS output (`dist/index.cjs`) for Node.js / older tools
- Type declarations (`dist/index.d.ts`) for TypeScript users

`tsup` handles all three in one command.

### Build the Package

```bash
npm run build
# Output:
# dist/index.js      ← ESM
# dist/index.cjs     ← CommonJS
# dist/index.d.ts    ← TypeScript declarations
```

### Watch Mode (During Development)

```bash
npm run dev
```

---

## 3. Architecture Overview

```
react-netpulse/
├── src/
│   ├── core/                   ← ZERO dependencies. Pure logic.
│   │   ├── types.ts            ← All TypeScript interfaces & types
│   │   ├── probe.ts            ← HTTP connectivity test
│   │   ├── backoff.ts          ← Retry delay calculation
│   │   ├── queue.ts            ← Offline action queue
│   │   └── useNetworkStatus.ts ← Main React hook
│   ├── react/                  ← React UI layer (peer dep: React only)
│   │   ├── icons/
│   │   │   ├── WifiOffIcon.tsx
│   │   │   └── WifiOnIcon.tsx
│   │   └── NetworkBanner.tsx   ← Ready-made banner component
│   └── index.ts                ← Public API surface
```

### Design Principles

**1. Headless-first**
The core hook (`useNetworkStatus`) has zero UI opinion. Users can build any UI on top of it. The `<NetworkBanner>` component is optional.

**2. Separation of concerns**

- `probe.ts` knows nothing about React
- `backoff.ts` knows nothing about probing
- `queue.ts` knows nothing about the network
- `useNetworkStatus.ts` assembles them

**3. Memory-first**
Every resource is explicitly cleaned up:

- `AbortController` — one per probe, aborted on unmount/next probe
- `setTimeout` — cleared before rescheduling and on unmount
- `EventListeners` — removed on unmount
- Queue — drained (not leaked) after reconnect

**4. No stale closures**
Options are stored in a `ref` updated every render. The probe function reads from this ref, so it always sees the latest `probeUrl`, `backoff`, etc. without needing to be recreated.

---

## 4. The Probe Function

**File:** `src/core/probe.ts`

### Why `HEAD` Request?

A `HEAD` request is identical to `GET` but the server returns **no body**. We only need the HTTP handshake to confirm connectivity — downloading response data would waste bandwidth.

```
GET  /generate_204  → server sends: headers + empty body (204)
HEAD /generate_204  → server sends: headers only (204)
```

### Why `mode: 'no-cors'`?

Normally, browser security (CORS) would block fetches to external domains unless those domains explicitly opt in. While `gstatic.com` supports CORS, we use `no-cors` to:

1. Skip the CORS preflight (`OPTIONS` request) — saves one network round-trip
2. Work with any URL the user configures (their URL may not have CORS headers)

**The trade-off:** With `no-cors`, we get an "opaque" response — we can't read the status code or headers. But we don't need to. A fetch that completes (even opaquely) proves we reached the internet. A fetch that throws proves we didn't.

```
Truly offline      → fetch throws TypeError → probe returns false ✓
Online (any status) → fetch completes (opaque) → probe returns true ✓
```

### The AbortController Pattern

We need two abort reasons:

1. **Timeout** — the probe takes too long (slow connection)
2. **Unmount** — React component is removed from the tree

```ts
// Our approach: one controller, two triggers
const timeoutCtrl   = new AbortController();
const timeoutId     = setTimeout(() => timeoutCtrl.abort(), timeout);

// Forward external abort into our controller
const forwardAbort  = () => timeoutCtrl.abort();
externalSignal.addEventListener('abort', forwardAbort, { once: true });

// In finally: always clean up both
clearTimeout(timeoutId);
externalSignal.removeEventListener('abort', forwardAbort);
```

The `{ once: true }` option on the event listener is important — it auto-removes itself after firing, preventing a memory leak.

---

## 5. Backoff Strategies

**File:** `src/core/backoff.ts`

When the user goes offline, we don't want to hammer the server with requests every second. We space them out intelligently.

### Why Backoff Matters

```
Without backoff (every 10 s):
  0s, 10s, 20s, 30s, 40s... → 6 requests/min forever

With exponential backoff (base 10s):
  10s, 20s, 40s, 60s, 60s... → fewer requests over time
```

### The Three Strategies

```
base = 10_000ms, retries: 1, 2, 3, 4

fixed:        10s,  10s,  10s,  10s
linear:       10s,  20s,  30s,  40s
exponential:  10s,  20s,  40s,  60s  ← capped at 60s
```

**Exponential** is the default because it:

- Still retries quickly at first (user is waiting)
- Backs off gracefully for prolonged outages
- Does not retry forever at high frequency (CPU/battery friendly)

### The Cap

```ts
const MAX_DELAY_MS = 60_000; // 1 minute maximum
```

Without a cap, after 10 retries with 10s base, exponential would schedule a retry in `10 × 2^10 = 10,240 seconds` (2.8 hours). That's too long. 60 seconds is the practical sweet spot.

---

## 6. The Offline Queue

**File:** `src/core/queue.ts`

### The Problem It Solves

Your user fills out a form and clicks Save. They're offline. Without a queue, you'd show an error and lose their work. With a queue:

```tsx
const { queue } = useNetworkStatus();

const handleSave = () => {
  // Runs immediately if online, automatically deferred if offline
  queue(() => api.saveEntry(formData));
  showFeedback('Saved — will sync when reconnected');
};
```

### Memory Design

The queue is backed by a plain `Array` because:

- Arrays are the most memory-efficient ordered collection in JavaScript
- `push` is O(1) amortized
- `splice(0)` drains atomically in O(1) — no copy needed

```ts
async drain(): Promise<void> {
  const batch = this._actions.splice(0); // atomically empties the array
  for (const fn of batch) {
    try {
      await fn();
    } catch {
      // one failure doesn't block others
    }
  }
}
```

**Why `splice(0)` instead of iterating and shifting?**

If we iterated while popping from the front, a new item added during iteration (e.g., an action that re-queues itself) would run in the same drain cycle — potentially causing infinite loops. `splice(0)` captures a snapshot and replaces the array with an empty one atomically. New items added during drain go into the next cycle.

---

## 7. The Core Hook

**File:** `src/core/useNetworkStatus.ts`

This is the most important file. Let's walk through each design decision.

### Refs vs State

```ts
// These cause re-renders — only what the UI needs:
const [isOnline,   setIsOnline]   = useState(true);
const [isChecking, setIsChecking] = useState(false);
const [retryCount, setRetryCount] = useState(0);
// ...

// These do NOT cause re-renders — internal coordination:
const isOnlineRef   = useRef(true);  // Must read isOnline synchronously inside callbacks
const retryCountRef = useRef(0);     // Same — can't use state inside async code
const timerRef      = useRef(null);  // setTimeout handle — purely imperative
const abortCtrlRef  = useRef(null);  // Current AbortController
const queueRef      = useRef(new OfflineQueue()); // Stable queue instance
```

**The rule:** If something must trigger a re-render (visible UI change), use `useState`. If something is only needed inside callbacks or async code, use `useRef`.

### The Stale Options Problem

Options (`probeUrl`, `backoff`, etc.) are passed as props and change between renders. But our probe function is defined once in the mount effect. If it captured `options` at mount time, it would be stale.

**Our solution: ref-forwarding**

```ts
const optsRef = useRef(options);
useEffect(() => { optsRef.current = options; }); // runs after every render

// Inside the probe function:
const { probeUrl, backoff } = optsRef.current; // always fresh
```

This is a well-known React pattern called "event handler ref" (also seen in React's own source).

### Why `runProbeRef`?

The probe function needs to schedule itself recursively (next probe after current probe completes). But `scheduleProbe` is a `useCallback` with `[]` deps — it can't capture the probe function directly.

Solution: store the probe function in a `ref`. `scheduleProbe` reads `runProbeRef.current` at call time:

```ts
const scheduleProbe = useCallback((delay: number) => {
  clearTimeout(timerRef.current);
  timerRef.current = setTimeout(() => runProbeRef.current(), delay);
}, []); // no deps — reads from ref at call time, never stale
```

### The Unmount Guard

Between `await probe(...)` returning and state updates running, the component might have unmounted. React 18+ makes this a silent no-op, but it's still wasteful:

```ts
const result = await probe(url, timeout, abortCtrlRef.current.signal);

// Guard: if we aborted, the component unmounted — skip all state updates
if (abortCtrlRef.current.signal.aborted) return;
```

When the mount effect's cleanup runs, it calls `abortCtrlRef.current?.abort()`. The signal is checked after `await` returns, so we always bail cleanly.

### Browser Event vs Probe

There are two sources of connectivity events:

1. **`window.online/offline`** — instant, but `navigator.onLine` based (unreliable for "truly online")
2. **HTTP probe** — reliable, but async

We handle both:

- `handleOffline`: trust the browser immediately (goes offline fast) + schedule first retry probe
- `handleOnline`: trigger a probe to verify (don't trust `navigator.onLine` "online" blindly)

---

## 8. The UI Component

**File:** `src/react/NetworkBanner.tsx`

### Portal Rendering

The banner sits at the top-centre of the viewport, above everything else. It must not be affected by any parent's `overflow: hidden` or `position: relative`. The solution is `createPortal`:

```tsx
return createPortal(banner, document.body);
```

This renders the banner as a direct child of `<body>` in the DOM, regardless of where `<NetworkBanner>` is placed in the React tree.

### CSS Injection Strategy

We need two CSS animations. We don't want to require the user to import a CSS file (that breaks in many bundler setups). So we inject a single `<style>` tag on first mount:

```ts
const STYLE_ID = 'react-netpulse-styles';

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return; // already injected
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}
```

The `STYLE_ID` guard means this is safe to call on every mount — it only adds the `<style>` once even if multiple instances of `NetworkBanner` mount.

### Animation State Machine

The banner has three visible states:

```
Offline:   → slide in (rnp-in)
Online:    → show "Back Online" toast → wait → slide out (rnp-out) → unmount
```

```ts
const [visible,    setVisible]    = useState(false); // Is the banner in the DOM?
const [animOut,    setAnimOut]    = useState(false); // Is it playing the slide-out animation?
const [showOnline, setShowOnline] = useState(false); // Is it the green "Back Online" version?
```

The two-timer approach for "reconnected":

```
Timer 1: wait `onlineMessageDuration` ms → then start slide-out animation
Timer 2: wait 380ms (animation duration) → then unmount
```

### Accessibility

- `role="status"` + `aria-live="polite"` — screen readers announce changes without interrupting
- `aria-atomic="true"` — screen reader reads the whole banner, not just changed text
- `prefers-reduced-motion` — CSS media query disables animations for users who prefer it
- `aria-label` on the Retry button — meaningful for screen readers
- `aria-hidden="true"` on SVG icons — decorative icons should not be read

---

## 9. Publishing to npm

### Step 1 — Create an npm Account

```bash
# Visit https://www.npmjs.com and create an account
# Then log in from your terminal:
npm login
```

### Step 2 — Choose Your Package Name

Check if the name is available:

```bash
npm search react-netpulse
# or just try: https://www.npmjs.com/package/react-netpulse
```

If `react-netpulse` is taken, use a scoped name:

```json
{ "name": "@yourusername/react-netpulse" }
```

Update `package.json` accordingly.

### Step 3 — Update package.json Fields

```json
{
  "name": "react-netpulse",
  "version": "1.0.0",
  "author": "Your Real Name <your@email.com>",
  "homepage": "https://github.com/yourusername/react-netpulse",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/react-netpulse.git"
  }
}
```

### Step 4 — Create a GitHub Repository

```bash
git init
git add .
git commit -m "feat: initial release v1.0.0"
git remote add origin https://github.com/yourusername/react-netpulse.git
git push -u origin main
```

### Step 5 — Build and Verify

```bash
npm run build

# Check what will be published (respects .npmignore)
npm pack --dry-run
```

The output should only include `dist/` and `README.md`.

### Step 6 — Publish

```bash
# First publish — no version tag needed
npm publish

# For scoped packages — public flag required (scoped = private by default)
npm publish --access public
```

### Step 7 — Verify on npm

Visit `https://www.npmjs.com/package/react-netpulse` — your package should appear within a few minutes.

### Publishing Updates

Use semantic versioning:

| Change | Command | Example |
|--------|---------|---------|
| Bug fix | `npm version patch` | 1.0.0 → 1.0.1 |
| New feature (backwards compatible) | `npm version minor` | 1.0.1 → 1.1.0 |
| Breaking change | `npm version major` | 1.1.0 → 2.0.0 |

```bash
npm version patch   # bumps version in package.json + creates git tag
npm publish         # builds and publishes
git push --tags     # push the version tag to GitHub
```

---

## 10. Using the Package in a Project

### Install

```bash
npm install react-netpulse
```

### Next.js (Pages Router)

```tsx
// pages/_app.tsx
import type { AppProps } from 'next/app';
import { NetworkBanner } from 'react-netpulse';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <NetworkBanner />
      <Component {...pageProps} />
    </>
  );
}
```

### Next.js (App Router)

```tsx
// app/layout.tsx
import { NetworkBanner } from 'react-netpulse'; // already has 'use client'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <NetworkBanner />
        {children}
      </body>
    </html>
  );
}
```

### Using the Hook for Custom UI

```tsx
'use client';
import { useNetworkStatus } from 'react-netpulse';

export function SaveButton({ onSave }: { onSave: () => Promise<void> }) {
  const { isOnline, queue, queueSize } = useNetworkStatus();

  const handleClick = () => queue(onSave);

  return (
    <button onClick={handleClick}>
      {isOnline
        ? 'Save'
        : `Save Offline (${queueSize} pending)`}
    </button>
  );
}
```

### Testing Locally Before Publishing

```bash
# In react-netpulse/
npm run build
npm link

# In your project/
npm link react-netpulse

# When done:
npm unlink react-netpulse
```

---

## 11. Advanced Patterns

### Custom Probe URL (Captive Portal Detection)

The default probe uses `mode: 'no-cors'` — it cannot distinguish genuine internet from a captive portal redirect (both return an opaque response). To detect captive portals, use your own CORS-enabled health endpoint:

```ts
// Your server returns 200 only if it has upstream internet
app.get('/api/healthz', (req, res) => res.sendStatus(200));
```

```tsx
<NetworkBanner probeUrl="/api/healthz" />
```

Now even captive portals (which can't reach your specific server) will correctly show the offline banner.

### Multiple Components Sharing State

Each `useNetworkStatus` call creates its own independent probe schedule. If you have multiple components, consider lifting state or creating a context:

```tsx
// NetworkContext.tsx
import React, { createContext, useContext } from 'react';
import { useNetworkStatus, type NetworkStatusResult } from 'react-netpulse';

const NetworkContext = createContext<NetworkStatusResult | null>(null);

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const status = useNetworkStatus();
  return <NetworkContext.Provider value={status}>{children}</NetworkContext.Provider>;
}

export const useNetwork = () => {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork must be used inside <NetworkProvider>');
  return ctx;
};
```

### Retry with User Feedback

```tsx
function RetryBanner() {
  const { isOnline, isChecking, retry, retryCount, lastOfflineAt } = useNetworkStatus();

  if (isOnline) return null;

  const downFor = lastOfflineAt
    ? Math.round((Date.now() - lastOfflineAt.getTime()) / 1000)
    : 0;

  return (
    <div className="banner">
      Offline for {downFor}s — attempt #{retryCount}
      <button onClick={retry} disabled={isChecking}>
        {isChecking ? 'Checking…' : 'Retry Now'}
      </button>
    </div>
  );
}
```

### Display Connection Quality

```tsx
const { quality } = useNetworkStatus();

const qualityLabel = {
  '2g':     '🐢 Slow (2G)',
  '3g':     '🚶 Moderate (3G)',
  '4g':     '⚡ Fast (4G)',
  'wifi':   '📶 WiFi',
  'unknown': '📡 Connected',
  null:      null,
}[quality];
```

### Aggressive Probing During Poor Quality

```tsx
const { quality } = useNetworkStatus({
  probeInterval: quality === '2g' ? 30_000 : 10_000, // probe less often on slow connections
});
```

---

## Summary

You have built a production-quality npm package with:

- ✅ A real HTTP probe (not `navigator.onLine`)
- ✅ Exponential/linear/fixed backoff
- ✅ An atomic offline action queue
- ✅ A portal-based accessibility-compliant React banner
- ✅ Full TypeScript with exported types
- ✅ ESM + CJS dual output via `tsup`
- ✅ Zero runtime dependencies in the core
- ✅ SSR safety for Next.js / Remix / Gatsby

**Next steps after publishing:**

1. Add it to `https://github.com/enaqx/awesome-react` via a PR
2. Post on r/reactjs and dev.to with a real-world demo
3. Add GitHub Actions CI (typecheck + build on every push)
4. Write tests with `vitest` + `@testing-library/react`
