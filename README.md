# pi-transcript

**Your model can compact its context. You should still be able to read what you asked.**

A read-only conversation viewer for [Pi](https://pi.dev), built with public extension APIs. Open `/transcript` to read and search the active branch **including messages before compaction**. Tool output and thinking are folded by default; your latest question stays in a small preview above the editor.

[简体中文](README.zh-CN.md) · [Architecture](docs/architecture.md) · [Security](SECURITY.md)

```text
Transcript · 1/8 · active branch · read-only snapshot

▾ You
  Why did this test fail?
▸ Activity: 2 tool calls · 2 results · 1 thinking block
▾ Assistant
  The fixture used a different timezone.
▸ Context compacted — original messages remain above

↑↓ entries · PgUp/PgDn scroll · Enter fold · Home/End jump
/ search · u prompts only · c clear · Esc/q close
```

*Illustrative layout, not a screenshot of a real conversation.*

## Install

Requires Node.js **22.19+** and the `@earendil-works` distribution of Pi.

```bash
pi install git:github.com/FelixFoster/pi-transcript@v0.1.0
```

Then run `/reload` in Pi. Open the reader with:

```text
/transcript
/transcript a phrase from your earlier question
```

`Ctrl+Shift+H` also opens the reader when your terminal forwards that key. Use the command if the shortcut conflicts with your terminal or another extension.

To try the local source without saving an install:

```bash
pi -e ./src/index.ts
```

This release is distributed via **GitHub**. There is no npm publication to install yet.

## What it does

- Reads original messages from `sessionManager.getBranch()`, not the compacted model context.
- Opens at your latest question; Home goes back to the beginning.
- Searches text literally, case-insensitively, including inside folded thinking/tool output. Chinese text works too.
- Groups consecutive execution activity into a folded row. Error counts stay visible while folded.
- Pages through long messages and wraps only visible/visited items, with a 32-item render cache.
- Uses an overlay in both Pi's regular and fullscreen modes.
- Displays a one-line latest-question preview above the editor, so tools and compaction don't push it out of sight.
- Respects the active branch, including after `/tree`, `/new`, `/resume` and `/fork`.

## Reader controls

| Key | Action |
| --- | --- |
| ↑ / ↓ or k / j | Previous / next entry |
| PgUp / PgDn | Scroll within and across long entries |
| Home / End or g / G | First / last entry |
| Enter / Space | Fold / unfold the current entry |
| / or Ctrl+F | Enter a search; Enter applies, Esc cancels editing |
| n / N | Next / previous entry in the filtered results |
| u | Toggle your prompts only |
| c | Clear the search |
| Esc / q | Close without changing the conversation |

Standard selection keys honor Pi's injected keybindings. Mouse wheel scrolling and click-to-fold work when the host forwards mouse events (fullscreen mode). Regular mode remains keyboard-driven; the terminal owns its mouse scrollback.

Search filters entries and opens matching activity. With a long matching entry, the reader seeks to the first match that fits on a wrapped line; use PgUp/PgDn for the rest. It is not a regex search or a per-occurrence search navigator.

### Latest-question preview

`/transcript-pin` toggles the preview for the current runtime. It resets on reload or session replacement. To disable it for a run:

```bash
pi --transcript-no-pin
```

The preview is deliberately short. `/transcript` contains the original full text.

## What it does NOT do

- **It does not restore history inline in Pi's main transcript or increase terminal scrollback.** Use `/transcript` for the independent reader.
- It does not prevent compaction, reduce tokens, change model context, or make the model remember old turns.
- It does not monkey-patch `buildContextEntries()`, `buildSessionContext()`, the renderer, or any prototype.
- It does not append duplicate messages, modify session files, export history, contact a server, or send telemetry.
- It does not show sibling branches; select a branch with Pi's `/tree`, then reopen the reader.
- It cannot recover text already truncated by a tool, deleted from storage, absent from an imported session, or never saved. Images are placeholders; provider metadata, extension state and hidden custom messages are not dumped.
- It shows saved text as **plain text**, not a full clone of Pi's Markdown/diff/image renderers.
- The reader is a **snapshot** at open time, not a live streaming mirror. Close and reopen to refresh.

It takes linear time/memory to project and search the saved text. Virtualized wrapping avoids rendering the entire transcript, but this is not an on-disk database or an unlimited-memory history system.

## Compatibility and tests

The supported test matrix targets **Pi 0.85.1 and 1.5.0**, Node.js 22 and 24. Other versions are unverified, not implicitly supported by the wildcard peer dependencies. Those peers follow Pi's package conventions and are optional so installation does not pull in a second host runtime.

Tests cover:

- Pure projection, multiple compactions, retained-tail checkpoints without duplication, branch isolation, hidden content, errors and terminal escape sanitization.
- Search, folding, paging, Unicode, tiny terminals, resizing and disposal.
- Real `SessionManager` context/file/method invariance and the real Pi compaction-end UI handler.
- Reload/shutdown hook cleanup and non-interactive mode isolation.
- **Real CLI PTY smoke tests** in regular and fullscreen modes: recover old turns, search folded tool output, resize, `/reload`, reopen and exit cleanly.

The PTY tests use a temporary HOME, synthetic sessions and offline startup. They make **no model calls** and never open your real sessions. They are not a live-provider end-to-end compaction test; the compaction completion regression uses the actual host handler with stub UI services.

```bash
npm ci --ignore-scripts
npm run check
python3 tests/pty_smoke.py  # Linux/macOS; Python 3 standard library only
```

## Uninstall

```bash
pi remove git:github.com/FelixFoster/pi-transcript
```

Run `/reload`. The preview/status are cleared by shutdown and there are no patched methods to undo. Your session files are unchanged. For a temporary `-e` load, restart without that argument.

## Why a separate reader?

Model context and human-visible history have different lifetimes. A display extension should not change the contract of the model's context builder just to recover a user-visible transcript. Public read-only session APIs plus a custom UI provide a smaller, less version-sensitive boundary.

The problem was explored alongside [`pi-tui-history-replay`](https://github.com/Molaison/pi-tui-history-replay). This is an independent implementation with a different interface and architecture, not a renamed copy or a fork. We appreciate that project's work on separating display history from model context.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please use **synthetic/redacted** fixtures in issues. Never attach real session JSONL files, API keys or private source code.

MIT © FelixFoster.
