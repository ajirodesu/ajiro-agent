/**
 * Debugger foundation (§34): abstractions only.
 *
 * No debugger UI is exposed and no backend is faked — these types exist so
 * a future debug adapter (DAP-compatible, on-device) plugs in cleanly.
 * `createDebuggerSession` returns null until `registerDebuggerBackend` has
 * a real backend; callers must hide debugger UI while it does.
 */
export type DebuggerBreakpoint = {
  id: string;
  uri: string;
  line: number;
  column: number;
  condition: string | null;
  hitCondition: string | null;
  enabled: boolean;
};

export type DebuggerStackFrame = {
  id: number;
  name: string;
  uri: string | null;
  line: number;
  column: number;
};

export type DebuggerScope = {
  name: string;
  variables: DebuggerVariable[];
};

export type DebuggerVariable = {
  name: string;
  value: string;
  type: string | null;
  variablesReference: number;
};

export type DebuggerEvent =
  | { type: "stopped"; reason: "breakpoint" | "step" | "pause" | "exception"; description: string | null }
  | { type: "continued" }
  | { type: "terminated" }
  | { type: "output"; category: "stdout" | "stderr" | "console"; text: string };

export interface DebuggerBackend {
  readonly id: string;
  readonly label: string;
  launch(configuration: Record<string, string>): Promise<void>;
  setBreakpoints(uri: string, breakpoints: DebuggerBreakpoint[]): Promise<void>;
  continue(): Promise<void>;
  pause(): Promise<void>;
  stepOver(): Promise<void>;
  stepInto(): Promise<void>;
  stepOut(): Promise<void>;
  stackTrace(): Promise<DebuggerStackFrame[]>;
  scopes(frameId: number): Promise<DebuggerScope[]>;
  evaluate(expression: string, frameId?: number): Promise<string>;
  disconnect(): Promise<void>;
  onEvent(listener: (event: DebuggerEvent) => void): () => void;
}

let backend: DebuggerBackend | null = null;

/** Register a REAL backend. Until then, debugger UI must stay hidden. */
export function registerDebuggerBackend(next: DebuggerBackend | null): void {
  backend = next;
}

export function hasDebuggerBackend(): boolean {
  return backend !== null;
}

export function getDebuggerBackend(): DebuggerBackend | null {
  return backend;
}
