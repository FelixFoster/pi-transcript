# Contributing

Use Node.js 22.19+.

```bash
npm ci --ignore-scripts
npm run check
python3 tests/pty_smoke.py
```

The PTY smoke test requires Linux/macOS and Python 3, without third-party Python packages. Unit/integration tests use Node's built-in test runner. See the CI workflow for the supported host matrix.

## Non-negotiable boundaries

- Keep the production extension on public Pi APIs.
- Do not monkey-patch context builders, renderers, SessionManager or prototypes.
- Do not append transcript copies to sessions or inject content into model context.
- No network calls, shell execution, analytics, automatic exports or background resources.
- Preserve branch isolation and hidden-message boundaries.
- Treat tool/session text as untrusted terminal data.
- Test cleanup, reload, compaction, non-TUI modes and narrow Unicode terminals.
- Use only synthetic/redacted fixtures. Never commit real sessions or local credentials.

The regression suite intentionally calls a private host UI handler to check compatibility. That is test-only code and is not a precedent for production imports.

## Review/release checklist

1. `npm run check` and the PTY suite pass for each supported Pi version.
2. Inspect `npm pack --dry-run --ignore-scripts` and Git tracked files for private content.
3. Update both READMEs and CHANGELOG; describe limitations honestly.
4. Do not claim live-provider coverage when a test uses synthetic compaction events.
5. Only then create a version tag and GitHub release. Publishing to npm is a separate action.

## Code structure

- `src/transcript.ts`: pure display projection and terminal sanitization.
- `src/view.ts`: keyboard/mouse reader and bounded viewport.
- `src/index.ts`: public extension registration and lifecycle wiring.
- `tests/`: projections, UI, real-host regression and isolated CLI smoke tests.
