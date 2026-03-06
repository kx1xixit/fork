// Fork Extension — Web Worker Module
// See docs/fork.md for full documentation.

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
 * Scratch-compatible comparison helper.
 * Returns -1, 0, or 1 mirroring Scratch VM cast.compare():
 *   numeric compare when both operands are non-empty valid numbers,
 *   otherwise case-insensitive string compare.
 * Empty string is handled explicitly (it coerces to 0 but should not be
 * treated as numeric), matching Scratch VM's own special-case check.
 */
function scratchCompare(a, b) {
  var na = Number(a), nb = Number(b);
  // Empty string coerces to 0 via Number(), but Scratch does not treat it
  // as numeric.  Match Scratch VM's explicit empty-string guard.
  if (na === 0 && a === '') return String(a).toLowerCase() < String(b).toLowerCase() ? -1 : String(a).toLowerCase() > String(b).toLowerCase() ? 1 : 0;
  if (nb === 0 && b === '') return String(a).toLowerCase() < String(b).toLowerCase() ? -1 : String(a).toLowerCase() > String(b).toLowerCase() ? 1 : 0;
  if (!isNaN(na) && !isNaN(nb)) {
    return na < nb ? -1 : na > nb ? 1 : 0;
  }
  var sa = String(a).toLowerCase(), sb = String(b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Scratch-compatible boolean coercion (mirrors Scratch VM cast.toBoolean()):
 *   false, "", "0", "false" → false; everything else → true.
 */
function scratchBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    return v !== '' && v !== '0' && v.toLowerCase() !== 'false';
  }
  return Boolean(v);
}

/**
 * Mini Scratch block interpreter — pure math / logic opcodes only.
 *
 * Supports: arithmetic, comparisons, logic, math functions, rounding,
 * random, string join/length, and variable read/write.
 *
 * @param {{ opcode: string, inputs: object, fields: object }} block
 * @param {object} vars  mutable variable map { id: value }
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
    if (slot.type === 'variable') return vars[slot.id || slot.name] !== undefined ? vars[slot.id || slot.name] : 0;
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
      // Normalize bounds: ensure lo <= hi
      if (lo > hi) { var tmp = lo; lo = hi; hi = tmp; }
      // If bounds are equal, just return that value
      if (lo === hi) return lo;
      // Use Scratch VM's cast.isInt check: parseInt(n, 10) == n
      var loIsInt = parseInt(lo, 10) == lo;
      var hiIsInt = parseInt(hi, 10) == hi;
      if (loIsInt && hiIsInt) {
        // Integer random in [lo, hi]
        return Math.floor(Math.random() * (hi - lo + 1)) + lo;
      }
      // Floating-point random between lo and hi
      return Math.random() * (hi - lo) + lo;
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

    // Comparisons — use Scratch semantics: numeric when both sides are
    // non-empty valid numbers, otherwise case-insensitive string compare.
    case 'operator_lt':     return scratchCompare(resolve('OPERAND1'), resolve('OPERAND2')) < 0;
    case 'operator_gt':     return scratchCompare(resolve('OPERAND1'), resolve('OPERAND2')) > 0;
    case 'operator_equals': return scratchCompare(resolve('OPERAND1'), resolve('OPERAND2')) === 0;

    // Logic — use Scratch-style boolean coercion so that "0"/"false"/"" are
    // treated as false, matching Scratch VM cast.toBoolean() semantics.
    case 'operator_and': return scratchBool(resolve('OPERAND1')) && scratchBool(resolve('OPERAND2'));
    case 'operator_or':  return scratchBool(resolve('OPERAND1')) || scratchBool(resolve('OPERAND2'));
    case 'operator_not': return !scratchBool(resolve('BOOL'));

    // String
    case 'operator_join':   return String(resolve('STRING1')) + String(resolve('STRING2'));
    case 'operator_length': return String(resolve('STRING')).length;

    // Variable opcodes — key by variable ID (Scratch VM field has both .id
    // and .value/.name; fall back to .value when .id is absent).
    case 'data_variable': {
      return vars[getVarId(fld)] !== undefined ? vars[getVarId(fld)] : 0;
    }
    case 'data_setvariableto': {
      vars[getVarId(fld)] = resolve('VALUE');
      return;
    }
    case 'data_changevariableby': {
      var chgId = getVarId(fld);
      vars[chgId] = Number(vars[chgId] || 0) + Number(resolve('VALUE'));
      return;
    }

    // Unknown / unsupported opcode — return 0 and continue.
    default: return 0;
  }
}

/**
 * Extract the variable ID from a block's fields object.
 * Scratch VM stores both an ID and a display name; prefer the ID so that
 * same-name variables in different scopes are kept distinct.
 * @param {object} fld - block.fields
 * @returns {string} variable ID, or name as fallback
 */
function getVarId(fld) {
  return fld.VARIABLE ? (fld.VARIABLE.id || fld.VARIABLE.value) : '';
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
 * @param {object}      util        - Scratch block utility (thread / target / runtime)
 * @param {object}      state       - Shared throttle state from 01-core.js
 * @param {object|null} _ctorRuntime - Runtime from constructor (unused here but kept for
 *                                    API symmetry with startAsyncThread)
 */
export function startWorkerThread(util, state, _ctorRuntime) {
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

  const target = util.target || (util.thread && util.thread.target);
  if (!target) return;

  // Get the C-block's block ID and find its branch.
  const blockId = util.thread && util.thread.peekStack && util.thread.peekStack();

  let branchBlockId = null;
  if (blockId) {
    if (typeof target.blocks.getBranch === 'function') {
      branchBlockId = target.blocks.getBranch(blockId, 1);
    }
    if (!branchBlockId) {
      const block = typeof target.blocks.getBlock === 'function' && target.blocks.getBlock(blockId);
      const substackInput = block && block.inputs && block.inputs['SUBSTACK'];
      branchBlockId = substackInput ? substackInput.block : null;
    }
  }

  if (!branchBlockId) return; // Empty branch.

  // Serialise the branch into a plain object array for postMessage.
  const serialisedBlocks = _serialiseBlocks(target.blocks, branchBlockId);
  if (serialisedBlocks.length === 0) return;

  // Snapshot the target's variable values to send to the worker.
  // Keyed by variable ID so that same-name sprite-local vs global variables
  // are kept distinct.
  const variables = {};
  for (const [id, variable] of Object.entries(target.variables || {})) {
    variables[id] = variable.value;
  }

  // Create a Worker for this invocation and register it with the throttle.
  const worker = new Worker(blobUrl);
  state.activeWorkers.add(worker);

  // Watchdog: if the worker never posts back (e.g. infinite recursion in the
  // block graph), terminate it and release the slot after 5 s so future forks
  // are not permanently throttled.
  const WORKER_TIMEOUT_MS = 5000;
  const workerTimeout = setTimeout(function () {
    if (state.activeWorkers.has(worker)) {
      console.warn('[Fork] Worker timed out after 5 s; terminating.');
      worker.terminate();
      state.activeWorkers.delete(worker);
    }
  }, WORKER_TIMEOUT_MS);

  /**
   * Apply variable updates returned by the worker back to the Scratch target.
   * Terminate the worker and release its throttle slot when done.
   */
  worker.onmessage = function (e) {
    clearTimeout(workerTimeout);
    const updatedVars = (e.data && e.data.variables) || {};
    // Match by variable ID; only update variables present in the worker's
    // result to avoid clobbering unrelated variables.
    for (const [id, variable] of Object.entries(target.variables || {})) {
      if (Object.prototype.hasOwnProperty.call(updatedVars, id)) {
        variable.value = updatedVars[id];
      }
    }
    worker.terminate();
    state.activeWorkers.delete(worker);
  };

  worker.onerror = function (err) {
    clearTimeout(workerTimeout);
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
