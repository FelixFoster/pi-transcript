# pi-transcript

[![CI](https://github.com/FelixFoster/pi-transcript/actions/workflows/ci.yml/badge.svg)](https://github.com/FelixFoster/pi-transcript/actions/workflows/ci.yml)

**Your model can compact its context. You should still be able to read what you asked.**

A searchable conversation reader for [Pi](https://pi.dev). Find saved questions and answers from before compaction, fold noisy tool output inside the reader, and keep your latest question in view.

**This opens a separate reading window. It does not change the main chat's scrollback or the model's memory.**

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

## Get started in three steps

Already use Pi? Follow the steps below. The extension reuses Pi's own components; **you do not need to install a separate UI library**. See [compatibility](#compatibility-and-tests) for supported versions.

### 1. Install in your terminal

Run this in a terminal, not in Pi's chat input:

```bash
pi install git:github.com/FelixFoster/pi-transcript@v0.1.0
```

### 2. Load it in Pi

Back in Pi's chat input, enter:

```text
/reload
```

**`/reload` is Pi's built-in reload command, not a command added by this extension.** Alternatively, quit and restart Pi to load the extension at startup.

### 3. Open your history

In Pi, enter:

```text
/transcript
```

Press **Esc or q** to close the reader and return to chat. While editing a search, Esc first leaves search editing; press it again to close.

## What it does

- **Find old questions and answers:** read original pre-compaction turns still saved in the current branch.
- **Search by a phrase:** try `/transcript installation`. Search includes folded tool output and thinking, and supports Chinese text too.
- **See only your questions:** open the reader and press `u`.
- **Read with less clutter:** tool output and thinking are folded in the reader; Enter expands an entry. Error counts remain visible. The main chat is unchanged.
- **Keep your latest question in view:** an optional one-line preview appears above Pi's chat input.

The reader opens at your latest question and works in both regular and fullscreen modes. Home goes to the beginning; PgUp/PgDn page through long messages. It follows your selected conversation branch, including after `/tree`, `/new`, `/resume` and `/fork`.

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

`Ctrl+Shift+H` also opens the reader when your terminal forwards that key. Use `/transcript` if the shortcut is intercepted.

Standard selection keys honor Pi's injected keybindings. Mouse wheel scrolling and click-to-fold work when the host forwards mouse events (fullscreen mode). Regular mode remains keyboard-driven; the terminal owns its mouse scrollback.

Search filters entries and opens matching activity. With a long matching entry, the reader seeks to the first match that fits on a wrapped line; use PgUp/PgDn for the rest. It is not a regex search or a per-occurrence search navigator.

## Close, hide or disable

| What you want | What to do |
| --- | --- |
| Close the reader and return to chat | Press **Esc or q** in the reader; leave search editing with Esc first |
| Hide the latest-question preview | Back in Pi, enter `/transcript-pin`; enter it again to restore the preview |
| Disable the extension without removing it | Run `pi config` in a terminal, uncheck this extension, then run `/reload` in Pi |
| Remove the extension | See [Uninstall](#uninstall) below |

None of these actions deletes your conversation history. The `/transcript-pin` toggle resets on reload or session replacement. To start a run with the preview disabled, launch Pi from your terminal with:

```bash
pi --transcript-no-pin
```

The preview is deliberately short. `/transcript` contains the original full text.

## What it does NOT do

- **It does not restore history inline in Pi's main transcript or increase terminal scrollback.** Use `/transcript` for the independent reader.
- It does not prevent compaction, reduce tokens, change model context, or make the model remember old turns.
- It does not replace Pi's internal methods or alter the main chat renderer.
- It does not append duplicate messages, modify session files, export history, contact a server, or send telemetry.
- It does not show sibling branches; select a branch with Pi's `/tree`, then reopen the reader.
- It cannot recover text already truncated by a tool, deleted from storage, absent from an imported session, or never saved. Images are placeholders; provider metadata, extension state and hidden custom messages are not dumped.
- It shows saved text as **plain text**, not a full clone of Pi's Markdown/diff/image renderers.
- The reader is a **snapshot** at open time, not a live streaming mirror. Close and reopen to refresh.

It takes linear time/memory to project and search the saved text. Virtualized wrapping avoids rendering the entire transcript, but this is not an on-disk database or an unlimited-memory history system.

## Compatibility and tests

- **Pi:** tested on 0.85.1 and 1.5.0, in both regular and fullscreen modes.
- **Node.js:** requires 22.19 or newer; tested on Node.js 22 and 24.
- **Distribution:** those tests use `@earendil-works/pi-coding-agent`. Other versions, distributions and forks are unverified.

`@earendil-works` is the publisher prefix in Pi's npm package name, **not another application to install or a service to sign up for**. The extension reuses Pi's UI components and does not install a second copy of Pi.

Install this release using the GitHub command above; there is no npm publication yet. Developers can find dependency declarations in [package.json](package.json) and implementation details in [Architecture](docs/architecture.md).

To try the source from a local checkout without saving an install:

```bash
pi -e ./src/index.ts
```

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

Run the command above in a terminal. Then enter `/reload` in Pi, or restart Pi. The preview and extension status are cleared; your conversation history is unchanged. For a temporary `-e` load, restart without that argument.

## Why a separate reader?

Model context and human-visible history have different lifetimes. A display extension should not change the contract of the model's context builder just to recover a user-visible transcript. Public read-only session APIs plus a custom UI provide a smaller, less version-sensitive boundary.

The problem was explored alongside [`pi-tui-history-replay`](https://github.com/Molaison/pi-tui-history-replay). This is an independent implementation with a different interface and architecture, not a renamed copy or a fork. We appreciate that project's work on separating display history from model context.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please use **synthetic/redacted** fixtures in issues. Never attach real session JSONL files, API keys or private source code.

MIT © FelixFoster.
