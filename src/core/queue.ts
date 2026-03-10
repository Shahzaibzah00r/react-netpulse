import type { QueuedAction } from "./types";

/**
 * A minimal FIFO queue of async actions to execute when connectivity is restored.
 *
 * Memory design:
 * - Backed by a plain `Array` — the most memory-efficient collection for ordered data.
 * - `drain()` uses `splice(0)` to atomically empty the array in O(1).
 *   This means calling `drain()` twice in quick succession will not double-execute
 *   any action — the second call operates on an already-empty array.
 * - Errors in individual actions are isolated; one failure does not block others.
 * - The instance lives inside a `useRef` — it is never re-created on re-renders
 *   and holds no React references that could prevent GC.
 */
export class OfflineQueue {
  private readonly _actions: QueuedAction[] = [];

  /** Add an action to execute on reconnect. */
  enqueue(fn: QueuedAction): void {
    this._actions.push(fn);
  }

  /**
   * Drain and execute all queued actions in insertion order.
   * The queue is cleared atomically before any action runs.
   */
  async drain(): Promise<void> {
    const batch = this._actions.splice(0); // O(1) atomic drain
    for (const fn of batch) {
      try {
        await fn();
      } catch {
        // Isolate failure — remaining actions still run.
      }
    }
  }

  /** Current number of waiting actions. */
  get size(): number {
    return this._actions.length;
  }
}
