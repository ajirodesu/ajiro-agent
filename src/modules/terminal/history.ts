/** Bounded per-session command history with prefix navigation. */
export class CommandHistory {
  private readonly entries: string[] = [];
  private cursor = 0;

  constructor(private readonly maxEntries = 500) {}

  push(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      this.cursor = this.entries.length;
      return;
    }
    if (this.entries[this.entries.length - 1] !== trimmed) {
      this.entries.push(trimmed);
      while (this.entries.length > this.maxEntries) {
        this.entries.shift();
      }
    }
    this.cursor = this.entries.length;
  }

  navigate(
    direction: "up" | "down",
    currentDraft: string,
  ): string | null {
    void currentDraft;
    if (direction === "up") {
      if (this.cursor <= 0) return null;
      this.cursor -= 1;
      return this.entries[this.cursor] ?? null;
    }
    if (this.cursor >= this.entries.length) return null;
    this.cursor += 1;
    return this.entries[this.cursor] ?? "";
  }

  all(): string[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;
    this.cursor = 0;
  }
}
