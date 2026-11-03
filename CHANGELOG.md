# Changelog

## 0.1.0

- Add `/transcript [query]`, a public-API-only, read-only active-branch history viewer.
- Preserve access to original pre-compaction text without changing model context.
- Fold consecutive thinking/tool activity; keep error counts visible.
- Add literal search, prompts-only filtering, paging, Unicode-aware wrapping and fullscreen mouse support.
- Add a latest-question preview, `/transcript-pin` and `--transcript-no-pin`.
- Clean up overlays/widgets/status on session shutdown and reload.
- Add host integration tests and isolated CLI PTY tests for regular/fullscreen modes.
- Distribute via GitHub under the MIT license. No npm release yet.
