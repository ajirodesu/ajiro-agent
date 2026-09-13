/**
 * Terminal controller: owns named sessions (tabs). Sessions are created
 * on demand and destroyed explicitly — nothing initializes at app launch.
 */
import { TerminalSession } from "@/modules/terminal/session";

export type TerminalSessionInfo = {
  id: string;
  title: string;
  createdAt: string;
  exited: boolean;
};

export class TerminalController {
  private readonly sessions = new Map<string, TerminalSession>();
  private activeId: string | null = null;

  create(columns: number, rows: number): TerminalSession {
    const session = new TerminalSession(columns, rows);
    this.sessions.set(session.id, session);
    if (!this.activeId) this.activeId = session.id;
    return session;
  }

  destroy(id: string): boolean {
    const removed = this.sessions.delete(id);
    if (this.activeId === id) {
      const next = [...this.sessions.keys()][0] ?? null;
      this.activeId = next;
    }
    return removed;
  }

  get(id: string): TerminalSession | null {
    return this.sessions.get(id) ?? null;
  }

  active(): TerminalSession | null {
    return this.activeId ? this.get(this.activeId) : null;
  }

  setActive(id: string): boolean {
    if (!this.sessions.has(id)) return false;
    this.activeId = id;
    return true;
  }

  list(): TerminalSessionInfo[] {
    return [...this.sessions.values()].map((session) => ({
      id: session.id,
      title: session.sessionTitle || "Terminal",
      createdAt: session.createdAt,
      exited: session.exitCode !== null,
    }));
  }

  clear(): void {
    this.sessions.clear();
    this.activeId = null;
  }
}
