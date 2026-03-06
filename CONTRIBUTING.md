# Contributing to Fork

Thank you for your interest in improving the Fork (`kxFork`) extension!

## Getting started

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
git clone https://github.com/kx1xixit/fork.git
cd fork
npm ci
```

### Build and test

```bash
npm run build      # compile src/ → build/extension.js
npm run test       # build + run tests
npm run lint       # ESLint check
npm run format     # Prettier auto-format
npm run validate   # validate extension structure
npm run fullstack  # format → lint → spellcheck → validate → build
```

## Project structure

```
src/
├── manifest.json   — Extension metadata (name, id, version, …)
├── 01-core.js      — ForkExtension class, getInfo(), block dispatcher
├── 02-threads.js   — Normal-mode async thread helper
└── 03-worker.js    — Math-mode Web Worker helper

docs/
├── fork.md         — Full technical documentation
└── example.md      — Usage examples
```

Source files are **concatenated in alphabetical order** by the build script.
Numbered prefixes (`01-`, `02-`, `03-`) control load order.
`export function` is stripped to a plain `function` declaration (hoisting).
All `name`/`text` strings inside `getInfo()` must use `Scratch.translate()`.

## Making changes

1. **Fork** the repository and create a branch from `main`.
2. Edit files in `src/`.
3. Run `npm run fullstack` to format, lint, and build.
4. Load `build/extension.js` in [TurboWarp](https://turbowarp.org) and verify
   your changes work as expected.
5. Open a pull request using the template — fill in every section.

## Code style

- Run `npm run format` before committing.
- Scratch globals (`BlockType`, `ArgumentType`, `Scratch`) are available in
  `src/` without importing — the IIFE wrapper provides them at runtime.
- Keep block handler methods free of side-effects on the Scratch thread.

## Releasing a new version

1. Update `version` in `src/manifest.json`.
2. Commit the bump and create a git tag:
   ```bash
   git tag v1.2.3
   git push origin main --tags
   ```
3. GitHub Actions builds the extension and creates a GitHub Release
   automatically.

## Questions?

Open an issue or start a discussion — all feedback is welcome!
