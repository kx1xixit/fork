/**
 * Fork Extension — Core Module
 *
 * Provides simple multithreading utilities for Scratch / TurboWarp projects.
 * Two modes are supported via a single C-block ("run in [MODE] mode."):
 *
 *   normal — Forks the branch into a brand-new Scratch VM thread so the
 *            enclosing script continues immediately without blocking.
 *            Implemented in 02-threads.js.
 *
 *   math   — Serialises the branch blocks and dispatches them to an inline
 *            Web Worker so CPU-intensive math runs off the main thread.
 *            Implemented in 03-worker.js.
 *
 * Extension ID : kxFork
 * Load order   : 01-core is concatenated first; 02 and 03 follow.
 *                Because those modules export plain function declarations,
 *                JavaScript hoisting makes them available here at call-time
 *                even though they appear later in the built bundle.
 */

// These imports are stripped by the bundler; the exported functions are
// available via hoisting after concatenation.
import { startAsyncThread } from './02-threads.js';
import { startWorkerThread } from './03-worker.js';

/**
 * Shared throttle state — prevents runaway thread / worker spawning.
 * Passed by reference into each helper so limits are enforced globally.
 */
const forkState = {
  /** Number of currently-running async Scratch threads forked by Fork. */
  activeThreadCount: 0,
  /** Hard cap on concurrent forked Scratch threads. */
  maxThreads: 64,
  /** Set of currently active Web Workers. */
  activeWorkers: new Set(),
  /** Hard cap on concurrent Web Workers. */
  maxWorkers: 8,
};

class ForkExtension {
  /**
   * TurboWarp / scratch-vm calls new ForkExtension(runtime) when loading the
   * extension, injecting the VM runtime directly.  Storing it here ensures
   * block handlers always have a reliable runtime reference even in execution
   * contexts where util.thread.target.runtime is unavailable (e.g. TurboWarp
   * compiled / warp mode).
   *
   * @param {object} runtime - The Scratch VM runtime instance
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
          text: Scratch.translate('run in [MODE] mode.'),
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

// Register the extension class so TurboWarp can call new ForkExtension(runtime),
// injecting the VM runtime into the constructor as intended.  Passing the class
// (rather than a pre-instantiated object) is the standard TurboWarp pattern for
// extensions that need a reliable constructor-injected runtime reference.
Scratch.extensions.register(ForkExtension);
