import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { contentText, latestPrompt, projectTranscript } from "./transcript.ts";
import { TranscriptView } from "./view.ts";

const UI_KEY = "pi-transcript";

export default function transcriptExtension(pi: ExtensionAPI): void {
  let prompt: string | undefined;
  let pin = true;
  let open = false;
  let closeViewer: (() => void) | undefined;

  pi.registerFlag("transcript-no-pin", {
    description: "Disable the latest-question preview above the editor",
    type: "boolean",
    default: false,
  });

  function updateWidget(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui") return;
    if (!pin || prompt === undefined) {
      ctx.ui.setWidget(UI_KEY, undefined);
      return;
    }
    const preview = prompt.replace(/\s+/g, " ");
    ctx.ui.setWidget(UI_KEY, (_tui, theme) => ({
      render: (width) => [truncateToWidth(theme.fg("muted", `You: ${preview}  [/transcript]`), width, "…")],
      invalidate() {},
    }));
  }

  function refresh(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui") return;
    prompt = latestPrompt(ctx.sessionManager.getBranch());
    updateWidget(ctx);
    ctx.ui.setStatus(UI_KEY, "/transcript");
  }

  async function show(query: string, ctx: ExtensionContext): Promise<void> {
    if (ctx.mode !== "tui") {
      if (ctx.hasUI) ctx.ui.notify("/transcript is a terminal-only, read-only viewer.", "info");
      return;
    }
    if (open) return;
    open = true;
    try {
      const items = projectTranscript(ctx.sessionManager.getBranch());
      await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
        let closed = false;
        closeViewer = () => {
          if (closed) return;
          closed = true;
          done();
        };
        return new TranscriptView({
          items, query, theme, keybindings,
          rows: () => tui.terminal.rows,
          requestRender: () => tui.requestRender(),
          close: closeViewer,
        });
      }, {
        overlay: true,
        overlayOptions: { width: "100%", maxHeight: "100%", margin: 1 },
      });
    } finally {
      closeViewer = undefined;
      open = false;
    }
  }

  pi.registerCommand("transcript", {
    description: "Read/search the full active branch, including pre-compaction messages: /transcript [text]",
    handler: (args, ctx) => show(args, ctx),
  });
  pi.registerShortcut("ctrl+shift+h", {
    description: "Open the full read-only transcript",
    handler: (ctx) => show("", ctx),
  });
  pi.registerCommand("transcript-pin", {
    description: "Toggle the latest-question preview for this runtime (no settings written)",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") return;
      pin = !pin;
      updateWidget(ctx);
      ctx.ui.notify(`Latest-question preview ${pin ? "on" : "off"}.`, "info");
    },
  });
  pi.on("session_start", (_event, ctx) => {
    pin = pi.getFlag("transcript-no-pin") !== true;
    refresh(ctx);
  });
  pi.on("session_tree", (_event, ctx) => refresh(ctx));
  pi.on("session_compact", (_event, ctx) => refresh(ctx));
  pi.on("message_end", (event, ctx) => {
    if (ctx.mode !== "tui" || event.message.role !== "user") return;
    prompt = contentText(event.message.content) || "[empty message]";
    updateWidget(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    closeViewer?.();
    closeViewer = undefined;
    prompt = undefined;
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget(UI_KEY, undefined);
    ctx.ui.setStatus(UI_KEY, undefined);
  });
}
