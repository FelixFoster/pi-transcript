# Architecture

```text
Pi session JSONL (owned by Pi)
        ↓ Pi loads/navigates the session
SessionManager.getBranch() — read-only public API
        ↓ snapshot on /transcript
Pure display projection
        ↓
Custom overlay viewport → human reader

Pi's model context / compaction pipeline — untouched
```

## Why not replace buildContextEntries?

The host uses the context entry list for lifecycle-sensitive UI work as well as defining context semantics. For example, Pi 0.85.1's compaction-end handler requires its first entry to be the latest compaction, before rendering the retained entries and adding the summary at its chronological position. Returning an arbitrary full branch violates that contract.

This project does not intercept that path. The normal main transcript retains Pi's native behavior. A separate command gets the uncompressed branch for display through supported APIs.

## Projection

Original messages are shown once in branch order. Compaction records become folded summary markers at their chronological position. `retainedTail`, when present on a checkpoint, is not replayed as a second copy of messages.

Consecutive thinking, tool calls and results are grouped into activity rows; assistant text between activities remains at its original position. Failures are marked in the folded row's title. Shell-command context exclusion/truncation markers are preserved.

Custom entries are not assumed to be display text. Only custom messages explicitly marked `display: true` are shown; metadata/details and hidden messages remain hidden. Images become placeholders. Unsupported content is not guessed or decoded.

## Lifecycle

The factory registers commands, a shortcut, a flag and event handlers. It starts no process, timer, listener or filesystem watcher.

- `session_start`: reconstruct the latest-question preview from the current branch.
- `message_end` (user): update the preview from the actual event message.
- `session_compact` / `session_tree`: refresh preview using the active branch; do not change compaction/navigation.
- `/transcript`: make a fresh display snapshot; open `ctx.ui.custom()` as an overlay.
- `session_shutdown`: close any open viewer; clear the extension's widget/status. Safe to repeat.

No monkey patch, alternate history store, persisted view state or promotion of a display entry into model context is involved. Removing the extension and reloading leaves nothing installed on a long-lived SessionManager.

## Rendering and complexity

The viewport tracks an item index plus a line offset. It wraps visible/visited items lazily and caches at most 32 item layouts. Navigation avoids assembling one giant rendered screen. Theme changes invalidate the layout cache; terminal resizes reflow text. Display width is bounded using Pi's Unicode-aware helpers.

Projection/search still process all visible text in the snapshot, and one very large expanded item can occupy a large cache entry. This design is deliberately not an infinite-history database. The snapshot is released when the overlay is closed.

## Verification boundary

Unit tests check pure data and UI behavior. Integration tests use the real SessionManager plus the host's actual compaction-end handler with synthetic UI services. The CLI smoke tests run a real Pi in a real pseudoterminal with an isolated HOME and synthetic saved compaction, in both regular/fullscreen modes. They test search, resize and reload, not remote LLM provider behavior.
