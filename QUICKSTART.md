# Quick Start — Fork Extension

Get the Fork (`kxFork`) extension running in TurboWarp in under 5 minutes.

## Option A — Use a pre-built release

1. Download the latest `extension.js` from the
   [Releases](../../releases/latest) page.
2. Go to [turbowarp.org](https://turbowarp.org).
3. Click **Add Extension → Load Custom Extension**.
4. Upload `extension.js`.
5. The **Fork** block category appears in the palette — you're done!

---

## Option B — Build from source

### Prerequisites

- Node.js 18+ ([Download](https://nodejs.org/))

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/kx1xixit/fork.git
cd fork

# 2. Install dependencies
npm install

# 3. Build the extension
npm run build
# → build/extension.js is created
```

Then load `build/extension.js` into TurboWarp as described in Option A.

---

## Using the Fork block

The extension adds one C-block to TurboWarp:

```text
run in [normal ▼] mode
┌──────────────────────┐
│  … blocks …          │
└──────────────────────┘
```

### Normal mode

Runs the enclosed blocks in a new Scratch VM thread.
The rest of your script continues **immediately** without waiting.

```text
when green flag clicked
run in [normal] mode
┌─────────────────────┐
│ wait (2) secs       │
│ say [done!]         │
└─────────────────────┘
say [this runs first]   ← appears before "done!"
```

### Math mode

Runs the enclosed blocks inside a Web Worker.
Use this for CPU-intensive arithmetic so the UI stays responsive.

```text
run in [math] mode
┌──────────────────────────────────────┐
│ set [result v] to ((bigNum) * (bigNum))│
└──────────────────────────────────────┘
```

After the worker finishes, any variable changes are synced back to Scratch.

---

## Common commands (development)

| Command | What it does |
|---------|--------------|
| `npm run build` | Build `src/` → `build/extension.js` |
| `npm run watch` | Rebuild automatically on file changes |
| `npm run lint` | Check for code errors |
| `npm run test` | Build and run tests |

---

## Need help?

- Full block reference: [`docs/fork.md`](docs/fork.md)
- Usage examples: [`docs/example.md`](docs/example.md)
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Open an issue: [Issues](../../issues/new)
