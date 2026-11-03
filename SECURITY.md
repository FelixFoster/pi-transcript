# Security

## Data boundary

This extension reads the **current active branch** from Pi's already-loaded SessionManager and renders a local UI. It does not open other sessions, write files, call models, spawn processes, make network requests, send telemetry or export content. It registers no model-callable tool and no context/prompt transformer.

It uses public extension APIs only. No instance or prototype methods are replaced. On session shutdown/reload, it closes its reader and removes its own widget/status.

Any Pi extension still executes with the host process's full permissions. These are implementation boundaries, not a sandbox. Review the source before installing, and pin a release tag or commit.

## Terminal content

Stored tool output is untrusted display data. ANSI/OSC escape sequences, control characters and bidi override/isolate controls are removed. Text is rendered as plain text; URLs are not automatically opened, image payloads are not decoded, and clipboard escape sequences are not replayed. Images are represented by placeholders.

Hidden custom messages, arbitrary custom-entry state, tool `details`, and provider metadata are not dumped. Ordinary visible tool arguments/output may still contain sensitive information from your conversation. Folding is **not** redaction: opening/searching an item can reveal that information on screen. Be careful when screen sharing.

## Testing and reports

Tests use synthetic sessions and temporary directories. Do not submit real session logs, credentials, private file paths or source code with bug reports.

Report security issues through the repository's private vulnerability reporting feature when enabled. If it is unavailable, open an issue requesting a private reporting channel **without including the vulnerability details or sensitive data**. Do not post exploit payloads containing real data.

Supported release: 0.1.x. Compatibility is limited to the versions actually tested in CI; other Pi versions are unverified.
