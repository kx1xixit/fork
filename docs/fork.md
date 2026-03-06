# Fork Extension (`kxFork`)

Provides a single C-block that runs the enclosed branch concurrently with the
rest of the script.

## Block

```
run in [normal ▼] mode
```

| Mode | Behaviour |
|------|-----------|
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

## Debugging async behaviour

1. Add a `say "Done"` block **directly after** the C-block. It will appear
   before the forked branch's output when the fork is working.
2. Open the browser console and type `globalThis.FORK_DEBUG = true`. You will
   see timestamped `[Fork] New thread created` / `[Fork] Branch thread finished`
   logs.

## Math mode interpreter

The in-worker interpreter covers the following Scratch opcode families and
matches Scratch VM semantics exactly:

- Arithmetic: `operator_add`, `operator_subtract`, `operator_multiply`,
  `operator_divide`, `operator_mod`
- Math functions: `operator_mathop` (all 16 variants)
- Random: `operator_random` (integer or float, bounds normalised)
- Comparison: `operator_lt`, `operator_gt`, `operator_equals` (Scratch-style
  numeric/string rules via `scratchCompare()`)
- Logic: `operator_and`, `operator_or`, `operator_not` (Scratch boolean
  coercion via `scratchBool()`)
- String: `operator_join`, `operator_letter_of`, `operator_length`
- Variables: `data_setvariableto`, `data_changevariableby` (keyed by variable
  ID so sprite-local and global variables with the same name stay distinct)

Variable changes are sent back to the main thread via `postMessage` and applied
after the worker terminates.
