// Fork Extension — Normal Thread Module
// See docs/fork.md for full documentation.

/**
 * Fork the C-block's branch into a new Scratch VM thread.
 *
 * ── Async proof ──────────────────────────────────────────────────────────────
 * The block handler returns undefined without calling util.startBranch().
 * In TurboWarp's compiled execution this means:
 *   while (a1.branch = +(undefined)) { … }  →  while (NaN) { … }
 * NaN is falsy, so the inline branch body is never entered on the calling
 * thread.  Control falls through to the next block immediately, regardless of
 * how long the forked thread takes.
 *
 * @param {object}      util        - Scratch block utility (thread / target / runtime)
 * @param {object}      state       - Shared throttle state from 01-core.js
 * @param {object|null} ctorRuntime - Runtime injected via ForkExtension constructor
 */
export function startAsyncThread(util, state, ctorRuntime) {
  // Guard: respect the active-thread cap to prevent runaway spawning.
  if (state.activeThreadCount >= state.maxThreads) {
    console.warn(`[Fork] Async thread limit reached (${state.maxThreads}). Skipping fork.`);
    return;
  }

  // Resolve the Scratch VM runtime via multiple paths so the extension works
  // in both TurboWarp's interpreted mode and its compiled / warp mode.
  //   1. Runtime from the extension constructor (most reliable)
  //   2. Scratch.vm.runtime (TurboWarp always exposes Scratch.vm)
  //   3. util.target.runtime / util.thread.target.runtime (standard scratch-vm)
  const target = util.target || (util.thread && util.thread.target);
  const runtime =
    ctorRuntime ||
    (typeof Scratch !== 'undefined' && Scratch.vm && Scratch.vm.runtime) ||
    (target && target.runtime);

  if (!runtime || typeof runtime._pushThread !== 'function') {
    console.warn('[Fork] Scratch runtime._pushThread is not available. Cannot create thread.');
    return;
  }

  if (!target) {
    console.warn('[Fork] Cannot resolve current target. Cannot create thread.');
    return;
  }

  // Determine the ID of this C-block so we can look up its substack.
  // util.thread.peekStack() is reliable in interpreted mode.  In compiled
  // mode TurboWarp sets thread.stack[0] to the C-block's ID before invoking
  // the block handler, so peekStack() always returns the C-block's ID.
  const blockId = util.thread && util.thread.peekStack && util.thread.peekStack();

  let branchBlockId = null;

  if (blockId) {
    // Primary: standard scratch-vm API — getBranch(id, 1) returns the first
    // block inside the SUBSTACK input of the C-block.
    if (typeof target.blocks.getBranch === 'function') {
      branchBlockId = target.blocks.getBranch(blockId, 1);
    }

    // Fallback: read the SUBSTACK input directly from the block object.
    // This covers cases where getBranch uses different indexing or is absent.
    if (!branchBlockId) {
      const block = typeof target.blocks.getBlock === 'function' && target.blocks.getBlock(blockId);
      const substackInput = block && block.inputs && block.inputs['SUBSTACK'];
      branchBlockId = substackInput ? substackInput.block : null;
    }
  }

  if (!branchBlockId) return; // Empty branch — nothing to fork.

  state.activeThreadCount++;

  try {
    /**
     * runtime._pushThread creates a new Thread starting at branchBlockId and
     * adds it to runtime.threads so the sequencer will step it each frame.
     * stackClick: false  — not triggered by a sprite click event.
     * updateMonitor: false — no monitor refresh needed for forked threads.
     *
     * This call returns immediately — the new thread will be stepped by
     * the sequencer on the next (or same) animation frame.  The calling
     * (main) script has already returned undefined from this block handler,
     * which means the compiled while-loop condition evaluates to NaN (falsy)
     * and the inline branch body is skipped entirely on the current thread.
     */
    const newThread = runtime._pushThread(branchBlockId, target, {
      stackClick: false,
      updateMonitor: false,
    });

    if (newThread) {
      // Diagnostic: set globalThis.FORK_DEBUG = true in the browser console
      // to enable timestamped logs that prove the fork fires before the branch
      // runs.  Uses globalThis to avoid ESLint no-undef on a bare identifier.
      if (globalThis.FORK_DEBUG) {
        console.log(
          '[Fork] New thread created — main script continues immediately.',
          'Branch runs asynchronously starting at block:',
          branchBlockId
        );
      }
      _trackThreadCompletion(runtime, newThread, () => {
        if (globalThis.FORK_DEBUG) {
          console.log('[Fork] Branch thread finished.');
        }
        state.activeThreadCount--;
      });
    } else {
      // _pushThread returned nothing — release the slot we pre-incremented.
      console.warn('[Fork] _pushThread returned no thread object.');
      state.activeThreadCount--;
    }
  } catch (err) {
    // Swallow the error so it never propagates out of the block handler.
    // Propagating an error can cause TurboWarp to execute the branch on the
    // current thread as a fallback, which is the blocking behaviour we want
    // to avoid.
    console.warn('[Fork] Failed to start async thread:', err.message);
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
  // Guard against double-calling onDone (interval fires + watchdog fires
  // within the same 100 ms window, or interval fires just as watchdog clears).
  let doneCalled = false;
  function finish() {
    if (doneCalled) return;
    doneCalled = true;
    clearInterval(interval);
    clearTimeout(watchdog);
    onDone();
  }

  // Poll at 100 ms — a lightweight interval that keeps the throttle slot
  // accurate without a public VM event for thread completion.  The
  // runtime.threads.includes() check is O(n) in the thread count, but typical
  // projects have well under 100 active threads so the cost is negligible.
  const interval = setInterval(() => {
    if (thread.status === STATUS_DONE || !runtime.threads.includes(thread)) {
      finish();
    }
  }, 100);

  // Watchdog: if the thread never completes (e.g. an infinite loop that isn't
  // terminated by the VM), release the throttle slot after 5 s so future forks
  // are not permanently blocked.  Matches the worker watchdog in 03-worker.js.
  const THREAD_TIMEOUT_MS = 5000;
  const watchdog = setTimeout(() => {
    console.warn('[Fork] Thread watchdog fired after 5 s; releasing throttle slot.');
    finish();
  }, THREAD_TIMEOUT_MS);
}
