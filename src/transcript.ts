import { stripVTControlCharacters } from "node:util";

export type ItemKind = "user" | "assistant" | "activity" | "compaction" | "note";
export interface TranscriptItem {
  readonly id: string;
  readonly kind: ItemKind;
  readonly title: string;
  readonly text: string;
  readonly folded: boolean;
  readonly error: boolean;
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" ? value as RecordValue : {};
}

/** Treat session/tool text as untrusted terminal input. Never replay escape codes. */
export function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  return stripVTControlCharacters(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "");
}

function inlineText(value: unknown): string {
  return plainText(value).replace(/\s+/g, " ");
}

function json(value: unknown): string {
  try { return plainText(JSON.stringify(value, null, 2)); }
  catch { return "[unserializable arguments]"; }
}

/** Images are described, never decoded; extension details/state are never dumped. */
export function contentText(content: unknown): string {
  if (typeof content === "string") return plainText(content);
  if (!Array.isArray(content)) return "";
  return content.map((value) => {
    const block = record(value);
    if (block.type === "text") return plainText(block.text);
    if (block.type === "image") return "[image omitted]";
    return "";
  }).filter(Boolean).join("\n");
}

/** Pure display projection. Input must be the active branch, not all tree entries. */
export function projectTranscript(entries: readonly unknown[]): TranscriptItem[] {
  const result: TranscriptItem[] = [];
  let activity: { id: string; chunks: string[]; calls: number; results: number; thoughts: number; errors: number } | undefined;
  const flush = () => {
    if (!activity) return;
    const a = activity;
    const counts = [
      a.calls && `${a.calls} tool call${a.calls === 1 ? "" : "s"}`,
      a.results && `${a.results} result${a.results === 1 ? "" : "s"}`,
      a.thoughts && `${a.thoughts} thinking block${a.thoughts === 1 ? "" : "s"}`,
      a.errors && `${a.errors} ERROR${a.errors === 1 ? "" : "S"}`,
    ].filter(Boolean).join(" · ");
    result.push({ id: a.id, kind: "activity", title: `Activity: ${counts}`, text: a.chunks.join("\n\n"), folded: true, error: a.errors > 0 });
    activity = undefined;
  };
  const addActivity = (id: string, text: string, category: "calls" | "results" | "thoughts", error = false) => {
    activity ??= { id, chunks: [], calls: 0, results: 0, thoughts: 0, errors: 0 };
    activity.chunks.push(text);
    activity[category]++;
    if (error) activity.errors++;
  };
  const add = (id: string, kind: ItemKind, title: string, text: string, folded = false, error = false) => {
    flush();
    result.push({ id, kind, title, text: text || "[empty message]", folded, error });
  };

  entries.forEach((value, position) => {
    const entry = record(value);
    const id = typeof entry.id === "string" ? entry.id : `entry-${position}`;
    if (entry.type === "compaction") {
      // retainedTail is model context, not another set of chronological messages.
      add(id, "compaction", "Context compacted — original messages remain above", plainText(entry.summary), true);
      return;
    }
    if (entry.type === "branch_summary") {
      add(id, "note", "Branch summary", plainText(entry.summary), true);
      return;
    }
    if (entry.type === "custom_message") {
      if (entry.display === true) add(id, "note", `Extension: ${inlineText(entry.customType)}`, contentText(entry.content));
      return;
    }
    if (entry.type !== "message") return;
    const message = record(entry.message);
    switch (message.role) {
      case "user":
        add(id, "user", "You", contentText(message.content));
        break;
      case "assistant": {
        const blocks = Array.isArray(message.content) ? message.content : [];
        let visible = false;
        blocks.forEach((value, index) => {
          const block = record(value);
          const blockId = `${id}:${index}`;
          if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
            add(blockId, "assistant", "Assistant", plainText(block.text));
            visible = true;
          } else if (block.type === "thinking") {
            addActivity(blockId, `Thinking\n${plainText(block.thinking) || "[not available]"}`, "thoughts");
            visible = true;
          } else if (block.type === "toolCall") {
            addActivity(blockId, `Tool call: ${plainText(block.name)}\n${json(block.arguments)}`, "calls");
            visible = true;
          } else if (block.type === "image") {
            add(blockId, "assistant", "Assistant", "[image omitted]");
            visible = true;
          }
        });
        if (typeof message.content === "string") {
          add(id, "assistant", "Assistant", plainText(message.content));
          visible = true;
        }
        if (message.stopReason === "error" || message.stopReason === "aborted" || message.errorMessage) {
          add(`${id}:error`, "note", `Assistant ${message.stopReason === "aborted" ? "aborted" : "error"}`, plainText(message.errorMessage) || "[no error details]", false, true);
        } else if (!visible) {
          add(id, "assistant", "Assistant", "[empty or unsupported message]");
        }
        break;
      }
      case "toolResult":
        addActivity(id, `${message.isError ? "ERROR — " : ""}Tool result: ${plainText(message.toolName)}\n${contentText(message.content) || "[empty result]"}`, "results", message.isError === true);
        break;
      case "bashExecution":
        add(id, "activity", `Shell${message.excludeFromContext ? " (excluded from model context)" : ""}${message.cancelled ? " — cancelled" : ""} · exit ${typeof message.exitCode === "number" ? message.exitCode : "unknown"}`, `$ ${plainText(message.command)}\n${plainText(message.output)}${message.truncated ? "\n[output was truncated by the original tool]" : ""}`, true, typeof message.exitCode === "number" && message.exitCode !== 0);
        break;
      case "custom":
        if (message.display === true) add(id, "note", `Extension: ${inlineText(message.customType)}`, contentText(message.content));
        break;
      case "branchSummary":
      case "compactionSummary":
        add(id, "note", "Saved summary", plainText(message.summary), true);
        break;
    }
  });
  flush();
  return result;
}

export function latestPrompt(entries: readonly unknown[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = record(entries[i]);
    const message = record(entry.message);
    if (entry.type === "message" && message.role === "user") return contentText(message.content) || "[empty message]";
  }
  return undefined;
}

/** Case-insensitive literal search, not regex. Searches folded activity too. */
export function filterTranscript(items: readonly TranscriptItem[], query: string, promptsOnly = false): TranscriptItem[] {
  const needle = plainText(query).trim().toLocaleLowerCase();
  return items.filter((item) => (!promptsOnly || item.kind === "user") &&
    (!needle || `${item.title}\n${item.text}`.toLocaleLowerCase().includes(needle)));
}
