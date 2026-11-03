import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InteractiveMode, SessionManager, type ExtensionAPI, type ExtensionContext, type RegisteredCommand } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { projectTranscript } from "../src/transcript.ts";

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "pi-transcript-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "session.jsonl");
  const timestamp = "2026-01-01T00:00:00.000Z";
  const entries = [
    { type: "session", version: 3, id: "11111111-1111-4111-8111-111111111111", timestamp, cwd: dir },
    { type: "message", id: "11111111", parentId: null, timestamp, message: { role: "user", content: "OLD_QUESTION", timestamp: 1 } },
    { type: "message", id: "22222222", parentId: "11111111", timestamp, message: { role: "user", content: "LATEST_QUESTION", timestamp: 2 } },
    { type: "compaction", id: "33333333", parentId: "22222222", timestamp, summary: "Synthetic summary", firstKeptEntryId: "22222222", tokensBefore: 80000 },
  ];
  writeFileSync(path, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return { sm: SessionManager.open(path), path };
}

function harness(sm: SessionManager, mode = "tui") {
  type Handler = (event: never, ctx: ExtensionContext) => unknown;
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, RegisteredCommand>();
  const widgets = new Map<string, unknown>();
  const statuses = new Map<string, unknown>();
  let customCalls = 0;
  const api = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerCommand: (name: string, command: RegisteredCommand) => commands.set(name, command),
    registerFlag() {}, registerShortcut() {}, getFlag: () => false,
  } as unknown as ExtensionAPI;
  extension(api);
  const ctx = {
    mode, hasUI: mode === "tui" || mode === "rpc", sessionManager: sm,
    ui: {
      setWidget: (key: string, value: unknown) => widgets.set(key, value),
      setStatus: (key: string, value: unknown) => statuses.set(key, value),
      notify() {},
      async custom() { customCalls++; },
    },
  } as unknown as ExtensionContext;
  return {
    commands, widgets, statuses, ctx,
    customCalls: () => customCalls,
    emit: (name: string, event = {}) => handlers.get(name)?.(event as never, ctx),
    command: (name: string, args = "") => commands.get(name)!.handler(args, ctx as Parameters<RegisteredCommand["handler"]>[1]),
  };
}

test("real SessionManager: original history is visible, model context/file/methods stay unchanged", async (t) => {
  const { sm, path } = fixture(t);
  const context = structuredClone(sm.buildSessionContext());
  const entries = structuredClone(sm.getEntries());
  const descriptors = Object.getOwnPropertyDescriptors(sm);
  const bytes = readFileSync(path, "utf8");
  const h = harness(sm);
  await h.emit("session_start");
  await h.emit("session_compact", { compactionEntry: sm.getEntry("33333333") });
  await h.command("transcript", "OLD_QUESTION");
  assert.match(JSON.stringify(projectTranscript(sm.getBranch())), /OLD_QUESTION/);
  assert.doesNotMatch(JSON.stringify(sm.buildSessionContext()), /OLD_QUESTION/);
  assert.deepEqual(sm.buildSessionContext(), context);
  assert.deepEqual(sm.getEntries(), entries);
  assert.deepEqual(Object.getOwnPropertyDescriptors(sm), descriptors);
  assert.equal(readFileSync(path, "utf8"), bytes);
  assert.equal(h.customCalls(), 1);
});

test("real Pi compaction-end handler still succeeds after our session_compact hook", async (t) => {
  const { sm } = fixture(t);
  const h = harness(sm);
  await h.emit("session_start");
  await h.emit("session_compact", { compactionEntry: sm.getEntry("33333333") });
  let cleared = false;
  let flushed = false;
  const host = {
    sessionManager: sm, isInitialized: true, footer: { invalidate() {} },
    programStatus: { handleEvent() {} },
    settingsManager: { getShowTerminalProgress: () => false }, clearStatusIndicator() {},
    chatContainer: { clear() { cleared = true; } },
    renderSessionEntries() {}, addMessageToChat() {},
    flushCompactionQueue() { flushed = true; }, ui: { requestRender() {} },
  };
  // Private UI method is exercised ONLY in this regression test, never in the extension.
  await Reflect.apply(Reflect.get(InteractiveMode.prototype, "handleEvent"), host, [{
    type: "compaction_end", reason: "manual", aborted: false, willRetry: false,
    result: { summary: "Synthetic summary", firstKeptEntryId: "22222222", tokensBefore: 80000 },
  }]);
  assert.equal(cleared, true);
  assert.equal(flushed, true);
});

test("reload lifecycle: cleanup is idempotent, replacement works immediately without patches", async (t) => {
  const { sm } = fixture(t);
  const original = sm.buildContextEntries;
  const h = harness(sm);
  await h.emit("session_start", { reason: "reload" });
  assert.equal(typeof h.widgets.get("pi-transcript"), "function");
  await h.command("transcript");
  await h.emit("session_shutdown", { reason: "reload" });
  await h.emit("session_shutdown", { reason: "reload" });
  assert.equal(h.widgets.get("pi-transcript"), undefined);
  assert.equal(h.statuses.get("pi-transcript"), undefined);
  assert.equal(sm.buildContextEntries, original);
  const replacement = harness(sm);
  await replacement.emit("session_start", { reason: "reload" });
  await replacement.command("transcript", "OLD_QUESTION");
  assert.equal(replacement.customCalls(), 1);
});

test("shutdown closes an open overlay and duplicate opens are ignored", async (t) => {
  const { sm } = fixture(t);
  const h = harness(sm);
  let opened = 0;
  let disposed = 0;
  h.ctx.ui.custom = ((factory: (a: unknown, b: unknown, c: unknown, done: () => void) => { dispose?: () => void }) => new Promise<void>((resolve) => {
    opened++;
    const component = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, () => {
      component.dispose?.();
      disposed++;
      resolve();
    });
  })) as typeof h.ctx.ui.custom;
  const running = h.command("transcript");
  await h.command("transcript");
  assert.equal(opened, 1);
  await h.emit("session_shutdown", { reason: "reload" });
  await running;
  await h.emit("session_shutdown", { reason: "reload" });
  assert.equal(disposed, 1);
});

test("real branch navigation does not leak sibling-branch messages", async (t) => {
  const { sm } = fixture(t);
  sm.branch("11111111");
  const newId = sm.appendMessage({ role: "user", content: "OTHER_BRANCH", timestamp: 3 });
  const items = projectTranscript(sm.getBranch());
  assert.match(JSON.stringify(items), /OTHER_BRANCH/);
  assert.doesNotMatch(JSON.stringify(items), /LATEST_QUESTION|Synthetic summary/);
  sm.branch("33333333");
  assert.doesNotMatch(JSON.stringify(projectTranscript(sm.getBranch())), /OTHER_BRANCH/);
  assert.ok(sm.getEntry(newId));
});

test("print/json/rpc modes never read the branch, change UI widgets or open a viewer", async () => {
  const forbidden = new Proxy({}, { get() { throw new Error("Non-TUI touched session state"); } }) as SessionManager;
  for (const mode of ["print", "json", "rpc"]) {
    const h = harness(forbidden, mode);
    for (const name of ["session_start", "session_tree", "session_compact", "session_shutdown"]) await h.emit(name);
    await h.emit("message_end", { message: { role: "user", content: "x" } });
    await h.command("transcript");
    await h.command("transcript-pin");
    assert.equal(h.widgets.size, 0);
    assert.equal(h.statuses.size, 0);
    assert.equal(h.customCalls(), 0);
  }
});

test("latest-question preview updates on user messages, can be disabled and clears on a new empty session", async (t) => {
  const { sm } = fixture(t);
  const h = harness(sm);
  await h.emit("session_start");
  await h.emit("message_end", { message: { role: "user", content: "NEW_QUESTION" } });
  const widget = h.widgets.get("pi-transcript") as (tui: unknown, theme: unknown) => { render(width: number): string[] };
  assert.match(widget({}, { fg: (_: string, text: string) => text }).render(80).join(""), /NEW_QUESTION/);
  await h.command("transcript-pin");
  assert.equal(h.widgets.get("pi-transcript"), undefined);
  await h.emit("session_shutdown");
  const fresh = harness(SessionManager.inMemory());
  await fresh.emit("session_start", { reason: "new" });
  assert.equal(fresh.widgets.get("pi-transcript"), undefined);
});
