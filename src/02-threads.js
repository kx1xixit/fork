/**
 * Fork Extension — Normal Thread Module
 *
 * Implements "normal mode": runs the C-block's branch as a brand-new Scratch
 * thread inside the TurboWarp / Scratch VM scheduler.
 *
 * ── How threads are created ─────────────────────────────────────────────────
 * runtime._pushThread(startBlockId, target) inserts a new Thread object into
 * the VM's thread list.  On the very next scheduler tick the VM will begin
 * stepping through blocks starting at startBlockId — exactly as if a "When
 * green flag clicked" hat had fired.  The forking script never calls
 * util.startBranch(), so it returns immediately without waiting.
 *
 * ── How Scratch blocks are scheduled ────────────────────────────────────────
 * TurboWarp's sequencer iterates over all active threads each animation
 * frame.  Pushing a thread simply appends it to that list; the sequencer
 * picks it up on the next frame, honouring all normal yielding / timing rules.
 */

/**
 * Fork the C-block's branch into a new Scratch VM thread.
 *
 * @param {object} util   - Scratch block utility (provides thread / target / runtime)
 * @param {object} state  - Shared throttle state from 01-core.js
 */
export function startAsyncThread(util, state) {
  // Guard: respect the active-thread cap to prevent runaway spawning.
  if (state.activeThreadCount >= state.maxThreads) {
    console.warn(`[Fork] Async thread limit reached (${state.maxThreads}). Skipping fork.`);
    return;
  }

  const blockId = util.thread.peekStack();
  const target = util.thread.target;
  const runtime = target.runtime;

  // Retrieve the ID of the first block inside the C-block's branch (substack 1).
  const branchBlockId = target.blocks.getBranch(blockId, 1);
  if (!branchBlockId) return; // Empty branch — nothing to fork.

  state.activeThreadCount++;

  /**
   * runtime._pushThread creates a new Thread starting at branchBlockId and
   * adds it to runtime.threads so the sequencer will step it each frame.
   * stackClick: false  — not triggered by a sprite click event.
   * updateMonitor: false — no monitor refresh needed for forked threads.
   */
  const newThread = runtime._pushThread(branchBlockId, target, {
    stackClick: false,
    updateMonitor: false,
  });

  if (newThread) {
    // Poll until the VM removes the thread, then release the throttle slot.
    _trackThreadCompletion(runtime, newThread, () => {
      state.activeThreadCount--;
    });
  } else {
    // _pushThread returned nothing — release the slot we pre-incremented.
    state.activeThreadCount--;
  }
}

/**
 * Polls every 100 ms to detect when the Scratch VM has finished a thread.
 * Fires onDone() exactly once, then stops polling.
 *
 * Thread.STATUS_DONE = 4 in scratch-vm; threads at that status are removed
 * by the sequencer during its next cleanup pass.
 *
 * @param {object}   runtime - Scratch VM runtime
 * @param {object}   thread  - The Thread object to watch
 * @param {Function} onDone  - Callback fired when the thread completes
 */
function _trackThreadCompletion(runtime, thread, onDone) {
  const STATUS_DONE = 4; // Thread.STATUS_DONE in scratch-vm
  // Poll at 100 ms — a lightweight interval that keeps the throttle slot
  // accurate without a public VM event for thread completion.  The
  // runtime.threads.includes() check is O(n) in the thread count, but typical
  // projects have well under 100 active threads so the cost is negligible.
  const interval = setInterval(() => {
    if (thread.status === STATUS_DONE || !runtime.threads.includes(thread)) {
      clearInterval(interval);
      onDone();
    }
  }, 100);
}
