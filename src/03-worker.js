/**
 * Fork Extension — Web Worker Module
 *
 * Implements "math mode": serialises the C-block's branch and dispatches it
 * to an inline Web Worker so that CPU-intensive computation does not freeze
 * the main Scratch runtime.
 *
 * ── How worker communication works ──────────────────────────────────────────
 * 1. The branch blocks are walked from the Scratch VM block container and
 *    converted to a plain JSON-serialisable array by _serialiseBlocks().
 * 2. An inline Worker is created from a Blob URL (no extra file needed).
 * 3. The serialised block list plus a variable snapshot are sent via
 *    postMessage() to the worker.
 * 4. The worker evaluates each block using its own mini-interpreter that
 *    handles standard Scratch math / logic opcodes.
 * 5. When done the worker postMessages { variables } back, and the main
 *    thread applies any updated values to the live Scratch target.
 * 6. The Worker is terminated and retained resources are freed.
 *
 * ── How Scratch blocks are scheduled ────────────────────────────────────────
 * The current Scratch thread does NOT call util.startBranch(), so it returns
 * immediately.  The Worker runs in a separate OS thread; postMessage is the
 * sole communication channel — no shared memory is used — so the Scratch
 * sequencer is never blocked.
 */

// ---------------------------------------------------------------------------
// Inline Worker source
// ---------------------------------------------------------------------------

/**
 * JavaScript source that runs *inside* the Web Worker.
 *
 * Receives:  { blocks: Array, variables: Object }
 *   blocks    — serialised branch blocks (see _serialiseBlocks)
 *   variables — snapshot of variable values { name: value, … }
 *
 * Posts back: { variables: Object }
 *   variables — snapshot with any values modified by set/change blocks
 */
const WORKER_SOURCE = `
"use strict";

/**
 * Mini Scratch block interpreter — pure math / logic opcodes only.
 *
 * Supports: arithmetic, comparisons, logic, math functions, rounding,
 * random, string join/length, and variable read/write.
 *
 * @param {{ opcode: string, inputs: object, fields: object }} block
 * @param {object} vars  mutable variable map { name: value }
 * @returns {*} computed value (undefined for statement blocks)
 */
function evalBlock(block, vars) {
  var inp = block.inputs || {};
  var fld = block.fields || {};

  // Resolve an input slot to a primitive.
  function resolve(name) {
    var slot = inp[name];
    if (!slot) return 0;
    if (slot.type === 'value')    return slot.value;
    if (slot.type === 'variable') return vars[slot.name] !== undefined ? vars[slot.name] : 0;
    if (slot.type === 'block')    return evalBlock(slot.block, vars);
    return 0;
  }

  switch (block.opcode) {
    // Arithmetic
    case 'operator_add':      return Number(resolve('NUM1')) + Number(resolve('NUM2'));
    case 'operator_subtract': return Number(resolve('NUM1')) - Number(resolve('NUM2'));
    case 'operator_multiply': return Number(resolve('NUM1')) * Number(resolve('NUM2'));
    case 'operator_divide': {
      var d = Number(resolve('NUM2'));
      return d === 0 ? 0 : Number(resolve('NUM1')) / d;
    }
    case 'operator_random': {
      var lo = Number(resolve('FROM')), hi = Number(resolve('TO'));
      return Math.floor(Math.random() * (hi - lo + 1)) + lo;
    }
    case 'operator_mod': {
      var n = Number(resolve('NUM1')), m = Number(resolve('NUM2'));
      return m === 0 ? 0 : n % m;
    }
    case 'operator_round': return Math.round(Number(resolve('NUM')));

    // Math functions
    case 'operator_mathop': {
      var v = Number(resolve('NUM'));
      var op = fld.OPERATOR && fld.OPERATOR.value;
      switch (op) {
        case 'abs':     return Math.abs(v);
        case 'floor':   return Math.floor(v);
        case 'ceiling': return Math.ceil(v);
        case 'sqrt':    return Math.sqrt(v);
        case 'sin':     return Math.sin((v * Math.PI) / 180);
        case 'cos':     return Math.cos((v * Math.PI) / 180);
        case 'tan':     return Math.tan((v * Math.PI) / 180);
        case 'asin':    return (Math.asin(v) * 180) / Math.PI;
        case 'acos':    return (Math.acos(v) * 180) / Math.PI;
        case 'atan':    return (Math.atan(v) * 180) / Math.PI;
        case 'ln':      return Math.log(v);
        case 'log':     return Math.log10(v);
        case 'e ^':     return Math.exp(v);
        case '10 ^':    return Math.pow(10, v);
        default:        return v;
      }
    }

    // Comparisons
    case 'operator_lt':     return Number(resolve('OPERAND1')) < Number(resolve('OPERAND2'));
    case 'operator_gt':     return Number(resolve('OPERAND1')) > Number(resolve('OPERAND2'));
    case 'operator_equals':
      return (String(resolve('OPERAND1')).toLowerCase() === String(resolve('OPERAND2')).toLowerCase());

    // Logic
    case 'operator_and': return Boolean(resolve('OPERAND1')) && Boolean(resolve('OPERAND2'));
    case 'operator_or':  return Boolean(resolve('OPERAND1')) || Boolean(resolve('OPERAND2'));
    case 'operator_not': return !resolve('BOOL');

    // String
    case 'operator_join':   return String(resolve('STRING1')) + String(resolve('STRING2'));
    case 'operator_length': return String(resolve('STRING')).length;

    // Variable read
    case 'data_variable': {
      var varName = fld.VARIABLE && fld.VARIABLE.value;
      return vars[varName] !== undefined ? vars[varName] : 0;
    }
    // Variable write
    case 'data_setvariableto': {
      vars[fld.VARIABLE.value] = resolve('VALUE');
      return;
    }
    case 'data_changevariableby': {
      var cname = fld.VARIABLE.value;
      vars[cname] = Number(vars[cname] || 0) + Number(resolve('VALUE'));
      return;
    }

    // Unknown / unsupported opcode — return 0 and continue.
    default: return 0;
  }
}

// Execute each block in the serialised sequence in order.
self.onmessage = function (e) {
  var blocks = e.data.blocks || [];
  var vars = Object.assign({}, e.data.variables);

  for (var i = 0; i < blocks.length; i++) {
    try {
      evalBlock(blocks[i], vars);
    } catch (_err) {
      // Swallow per-block errors so the remaining blocks still run.
    }
  }

  // Return the (possibly updated) variable snapshot to the main thread.
  self.postMessage({ variables: vars });
};
`;

// ---------------------------------------------------------------------------
// Worker creation & lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Lazily created Blob URL for the worker source.
 * Cached so it is only constructed once per session.
 * @type {string|null}
 */
let _workerBlobUrl = null;

/**
 * Return (and cache) a Blob URL for WORKER_SOURCE.
 * Returns null when the environment does not support Blob / Worker.
 *
 * The URL is intentionally kept alive for the entire extension session so
 * that multiple Worker instances can be spawned from it without re-allocating
 * a new Blob each time.  Revoking it would invalidate the cache and break
 * subsequent forks.  The memory cost of a single Blob URL is negligible
 * compared to the Worker instances themselves.
 *
 * @returns {string|null}
 */
function _getWorkerBlobUrl() {
  if (_workerBlobUrl) return _workerBlobUrl;
  try {
    const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
    _workerBlobUrl = URL.createObjectURL(blob);
    return _workerBlobUrl;
  } catch (_err) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Block serialisation helpers
// ---------------------------------------------------------------------------

/**
 * Walk the Scratch block tree starting at startBlockId and return a flat
 * JSON-serialisable array of simplified block descriptors.
 *
 * Only the top-level sequential chain is included (no sub-branches).
 * Reporter inputs that are themselves blocks are resolved recursively via
 * _serialiseBlock().
 *
 * @param {object} blockContainer - target.blocks (Scratch VM BlocksContainer)
 * @param {string} startBlockId   - ID of the first block in the branch
 * @returns {Array<{opcode:string, inputs:object, fields:object}>}
 */
function _serialiseBlocks(blockContainer, startBlockId) {
  const result = [];
  let currentId = startBlockId;
  while (currentId) {
    const block = blockContainer.getBlock(currentId);
    if (!block) break;
    result.push(_serialiseBlock(block, blockContainer));
    currentId = block.next;
  }
  return result;
}

/**
 * Convert one Scratch VM block into a plain descriptor, recursively
 * serialising any reporter inputs.
 *
 * @param {object} block          - Raw Scratch VM block object
 * @param {object} blockContainer - target.blocks
 * @returns {{ opcode: string, inputs: object, fields: object }}
 */
function _serialiseBlock(block, blockContainer) {
  const inputs = {};
  for (const [key, input] of Object.entries(block.inputs || {})) {
    // input.block is the ID of the block filling this input slot.
    const childId = input.block;
    if (!childId) {
      // Literal value stored directly on the input object.
      if (input.value !== undefined) {
        inputs[key] = { type: 'value', value: input.value };
      }
      continue;
    }
    const child = blockContainer.getBlock(childId);
    if (!child) continue;

    if (child.shadow) {
      // Shadow block — extract the literal value from its fields.
      const fieldValues = Object.values(child.fields || {});
      inputs[key] = {
        type: 'value',
        value: fieldValues.length > 0 ? fieldValues[0].value : 0,
      };
    } else {
      // Reporter block — recurse to build a nested descriptor.
      inputs[key] = {
        type: 'block',
        block: _serialiseBlock(child, blockContainer),
      };
    }
  }

  return { opcode: block.opcode, inputs, fields: block.fields || {} };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the C-block's branch inside a Web Worker.
 *
 * The current Scratch thread does NOT call util.startBranch(), so it
 * continues executing immediately.  The branch blocks are serialised, sent
 * to the worker via postMessage, and the worker posts variable updates back.
 * The worker is terminated and its slot released after the reply is received.
 *
 * @param {object} util   - Scratch block utility (thread / target / runtime)
 * @param {object} state  - Shared throttle state from 01-core.js
 */
export function startWorkerThread(util, state) {
  // Guard: respect the active-worker cap.
  if (state.activeWorkers.size >= state.maxWorkers) {
    console.warn(`[Fork] Worker limit reached (${state.maxWorkers}). Skipping fork.`);
    return;
  }

  // Fail gracefully when Workers are unavailable (e.g., some sandboxed pages).
  if (typeof Worker === 'undefined') {
    console.warn('[Fork] Web Workers are not available in this environment.');
    return;
  }

  const blobUrl = _getWorkerBlobUrl();
  if (!blobUrl) {
    console.warn('[Fork] Could not create Web Worker Blob URL.');
    return;
  }

  const blockId = util.thread.peekStack();
  const target = util.thread.target;

  // Get the first block ID inside the C-block's branch.
  const branchBlockId = target.blocks.getBranch(blockId, 1);
  if (!branchBlockId) return; // Empty branch.

  // Serialise the branch into a plain object array for postMessage.
  const serialisedBlocks = _serialiseBlocks(target.blocks, branchBlockId);
  if (serialisedBlocks.length === 0) return;

  // Snapshot the target's variable values to send to the worker.
  const variables = {};
  for (const variable of Object.values(target.variables || {})) {
    variables[variable.name] = variable.value;
  }

  // Create a Worker for this invocation and register it with the throttle.
  const worker = new Worker(blobUrl);
  state.activeWorkers.add(worker);

  /**
   * Apply variable updates returned by the worker back to the Scratch target.
   * Terminate the worker and release its throttle slot when done.
   */
  worker.onmessage = function (e) {
    const updatedVars = (e.data && e.data.variables) || {};
    for (const variable of Object.values(target.variables || {})) {
      if (Object.prototype.hasOwnProperty.call(updatedVars, variable.name)) {
        variable.value = updatedVars[variable.name];
      }
    }
    worker.terminate();
    state.activeWorkers.delete(worker);
  };

  worker.onerror = function (err) {
    console.error('[Fork] Worker error:', err.message);
    worker.terminate();
    state.activeWorkers.delete(worker);
  };

  /**
   * Send the serialised blocks and variable snapshot to the worker.
   * The worker evaluates the blocks and posts { variables } back via onmessage.
   */
  worker.postMessage({ blocks: serialisedBlocks, variables });
}
