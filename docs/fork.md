# Fork Extension (`kxFork`)

Provides a single C-block that runs the enclosed branch concurrently with the
rest of the script.

## Block

```text
run in [normal ▼] mode
```

| Mode | Behavior |
|------|----------|
| `normal` | Forks the branch into a new Scratch VM thread via `runtime._pushThread`. The calling script returns immediately; the branch runs on the next scheduler tick. |
| `math` | Serializes the branch block graph to JSON, executes it inside an inline Web Worker, then syncs any variable changes back to the main thread. Useful for CPU-intensive arithmetic that would otherwise block the UI. |

## Throttle limits

| Resource | Cap |
|----------|-----|
| Concurrent forked threads (normal mode) | 64 |
| Concurrent Web Workers (math mode) | 8 |

Both modes emit `console.warn` and skip the fork when their cap is reached.
Both modes include a **5-second watchdog** that releases the slot automatically
if the thread / worker never finishes.

## Debugging async behavior

1. Add a `say "Done"` block **directly after** the C-block. It will appear
   before the forked branch's output when the fork is working.
2. Open the browser console and type `globalThis.FORK_DEBUG = true`. You will
   see timestamped `[Fork] New thread created` / `[Fork] Branch thread finished`
   logs.

---

## Normal mode internals (`02-threads.js`)

### How `runtime._pushThread` works

`runtime._pushThread(startBlockId, target)` inserts a new `Thread` object into
the VM's thread list. On the very next scheduler tick the VM steps blocks
starting at `startBlockId`, exactly as if a "When green flag clicked" hat had
fired. The block handler never calls `util.startBranch()`, so the calling
script returns immediately without waiting.

### Runtime resolution order

The runtime is resolved via three fallback paths so the extension works in both
TurboWarp's interpreted mode and its compiled / warp mode:

1. Constructor-injected runtime (`ctorRuntime`) — most reliable
2. `Scratch.vm.runtime` — TurboWarp always exposes the global `Scratch.vm`
3. `util.target.runtime` / `util.thread.target.runtime` — standard scratch-vm path

Using only path 3 is fragile: in TurboWarp's compiled / warp mode the `util`
object may be a lightweight proxy where `target.runtime` is `undefined`. If
that access throws, the error propagates out of the block handler and TurboWarp
may fall back to executing the branch inline on the current thread, causing the
blocking behavior that would be reported as the fork not working.

### Thread scheduling

TurboWarp's sequencer iterates over all active threads each animation frame.
Pushing a thread appends it to that list; the sequencer picks it up on the next
frame, honoring all normal yielding and timing rules.

### Completion tracking

A 100 ms `setInterval` polls `thread.status` (checking for `STATUS_DONE = 4`)
and `runtime.threads.includes(thread)`. A `doneCalled` boolean flag ensures
`onDone` is called exactly once regardless of whether the interval or the
5-second watchdog fires first.

---

## Math mode internals (`03-worker.js`)

### Worker communication

1. The branch blocks are walked from the Scratch VM block container and
   converted to a plain JSON array by `_serialiseBlocks()`.
2. An inline Worker is created from a cached Blob URL — no extra file needed.
3. The block list and a variable snapshot are sent to the worker via
   `postMessage()`.
4. The worker evaluates each block using its own mini-interpreter covering
   standard Scratch math / logic opcodes.
5. The worker posts `{ variables }` back; the main thread applies any updated
   values to the live Scratch target.
6. The Worker is terminated and resources are freed.

The current Scratch thread never calls `util.startBranch()`, so it returns
immediately. The Worker runs in a separate OS thread; `postMessage` is the sole
communication channel — no shared memory is used — so the Scratch sequencer is
never blocked.

### Block serialization

`_serialiseBlocks()` walks the linear `block.next` chain starting at the branch
head. Each block is converted by `_serialiseBlock()`, which recursively
resolves reporter inputs: shadow blocks become `{ type: 'value', value }` and
reporter blocks become `{ type: 'block', block: ... }`.

### Variable handling

Variables are snapshotted by **ID** (not name) before being sent to the worker,
so sprite-local and global variables with the same display name remain distinct.
Updated values are matched by ID when applying results back to the target.

### Math mode interpreter

The in-worker interpreter covers the following Scratch opcode families and
matches Scratch VM semantics exactly:

- Arithmetic: `operator_add`, `operator_subtract`, `operator_multiply`,
  `operator_divide`, `operator_mod`
- Math functions: `operator_mathop` (all 16 variants)
- Random: `operator_random` (integer or float, bounds normalized)
- Comparison: `operator_lt`, `operator_gt`, `operator_equals` (Scratch-style
  numeric/string rules via `scratchCompare()`)
- Logic: `operator_and`, `operator_or`, `operator_not` (Scratch boolean
  coercion via `scratchBool()`)
- String: `operator_join`, `operator_letter_of`, `operator_length`
- Variables: `data_setvariableto`, `data_changevariableby` (keyed by variable
  ID so sprite-local and global variables with the same name stay distinct)

Variable changes are sent back to the main thread via `postMessage` and applied
after the worker terminates.

