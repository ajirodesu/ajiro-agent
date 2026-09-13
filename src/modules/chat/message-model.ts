/**
 * Canonical message model (§11): three distinct layers that must not be
 * confused.
 *
 * - ProviderMessage: what goes over the wire (provider/API structures).
 * - RuntimeMessage: internal runtime record (identity, order, status).
 * - UiMessage: what the chat UI renders (display segments, actions).
 *
 * Pure converters between layers live here and are unit-tested. Existing
 * StoredMessage rows convert losslessly through RuntimeMessage.
 *
 * Source provenance: [AJIRO ORIGINAL] layering; part kinds follow the
 * provider tool-use/thinking shapes Ajiro already handles at runtime.
 */
export type ProviderTextPart = { type: "text"; text: string };
export type ProviderThinkingPart = { type: "thinking"; text: string };
export type ProviderToolCallPart = {
  type: "tool-call";
  id: string;
  name: string;
  input: unknown;
};
export type ProviderToolResultPart = {
  type: "tool-result";
  id: string;
  output: unknown;
  isError?: boolean;
};
export type ProviderImagePart = {
  type: "image";
  mimeType: string;
  dataUrl?: string;
  uri?: string;
};
export type ProviderPart =
  | ProviderTextPart
  | ProviderThinkingPart
  | ProviderToolCallPart
  | ProviderToolResultPart
  | ProviderImagePart;

export type ProviderMessage = {
  role: "system" | "user" | "assistant" | "tool";
  parts: ProviderPart[];
};

export type RuntimeBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool-call"; id: string; name: string; input: unknown }
  | { kind: "tool-result"; id: string; output: string; isError: boolean }
  | { kind: "code"; language: string | null; code: string }
  | { kind: "attachment"; fileId: string; displayName: string };

export type RuntimeMessage = {
  id: string;
  conversationId: string;
  sequence: number;
  role: "system" | "user" | "assistant";
  blocks: RuntimeBlock[];
  status: "streaming" | "completed" | "failed";
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UiSegment =
  | { kind: "markdown"; text: string }
  | { kind: "code"; language: string | null; code: string }
  | { kind: "tool"; toolName: string; status: string; summary: string }
  | { kind: "thinking"; text: string; collapsed: boolean }
  | { kind: "attachment"; displayName: string }
  | { kind: "error"; message: string };

export type UiMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  segments: UiSegment[];
  streaming: boolean;
  failed: boolean;
};

const CODE_FENCE = /^```(\w*)\n([\s\S]*?)```$/;

export function providerToRuntime(
  message: ProviderMessage,
  identity: {
    id: string;
    conversationId: string;
    sequence: number;
    status?: RuntimeMessage["status"];
  },
): RuntimeMessage {
  const now = new Date().toISOString();
  const blocks: RuntimeBlock[] = [];
  for (const part of message.parts) {
    if (part.type === "text") {
      const match = CODE_FENCE.exec(part.text.trim());
      blocks.push(
        match
          ? {
              kind: "code",
              language: match[1] || null,
              code: match[2] ?? "",
            }
          : { kind: "text", text: part.text },
      );
    } else if (part.type === "thinking") {
      blocks.push({ kind: "thinking", text: part.text });
    } else if (part.type === "tool-call") {
      blocks.push({
        kind: "tool-call",
        id: part.id,
        name: part.name,
        input: part.input,
      });
    } else if (part.type === "tool-result") {
      blocks.push({
        kind: "tool-result",
        id: part.id,
        output:
          typeof part.output === "string"
            ? part.output
            : JSON.stringify(part.output),
        isError: part.isError ?? false,
      });
    } else if (part.type === "image") {
      blocks.push({
        kind: "attachment",
        fileId: part.dataUrl ?? part.uri ?? "",
        displayName: `image.${(part.mimeType.split("/")[1] ?? "bin").split(";")[0]}`,
      });
    }
  }
  return {
    id: identity.id,
    conversationId: identity.conversationId,
    sequence: identity.sequence,
    role: message.role === "tool" ? "assistant" : message.role,
    blocks,
    status: identity.status ?? "completed",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function runtimeToUi(message: RuntimeMessage): UiMessage {
  const segments: UiSegment[] = [];
  for (const block of message.blocks) {
    if (block.kind === "text") {
      segments.push({ kind: "markdown", text: block.text });
    } else if (block.kind === "code") {
      segments.push({
        kind: "code",
        language: block.language,
        code: block.code,
      });
    } else if (block.kind === "thinking") {
      segments.push({ kind: "thinking", text: block.text, collapsed: true });
    } else if (block.kind === "tool-call") {
      segments.push({
        kind: "tool",
        toolName: block.name,
        status: "running",
        summary: block.name,
      });
    } else if (block.kind === "tool-result") {
      segments.push({
        kind: "tool",
        toolName: block.id,
        status: block.isError ? "failed" : "completed",
        summary: block.output.slice(0, 240),
      });
    } else if (block.kind === "attachment") {
      segments.push({ kind: "attachment", displayName: block.displayName });
    }
  }
  if (message.error) {
    segments.push({ kind: "error", message: message.error });
  }
  return {
    id: message.id,
    role: message.role,
    segments,
    streaming: message.status === "streaming",
    failed: message.status === "failed",
  };
}
