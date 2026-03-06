# Fork Extension — Examples

## Example 1 — Parallel countdown

Run two countdowns at the same time.

```text
when green flag clicked
set [A v] to [5]
set [B v] to [5]

run in [normal v] mode
┌────────────────────────────────────┐
│ repeat (5)                         │
│   change [A v] by (-1)             │
│   wait (1) secs                    │
└────────────────────────────────────┘

repeat (5)
  change [B v] by (-1)
  wait (1) secs
```

Both loops run concurrently. `A` and `B` decrement in parallel rather than
one after the other.

---

## Example 2 — Fire-and-forget animation

Play a sound effect while an animation runs without pausing the main script.

```text
when green flag clicked
run in [normal v] mode
┌───────────────────────────────┐
│ play sound [pop v] until done │
└───────────────────────────────┘
move (10) steps        ← executes immediately, doesn't wait for sound
```

---

## Example 3 — Offload heavy arithmetic to a Web Worker

Compute a large value without freezing the stage.

```text
when green flag clicked
set [n v] to [1000000]
run in [math v] mode
┌──────────────────────────────────────────┐
│ set [result v] to ((n) * ((n) + (1)))    │
└──────────────────────────────────────────┘
say [calculating…]
```

After the worker finishes, `result` contains the answer and the `say` block
has already appeared — the UI was never blocked.

---

## Debugging tips

- Place a `say` block **directly after** the C-block. If the fork is working
  correctly, that `say` block executes before the forked branch finishes —
  confirming the two paths are running concurrently.
- Open the browser console and run:
  ```javascript
  globalThis.FORK_DEBUG = true;
  ```
  You will see console log messages prefixed with `[Fork]` that describe
  when forked threads are created and when their branches finish.

---

For a full technical reference see [`docs/fork.md`](fork.md).
