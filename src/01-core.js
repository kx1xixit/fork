// Fork Extension — Core Module (kxFork)
// See docs/fork.md for full documentation.

// These imports are stripped by the bundler; the exported functions are
// available via hoisting after concatenation.
import { startAsyncThread } from './02-threads.js';
import { startWorkerThread } from './03-worker.js';

// Shared throttle state — prevents runaway thread / worker spawning.
// Passed by reference into each helper so limits are enforced globally.
const forkState = {
  // Number of currently-running async Scratch threads forked by Fork.
  activeThreadCount: 0,
  // Hard cap on concurrent forked Scratch threads.
  maxThreads: 64,
  // Set of currently active Web Workers.
  activeWorkers: new Set(),
  // Hard cap on concurrent Web Workers.
  maxWorkers: 8,
};

class ForkExtension {
  /**
   * Optional runtime reference, populated only when a caller passes one
   * explicitly.  Because the extension is registered as a pre-instantiated
   * object (see bottom of this file), TurboWarp never injects a runtime here.
   * Block handlers fall back to Scratch.vm.runtime / util.target.runtime at
   * call-time instead.
   *
   * @param {object} [runtime] - Optional Scratch VM runtime instance
   */
  constructor(runtime) {
    this._runtime = runtime || null;
  }

  /**
   * Return extension metadata and block definitions to TurboWarp.
   * Required by the Scratch extension protocol.
   */
  getInfo() {
    return {
      id: 'kxFork',
      name: Scratch.translate('Fork'),
      // Teal brand colours
      color1: '#009688',
      color2: '#00796B',
      color3: '#00695C',
      blocks: [
        {
          /**
           * C-block: "run in [MODE] mode."
           *
           * CONDITIONAL = a C-block that executes its branch once (if-style).
           * The implementation intentionally does NOT call util.startBranch(),
           * so the enclosing Scratch thread never waits for the inner blocks.
           * Instead, the branch is handed off to a new thread or Web Worker.
           */
          opcode: 'runInMode',
          blockType: Scratch.BlockType.CONDITIONAL,
          text: Scratch.translate('run in [MODE] mode'),
          arguments: {
            MODE: {
              type: Scratch.ArgumentType.STRING,
              menu: 'MODE_MENU',
              defaultValue: 'normal',
            },
          },
          branchCount: 1,
        },
      ],
      menus: {
        // acceptReporters: false keeps the dropdown from accepting dynamic values.
        MODE_MENU: {
          acceptReporters: false,
          items: ['normal', 'math'],
        },
      },
    };
  }

  /**
   * Block handler for "run in [MODE] mode."
   *
   * Dispatches to the correct threading strategy based on MODE:
   *   'normal' → startAsyncThread  (02-threads.js)
   *   'math'   → startWorkerThread (03-worker.js)
   *
   * Neither helper calls util.startBranch(), so the current Scratch script
   * continues executing without blocking on the forked work.
   *
   * @param {{ MODE: string }} args
   * @param {object} util - Scratch block utility (thread / target / runtime)
   */
  runInMode(args, util) {
    const mode = args.MODE;
    if (mode === 'math') {
      startWorkerThread(util, forkState, this._runtime);
    } else {
      // Default: 'normal' async Scratch thread
      startAsyncThread(util, forkState, this._runtime);
    }
  }
}

// Register a pre-instantiated object so TurboWarp's loadExtensionURL can call
// instance.getInfo() directly.  The runtime is resolved at call-time via
// fallback paths in startAsyncThread (Scratch.vm.runtime / util.target.runtime),
// so no constructor injection is required.
Scratch.extensions.register(new ForkExtension());
