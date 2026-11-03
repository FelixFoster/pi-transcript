import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, truncateToWidth, wrapTextWithAnsi, type Component, type Focusable, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { filterTranscript, plainText, type TranscriptItem } from "./transcript.ts";

export interface ViewOptions {
  items: readonly TranscriptItem[];
  query?: string;
  theme: Pick<Theme, "fg" | "bold">;
  keybindings: Pick<KeybindingsManager, "matches">;
  rows: () => number;
  requestRender: () => void;
  close: () => void;
}

/** A display-only viewport. Only visible/visited items are wrapped, not the whole history. */
export class TranscriptView implements Component, Focusable {
  private readonly options: ViewOptions;
  private readonly input = new Input({ prompt: "/ ", placeholder: "Search all text, including folded activity" });
  private items: TranscriptItem[];
  private query: string;
  private editingSearch = false;
  private promptsOnly = false;
  private index = 0;
  private line = 0;
  private width = 80;
  private bodyHeight = 10;
  private readonly expanded = new Map<string, boolean>();
  private readonly cache = new Map<string, string[]>();
  private readonly rowItems = new Map<number, number>();
  private needsMatchSeek = false;
  private disposed = false;
  private _focused = false;

  constructor(options: ViewOptions) {
    this.options = options;
    this.query = plainText(options.query ?? "").trim();
    this.input.setValue(this.query);
    this.items = filterTranscript(options.items, this.query);
    if (this.query) this.needsMatchSeek = true;
    else {
      const latest = this.items.findLastIndex((item) => item.kind === "user");
      this.index = Math.max(0, latest);
    }
  }

  get focused(): boolean { return this._focused; }
  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value && this.editingSearch;
  }

  private isExpanded(item: TranscriptItem): boolean {
    return this.expanded.get(item.id) ?? (Boolean(this.query) || !item.folded);
  }

  private lines(index: number): string[] {
    const item = this.items[index];
    if (!item) return [];
    const open = this.isExpanded(item);
    const key = `${index}:${this.width}:${open}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const title = `${open ? "▾" : "▸"} ${item.title}`;
    const preview = item.text.split("\n", 1)[0] ?? "";
    const lines = open
      ? [title, ...wrapTextWithAnsi(item.text, Math.max(1, this.width - 2)).map((line) => `  ${line}`), ""]
      : [`${title} — ${preview}`];
    // Avoid accumulating a wrapped copy of every visited tool output.
    if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, lines);
    return lines;
  }

  private setIndex(index: number): void {
    this.index = Math.max(0, Math.min(this.items.length - 1, index));
    this.line = 0;
    this.needsMatchSeek = Boolean(this.query);
  }

  private applyFilter(): void {
    this.query = plainText(this.input.getValue()).trim();
    this.items = filterTranscript(this.options.items, this.query, this.promptsOnly);
    this.expanded.clear();
    this.cache.clear();
    this.setIndex(0);
  }

  private scroll(delta: number): void {
    if (this.items.length === 0) return;
    this.needsMatchSeek = false;
    let remaining = Math.abs(delta);
    while (remaining > 0) {
      if (delta > 0) {
        const available = this.lines(this.index).length - 1 - this.line;
        if (remaining <= available) { this.line += remaining; break; }
        if (this.index >= this.items.length - 1) { this.line += available; break; }
        remaining -= available + 1;
        this.index++;
        this.line = 0;
      } else {
        if (remaining <= this.line) { this.line -= remaining; break; }
        if (this.index === 0) { this.line = 0; break; }
        remaining -= this.line + 1;
        this.index--;
        this.line = this.lines(this.index).length - 1;
      }
    }
    if (this.index === this.items.length - 1) {
      const lastPage = Math.max(0, this.lines(this.index).length - Math.max(1, this.bodyHeight));
      this.line = Math.min(this.line, lastPage);
    }
  }

  private toggle(index = this.index): void {
    const item = this.items[index];
    if (!item) return;
    this.expanded.set(item.id, !this.isExpanded(item));
    this.cache.clear();
    this.setIndex(index);
  }

  handleInput(data: string): void {
    if (this.disposed) return;
    const kb = this.options.keybindings;
    if (this.editingSearch) {
      if (kb.matches(data, "tui.select.cancel")) {
        this.editingSearch = false;
        this.input.setValue(this.query);
      } else if (kb.matches(data, "tui.select.confirm")) {
        this.applyFilter();
        this.editingSearch = false;
      } else {
        this.input.handleInput(data);
        const raw = this.input.getValue();
        const safe = plainText(raw).replace(/\n/g, " ");
        if (raw !== safe) this.input.setValue(safe);
      }
      this.input.focused = this.focused && this.editingSearch;
    } else if (kb.matches(data, "tui.select.cancel") || data === "q") {
      this.options.close();
      return;
    } else if (data === "/" || matchesKey(data, "ctrl+f")) {
      this.editingSearch = true;
      this.input.focused = this.focused;
    } else if (kb.matches(data, "tui.select.up") || data === "k" || data === "N") {
      this.setIndex(this.index - 1);
    } else if (kb.matches(data, "tui.select.down") || data === "j" || data === "n") {
      this.setIndex(this.index + 1);
    } else if (kb.matches(data, "tui.select.pageUp") || matchesKey(data, "ctrl+b")) {
      this.scroll(-Math.max(1, this.bodyHeight - 1));
    } else if (kb.matches(data, "tui.select.pageDown") || matchesKey(data, "ctrl+d")) {
      this.scroll(Math.max(1, this.bodyHeight - 1));
    } else if (matchesKey(data, "home") || data === "g") {
      this.setIndex(0);
    } else if (matchesKey(data, "end") || data === "G") {
      this.setIndex(this.items.length - 1);
    } else if (kb.matches(data, "tui.select.confirm") || data === " ") {
      this.toggle();
    } else if (data === "u") {
      this.promptsOnly = !this.promptsOnly;
      this.applyFilter();
    } else if (data === "c") {
      this.input.setValue("");
      this.applyFilter();
    }
    this.options.requestRender();
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.disposed || this.editingSearch) return undefined;
    if (event.type === "wheel") {
      this.scroll(event.wheelDelta ?? 0);
      this.options.requestRender();
      return { handled: true };
    }
    if (event.type === "click" && event.button === "left") {
      const index = this.rowItems.get(event.y);
      if (index !== undefined) {
        this.toggle(index);
        this.options.requestRender();
        return { handled: true, focus: true };
      }
    }
    return undefined;
  }

  render(width: number): string[] {
    if (this.disposed || width < 1) return [];
    if (width !== this.width) {
      this.width = width;
      this.cache.clear();
      this.line = 0;
      this.needsMatchSeek = Boolean(this.query);
    }
    const height = Math.max(1, Math.floor(this.options.rows()) - 2);
    this.bodyHeight = Math.max(0, height - 4);
    const theme = this.options.theme;
    const heading = theme.bold(theme.fg("accent", `Transcript · ${this.items.length ? this.index + 1 : 0}/${this.items.length} · ${this.promptsOnly ? "your prompts" : "active branch"} · read-only snapshot`));
    const filter = this.editingSearch
      ? this.input.render(width)[0] ?? ""
      : theme.fg("muted", this.query ? `Search: ${this.query} · c clear · / edit` : "Model context is unchanged. Tool output and thinking are folded.");
    const lines = [heading, filter];
    this.rowItems.clear();
    if (this.needsMatchSeek) {
      const needle = this.query.toLocaleLowerCase();
      const found = this.lines(this.index).findIndex((line) => line.toLocaleLowerCase().includes(needle));
      this.line = Math.max(0, found - 1);
      this.needsMatchSeek = false;
    }
    if (this.items.length === 0 && this.bodyHeight > 0) {
      lines.push(theme.fg("muted", this.options.items.length ? "No matches. Press c to clear the search, or u to change the filter." : "No visible messages on this branch yet."));
    }
    let index = this.index;
    let offset = this.line;
    while (lines.length < height - 2 && index < this.items.length) {
      const item = this.items[index]!;
      const itemLines = this.lines(index);
      for (; offset < itemLines.length && lines.length < height - 2; offset++) {
        this.rowItems.set(lines.length, index);
        const line = itemLines[offset]!;
        const color = item.error ? "error" : item.kind === "user" ? "accent" : item.kind === "assistant" ? "text" : "muted";
        lines.push(offset === 0 ? theme.bold(theme.fg(color, line)) : theme.fg("text", line));
      }
      index++;
      offset = 0;
    }
    while (lines.length < height - 2) lines.push("");
    lines.push(theme.fg("dim", "↑↓ entries · PgUp/PgDn scroll · Enter fold · Home/End jump"));
    lines.push(theme.fg("dim", "/ search · u prompts only · c clear · Esc/q close"));
    return lines.slice(0, height).map((line) => truncateToWidth(line, width, ""));
  }

  invalidate(): void {
    this.cache.clear();
    this.input.invalidate();
  }

  dispose(): void {
    this.disposed = true;
    this.cache.clear();
    this.rowItems.clear();
    this.expanded.clear();
    this.items = [];
  }
}
