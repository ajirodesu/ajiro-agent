/**
 * Fetch auto-detection — runs "server-side" (never from the browser
 * directly; in Ajiro Agent the caller is the on-device service layer, not a
 * webview). Given a pasted endpoint (bare URL or curl/HTTP snippet), probe
 * the endpoint and return detected Method/Inputs/Headers/Query Params/Body/
 * Response Path/Response Type — plus a dedicated API Key field only when the
 * endpoint proves to require auth (401/403).
 *
 * Secret values are never returned here beyond what the user typed; the
 * portable config carries only the `${API_KEY}` placeholder + Send As.
 */
import type { ApiKeySendAs, CodelessResponseType } from "./command-config.types";

export type FetchDetectInput = {
  endpoint: string;
  body?: string;
};

export type FetchDetectResult = {
  method: "GET" | "POST";
  inputs: string[];
  headers: Record<string, string>;
  params: Record<string, string>;
  body: string;
  responsePath: string;
  responseType: CodelessResponseType;
  requiresApiKey: boolean;
  apiKeySendAs: ApiKeySendAs | null;
  probeUrl: string;
  status?: number;
};

const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function extractInputs(...templates: string[]): string[] {
  const seen: string[] = [];
  for (const t of templates) {
    VAR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VAR_RE.exec(String(t ?? "")))) {
      const name = m[1] as string;
      if (name !== "API_KEY" && !seen.includes(name)) seen.push(name);
    }
  }
  return seen;
}

export function parsePastedEndpoint(raw: string): { method: "GET" | "POST"; url: string; headers: Record<string, string>; body: string } {
  const text = String(raw ?? "").trim();
  const curlVerb = text.match(/curl[^]*?\s-(?:X|--request)\s+([A-Za-z]+)/i)?.[1]?.toUpperCase();
  const httpVerb = text.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)/im);
  if (curlVerb === "POST" || httpVerb?.[1]?.toUpperCase() === "POST") {
    const url = httpVerb?.[2] ?? text.match(/https?:\/\/[^\s'"]+/)?.[0] ?? text;
    return { method: "POST", url, headers: {}, body: "" };
  }
  const url = httpVerb?.[2] ?? text.match(/https?:\/\/[^\s'"]+/)?.[0] ?? text;
  return { method: "GET", url, headers: {}, body: "" };
}

function looksLikeImageUrl(value: string): boolean {
  return /^https?:\/\/\S+\.(png|jpe?g|gif|webp|bmp|svg)(\?\S*)?$/i.test(value.trim());
}

function firstStringPath(data: unknown, prefix = ""): string | null {
  if (typeof data === "string") return prefix || null;
  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i += 1) {
      const found = firstStringPath(data[i], prefix ? `${prefix}.${i}` : `${i}`);
      if (found) return found;
    }
    return null;
  }
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data)) {
      const found = firstStringPath(v, prefix ? `${prefix}.${k}` : k);
      if (found) return found;
    }
  }
  return null;
}

function readPath(data: unknown, path: string): unknown {
  let current: unknown = data;
  for (const segment of String(path).split(".")) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else return undefined;
  }
  return current;
}

function guessApiKeySendAs(bodyText: string, headers: Record<string, string>): ApiKeySendAs | null {
  const text = `${bodyText} ${JSON.stringify(headers)}`.toLowerCase();
  if (text.includes("x-api-key")) return { kind: "header", name: "x-api-key" };
  if (text.includes("apikey")) return { kind: "query", name: "apikey" };
  if (text.includes("api_key")) return { kind: "query", name: "api_key" };
  if (text.includes("www-authenticate") || text.includes("bearer")) {
    return { kind: "header", name: "Authorization" };
  }
  if (text.includes("api key") || text.includes("token") || text.includes("unauthorized")) {
    return { kind: "header", name: "Authorization" };
  }
  return { kind: "header", name: "Authorization" };
}

export async function detectEndpoint(
  input: FetchDetectInput,
  fetcher: typeof fetch = fetch,
): Promise<FetchDetectResult> {
  const parsed = parsePastedEndpoint(input.endpoint);
  const baseBody = String(input.body ?? "");
  const inputs = extractInputs(parsed.url, baseBody);

  const attempt = async (method: "GET" | "POST"): Promise<{ status: number; contentType: string; data: unknown; rawText: string }> => {
    const url = substituteAll(parsed.url, {});
    const init: RequestInit =
      method === "POST"
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: substituteAll(baseBody || "{}", {}) }
        : { method: "GET" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetcher(url, { ...init, signal: controller.signal });
      const contentType = res.headers?.get?.("content-type") ?? "";
      const rawText = await res.text();
      let data: unknown = rawText;
      if (contentType.includes("application/json")) {
        try {
          data = JSON.parse(rawText);
        } catch {
          data = rawText;
        }
      }
      return { status: res.status, contentType, data, rawText };
    } finally {
      clearTimeout(timer);
    }
  };

  let method = parsed.method;
  let probed = await attempt(method);
  if (method === "GET" && (probed.status === 405 || probed.status === 415)) {
    method = "POST";
    probed = await attempt(method);
  }

  // Auth probe: 401/403 with no auth supplied → dedicated API Key field.
  let requiresApiKey = false;
  let apiKeySendAs: ApiKeySendAs | null = null;
  let headers: Record<string, string> = {};
  if (probed.status === 401 || probed.status === 403) {
    requiresApiKey = true;
    apiKeySendAs = guessApiKeySendAs(probed.rawText, {});
  }

  // Split query params out of the endpoint vs embedded path.
  const params: Record<string, string> = {};
  let endpoint = parsed.url;
  try {
    const u = new URL(parsed.url);
    u.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    u.search = "";
    endpoint = u.toString();
  } catch {
    // Keep the endpoint as pasted when it is not a parseable URL.
  }

  const { responsePath, responseType } = classifyResponse(probed.contentType, probed.data, probed.rawText);

  return {
    method,
    inputs,
    headers,
    params,
    body: method === "POST" ? baseBody : "",
    responsePath,
    responseType,
    requiresApiKey,
    apiKeySendAs,
    probeUrl: parsed.url,
    status: probed.status,
  };
}

function substituteAll(template: string, values: Record<string, string>): string {
  return String(template).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => values[name] ?? "");
}

export function classifyResponse(
  contentType: string,
  data: unknown,
  rawText: string,
): { responsePath: string; responseType: CodelessResponseType } {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("image/")) return { responsePath: "", responseType: "Image URL" };
  if (ct.includes("application/octet-stream")) return { responsePath: "", responseType: "Buffer" };
  if (typeof data === "string") {
    if (looksLikeImageUrl(data)) return { responsePath: "", responseType: "Image URL" };
    return { responsePath: "", responseType: "Text" };
  }
  if (data && typeof data === "object") {
    const path = firstStringPath(data) ?? "";
    const value = path ? readPath(data, path) : undefined;
    if (typeof value === "string" && looksLikeImageUrl(value)) {
      return { responsePath: path, responseType: "Image URL" };
    }
    return { responsePath: path, responseType: "JSON" };
  }
  void rawText;
  return { responsePath: "", responseType: "Text" };
}
