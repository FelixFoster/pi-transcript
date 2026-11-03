import assert from "node:assert/strict";
import test from "node:test";
import { contentText, filterTranscript, latestPrompt, plainText, projectTranscript } from "../src/transcript.ts";

const msg = (id: string, role: string, content: unknown, extra = {}) => ({ type: "message", id, message: { role, content, ...extra } });

test("preserves chronological original messages across multiple compactions without replaying retainedTail", () => {
  const entries = [msg("a", "user", "Old question"), msg("b", "assistant", [{ type: "text", text: "Old answer" }]),
    { type: "compaction", id: "c", summary: "Summary one", retainedTail: [{ role: "user", content: "DO NOT DUPLICATE" }] },
    msg("d", "user", "Latest question"), { type: "compaction", id: "e", summary: "Summary two" }];
  const before = structuredClone(entries);
  const items = projectTranscript(entries);
  assert.deepEqual(items.map((item) => item.kind), ["user", "assistant", "compaction", "user", "compaction"]);
  assert.deepEqual(entries, before);
  assert.equal(items.some((item) => item.text.includes("DO NOT DUPLICATE")), false);
  assert.equal(latestPrompt(entries), "Latest question");
});

test("coalesces consecutive execution activity and keeps errors visible while folded", () => {
  const items = projectTranscript([
    msg("a", "assistant", [{ type: "thinking", thinking: "Reasoning" }, { type: "toolCall", name: "bash", arguments: { command: "echo test" } }]),
    msg("b", "toolResult", [{ type: "text", text: "Failed to execute" }], { toolName: "bash", isError: true }),
    msg("c", "assistant", [{ type: "text", text: "The command failed." }]),
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0]!.folded, true);
  assert.match(items[0]!.title, /1 tool call · 1 result · 1 thinking block · 1 ERROR/);
  assert.equal(items[0]!.error, true);
  assert.match(items[0]!.text, /Reasoning/);
  assert.match(items[0]!.text, /echo test/);
  assert.equal(items[1]!.text, "The command failed.");
});

test("text between tool calls remains in its original position", () => {
  const items = projectTranscript([msg("a", "assistant", [
    { type: "thinking", thinking: "First" }, { type: "text", text: "Middle" },
    { type: "toolCall", name: "read", arguments: {} },
  ])]);
  assert.deepEqual(items.map((item) => item.kind), ["activity", "assistant", "activity"]);
});

test("literal Unicode search includes folded contents; prompts-only filter is independent", () => {
  const items = projectTranscript([msg("a", "user", "如何测试 [regex]?"), msg("b", "toolResult", "答案 TEST", { toolName: "read" })]);
  assert.equal(filterTranscript(items, "[regex]").length, 1);
  assert.equal(filterTranscript(items, "test").length, 1);
  assert.equal(filterTranscript(items, "答案", true).length, 0);
  assert.equal(filterTranscript(items, "", true).length, 1);
});

test("never exposes hidden custom messages, extension state, provider metadata, or image data", () => {
  const items = projectTranscript([
    { type: "custom", id: "state", data: { token: "PRIVATE_STATE" } },
    { type: "custom_message", id: "hidden", content: "PRIVATE_MESSAGE", display: false },
    msg("hidden-role", "custom", "PRIVATE_ROLE", { display: false }),
    { type: "custom_message", id: "shown", content: "Visible", display: true, customType: "example", details: "PRIVATE_DETAILS" },
    msg("image", "user", [{ type: "image", data: "BASE64_PRIVATE", mimeType: "image/png" }]),
  ]);
  const text = JSON.stringify(items);
  assert.equal(items.length, 2);
  assert.doesNotMatch(text, /PRIVATE/);
  assert.match(text, /Visible/);
  assert.match(text, /image omitted/);
});

test("terminal escape sequences, OSC clipboard/title, C1 and bidi controls are stripped", () => {
  const unsafe = "hello\x1b[2J\x1b[3J\x1b]52;c;YXR0YWNr\x07\x1b]0;title\x1b\\\x9b31m\u202e世界\r\n\tend";
  const safe = plainText(unsafe);
  assert.doesNotMatch(safe, /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202e]/);
  assert.doesNotMatch(safe, /YXR0YWNr|title/);
  assert.match(safe, /世界\n    end/);
});

test("handles legacy/malformed/missing content, errors and unknown entries conservatively", () => {
  const items = projectTranscript([null, {}, msg("a", "user", null), msg("b", "assistant", "Legacy answer"),
    msg("c", "assistant", null, { stopReason: "aborted", errorMessage: "Cancelled" }),
    msg("d", "toolResult", null), { type: "future-entry", content: "Ignore" }]);
  assert.equal(items.length, 4);
  assert.equal(items[0]!.text, "[empty message]");
  assert.equal(items[2]!.error, true);
  assert.equal(contentText(undefined), "");
});

test("shell output preserves exclusion/truncation/cancellation status", () => {
  const [item] = projectTranscript([msg("shell", "bashExecution", null, {
    command: "echo sample", output: "Sample", exitCode: 1, excludeFromContext: true, cancelled: true, truncated: true,
  })]);
  assert.match(item!.title, /excluded from model context.*cancelled.*exit 1/);
  assert.match(item!.text, /truncated by the original tool/);
  assert.equal(item!.error, true);
});

test("untrusted titles cannot insert terminal controls or extra render rows", () => {
  const items = projectTranscript([
    { type: "custom_message", id: "custom", display: true, content: "Visible", customType: "first\nsecond\x1b[2J" },
    msg("shell", "bashExecution", null, { command: "test", output: "result", exitCode: "\x1b[3J\nattack" }),
  ]);
  for (const item of items) assert.doesNotMatch(item.title, /[\x00-\x1f]/);
  assert.match(items[1]!.title, /exit unknown/);
});

test("read-only projection works with frozen input and circular tool arguments", () => {
  const args: { nested?: unknown } = {};
  args.nested = args;
  const entries = Object.freeze([Object.freeze(msg("a", "assistant", [{ type: "toolCall", name: "custom", arguments: args }]))]);
  assert.match(projectTranscript(entries)[0]!.text, /unserializable arguments/);
});
