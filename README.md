# Introduction to Fork

A TurboWarp/Scratch extension that adds a single C-block for running enclosed
blocks **concurrently** with the rest of the script.

## Block

```text
run in [normal ▼] mode
┌──────────────────────┐
│  … blocks …          │
└──────────────────────┘
```

| Mode | Behaviour |
|------|-----------|
| `normal` | Forks the branch into a new Scratch VM thread. The calling script returns immediately; the branch runs on the next scheduler tick. |
| `math` | Serialises the branch to JSON, runs it in an inline Web Worker, then syncs any variable changes back to the main thread. Suitable for CPU-intensive arithmetic that would otherwise block the UI. |

## Throttle limits

| Resource | Cap |
|----------|-----|
| Concurrent forked threads (`normal` mode) | 64 |
| Concurrent Web Workers (`math` mode) | 8 |

Both modes emit `console.warn` and skip the fork when their cap is reached.
Both modes include a **5-second watchdog** that releases the slot automatically
if the thread or worker never finishes.

## Using the extension

1. Download the latest `extension.js` from the [Releases](../../releases) page,
   **or** build it yourself (see [Development](#development) below).
2. Go to [turbowarp.org](https://turbowarp.org).
3. Click **Add Extension → Load Custom Extension**.
4. Upload or paste the URL of `extension.js`.
5. The **Fork** category will appear in the block palette.

For usage examples see [`docs/example.md`](docs/example.md).
For a full technical reference see [`docs/fork.md`](docs/fork.md).

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
git clone https://github.com/kx1xixit/fork.git
cd fork
npm ci
```

### Common commands

| Command | What it does |
|---------|--------------|
| `npm run build` | Compile `src/` → `build/extension.js` |
| `npm run watch` | Rebuild automatically on file changes |
| `npm run lint` | Run ESLint on `src/` |
| `npm run format` | Auto-format `src/` with Prettier |
| `npm run test` | Build and run the test suite |
| `npm run validate` | Validate extension structure |
| `npm run fullstack` | Format → lint → spellcheck → validate → build |

### Project structure

```
src/
├── manifest.json   — Extension metadata (name, id, version, …)
├── 01-core.js      — ForkExtension class, getInfo(), block dispatcher
├── 02-threads.js   — Normal-mode async thread helper
└── 03-worker.js    — Math-mode Web Worker helper

build/
└── extension.js    — Compiled output (do not edit)

scripts/
├── build.js        — Build script
├── test.js         — Test runner
└── validate.js     — Validates the compiled extension

docs/
├── fork.md         — Full technical documentation
└── example.md      — Usage examples
```

## CI/CD

- **CI** (`ci.yml`) — Builds and tests on every push / pull request.
- **CD** (`cd.yml`) — Creates a GitHub Release and uploads `extension.js`
  automatically when a tag such as `v1.0.0` is pushed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

KXEC-1.1 — see [LICENSE](LICENSE).
