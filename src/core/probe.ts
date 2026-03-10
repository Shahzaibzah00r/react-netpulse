/**
 * Sends a lightweight HEAD request to verify actual internet connectivity.
 *
 * Why HEAD + no-cors?
 * - HEAD: no response body downloaded → near-zero bytes transferred.
 * - no-cors: skips CORS preflight → one network round-trip instead of two.
 *   The fetch resolving (even as an opaque response) proves the network stack
 *   successfully reached an external server. A fetch that throws proves it did not.
 *
 * Why not navigator.onLine?
 * - Returns `true` if connected to any network, including hotel captive portals,
 *   LANs with no upstream internet, and broken routers. This probe method is
 *   meaningfully more accurate for those cases.
 *
 * Memory design:
 * - One `AbortController` is created per call, cleaned up in `finally`.
 * - The `externalSignal` (owned by the hook's long-lived AbortController) is
 *   forwarded via a one-time event listener — removed in `finally`.
 * - No response body is ever read.
 *
 * @param url            - URL to probe (HEAD request).
 * @param timeout        - Milliseconds before the probe is aborted.
 * @param externalSignal - AbortSignal from the caller; aborts this probe when the
 *                         component unmounts.
 */
export async function probe(
  url: string,
  timeout: number,
  externalSignal: AbortSignal,
): Promise<boolean> {
  const timeoutCtrl = new AbortController();
  const timeoutId = setTimeout(() => timeoutCtrl.abort(), timeout);

  // Forward the external abort (component unmount) into our timeout controller.
  const forwardAbort = () => timeoutCtrl.abort();
  externalSignal.addEventListener("abort", forwardAbort, { once: true });

  try {
    await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      mode: "no-cors",
      signal: timeoutCtrl.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
    externalSignal.removeEventListener("abort", forwardAbort);
  }
}
