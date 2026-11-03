import assert from "node:assert/strict";
import test from "node:test";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { TranscriptView } from "../src/view.ts";
import type { TranscriptItem } from "../src/transcript.ts";

export const keybindings = { matches: (data: string, action: string) => {
  const keys: Record<string, string[]> = {
    "tui.select.up": ["up"], "tui.select.down": ["down"], "tui.select.pageUp": ["pageUp"],
    "tui.select.pageDown": ["pageDown"], "tui.select.confirm": ["enter"], "tui.select.cancel": ["escape", "ctrl+c"],
  };
  return (keys[action] ?? []).some((key) => matchesKey(data, key as Parameters<typeof matchesKey>[1]));
} } as Pick<KeybindingsManager, "matches">;
const item = (id: string, text: string, kind: TranscriptItem["kind"] = "user", folded = false): TranscriptItem => ({ id, text, kind, title: kind, folded, error: false });
const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
function view(items: TranscriptItem[], query = "", rows = () => 24) {
  let closed = false;
  const component = new TranscriptView({ items, query, theme, rows, keybindings, requestRender() {}, close() { closed = true; } });
  return { component, closed: () => closed };
}

test("opens at latest question and allows reaching pre-compaction text", () => {
  const { component } = view([item("a", "ORIGINAL"), item("b", "Summary", "compaction", true), item("c", "LATEST")]);
  assert.match(component.render(80).join("\n"), /LATEST/);
  component.handleInput("g");
  assert.match(component.render(80).join("\n"), /ORIGINAL/);
});

test("fold/unfold activity and search within originally folded content", () => {
  const data = [item("a", "Question"), item("b", "First line\nHIDDEN_NEEDLE", "activity", true)];
  const { component } = view(data);
  component.handleInput("G");
  assert.doesNotMatch(component.render(80).join("\n"), /HIDDEN_NEEDLE/);
  component.handleInput("\r");
  assert.match(component.render(80).join("\n"), /HIDDEN_NEEDLE/);
  assert.match(view(data, "HIDDEN_NEEDLE").component.render(80).join("\n"), /HIDDEN_NEEDLE/);
});

test("page navigation traverses long messages instead of truncating them", () => {
  const { component } = view([item("a", Array.from({ length: 100 }, (_, i) => `row-${i}`).join("\n"))]);
  component.render(80);
  component.handleInput("\x1b[6~");
  const page = component.render(80).join("\n");
  assert.doesNotMatch(page, /row-0\n/);
  assert.match(page, /row-2\d/);
  for (let i = 0; i < 10; i++) { component.handleInput("\x1b[6~"); component.render(80); }
  assert.match(component.render(80).join("\n"), /row-99/);
  component.handleInput("g");
  assert.match(component.render(80).join("\n"), /row-0/);
});

test("search supports pasted Chinese and cancel/clear/filter behavior", () => {
  const { component, closed } = view([item("a", "问题中文"), item("b", "英文 answer", "assistant")]);
  component.focused = true;
  component.handleInput("/");
  component.handleInput("\x1b[200~中文\x1b[201~");
  component.handleInput("\r");
  assert.match(component.render(80).join("\n"), /1\/1/);
  component.handleInput("c");
  component.handleInput("u");
  assert.match(component.render(80).join("\n"), /your prompts/);
  component.handleInput("/");
  component.handleInput("\x1b");
  assert.equal(closed(), false);
  component.handleInput("\x1b");
  assert.equal(closed(), true);
});

test("every line fits narrow/Unicode terminals, height is bounded across resize and theme invalidation", () => {
  let rows = 24;
  const { component } = view([item("a", "你好👨‍👩‍👧‍👦 café " .repeat(30))], "", () => rows);
  for (const width of [1, 2, 8, 20, 80, 160]) {
    for (rows of [3, 6, 24, 50]) {
      component.invalidate();
      const lines = component.render(width);
      assert.ok(lines.length <= Math.max(1, rows - 2));
      for (const line of lines) assert.ok(visibleWidth(line) <= width, `width ${width}: ${line}`);
    }
  }
});

test("handles empty branches and empty search results", () => {
  const empty = view([]).component;
  assert.match(empty.render(80).join("\n"), /No visible messages/);
  for (const key of ["G", "g", "j", "k", "\r", "\x1b[6~", "\x1b[5~"]) empty.handleInput(key);
  assert.match(view([item("a", "test")], "missing").component.render(80).join("\n"), /No matches/);
});

test("only wraps visible items; an unvisited large item is not read by render", () => {
  const huge = { ...item("a", ""), get text(): string { throw new Error("Unvisited item was wrapped"); } };
  // Filtering with an empty query does not read text, initial position is the latest question.
  const { component } = view([huge, item("b", "LATEST")]);
  assert.match(component.render(80).join("\n"), /LATEST/);
});

test("fullscreen wheel/click route to the reader and search pastes cannot replay escapes", () => {
  const { component } = view([item("a", "question"), item("b", "First\nDETAIL", "activity", true)]);
  component.handleInput("G");
  component.render(80);
  const mouse = { type: "click" as const, button: "left" as const, x: 1, y: 2, screenX: 1, screenY: 2, width: 80, height: 24, shift: false, alt: false, ctrl: false };
  assert.equal(component.handleMouse(mouse)?.handled, true);
  assert.match(component.render(80).join("\n"), /DETAIL/);
  assert.equal(component.handleMouse({ ...mouse, type: "wheel", wheelDelta: 3 })?.handled, true);
  component.handleInput("/");
  component.handleInput("\x1b[200~safe\x1b]52;c;YXR0YWNr\x07\x1b[201~");
  assert.doesNotMatch(component.render(80).join("\n"), /\x1b\]52|YXR0YWNr/);
});

test("dispose releases render state and stops handling input", () => {
  const { component, closed } = view([item("a", "test")]);
  component.dispose();
  assert.deepEqual(component.render(80), []);
  component.handleInput("q");
  assert.equal(closed(), false);
});
