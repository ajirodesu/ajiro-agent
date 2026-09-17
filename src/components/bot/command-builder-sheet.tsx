/**
 * CommandBuilderSheet — codeless command builder.
 *
 * CodeLess end to end: every field is a text/number input, a single- or
 * multi-select, or a switch. The user never writes or sees generated code.
 * Fields map onto the narrowed meta subset (name, description, category,
 * usage, cooldown) — no version/role/aliases/platform/hasPrefix anywhere.
 */
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { useTheme } from "@/hooks/use-theme";
import type {
  CodelessCommandConfig,
  CodelessDetectionMode,
  CodelessHandler,
  CodelessResponseMedia,
  CodelessResponseType,
} from "../../../packages/cat-bot/src/engine/modules/codeless/command-config.types";

const HANDLERS: { key: CodelessHandler; label: string }[] = [
  { key: "onCommand", label: "onCommand" },
  { key: "onReply", label: "onReply" },
  { key: "onButton", label: "onButton" },
  { key: "onChat", label: "onChat" },
];

const MEDIA: CodelessResponseMedia[] = ["text", "image", "video", "audio", "file"];
const DETECTION: { key: CodelessDetectionMode; label: string }[] = [
  { key: "exact", label: "Exact Match" },
  { key: "contains", label: "Contains" },
  { key: "startsWith", label: "Starts With" },
  { key: "regex", label: "Regex" },
];

export type BuilderApiDetection = {
  method: "GET" | "POST";
  inputs: string[];
  headers: Record<string, string>;
  params: Record<string, string>;
  body: string;
  responsePath: string;
  responseType: CodelessResponseType;
  requiresApiKey: boolean;
  apiKeySendAs: { kind: "header" | "query"; name: string } | null;
};

export function CommandBuilderSheet({
  fetching,
  fetchError,
  saving,
  saveError,
  onFetch,
  onSubmit,
}: {
  fetching: boolean;
  fetchError: string | null;
  saving: boolean;
  saveError: string | null;
  onFetch: (input: { endpoint: string; body: string }) => Promise<BuilderApiDetection>;
  onSubmit: (config: CodelessCommandConfig, apiKey: string | null) => Promise<void>;
}) {
  const theme = useTheme();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Utility");
  const [usage, setUsage] = useState("");
  const [cooldown, setCooldown] = useState("5");
  const [handlers, setHandlers] = useState<CodelessHandler[]>(["onCommand"]);
  const [detectionMode, setDetectionMode] = useState<CodelessDetectionMode>("contains");
  const [keyword, setKeyword] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [media, setMedia] = useState<CodelessResponseMedia>("text");
  const [caption, setCaption] = useState("");
  const [displayName, setDisplayName] = useState(false);
  const [separator, setSeparator] = useState(false);
  const [buttonLabel, setButtonLabel] = useState("🔄 Action");
  const [endpoint, setEndpoint] = useState("");
  const [apiEnabled, setApiEnabled] = useState(false);
  const [method, setMethod] = useState<"GET" | "POST">("GET");
  const [inputsText, setInputsText] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [paramsText, setParamsText] = useState("");
  const [body, setBody] = useState("");
  const [responsePath, setResponsePath] = useState("");
  const [responseType, setResponseType] = useState<CodelessResponseType>("Text");
  const [requiresKey, setRequiresKey] = useState(false);
  const [sendAs, setSendAs] = useState("header:Authorization");
  const [apiKey, setApiKey] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const toggleHandler = (key: CodelessHandler) => {
    setHandlers((prev) => (prev.includes(key) ? prev.filter((h) => h !== key) : [...prev, key]));
  };

  const runFetch = async () => {
    setFormError(null);
    try {
      const detected = await onFetch({ endpoint, body });
      setMethod(detected.method);
      setInputsText(detected.inputs.join(", "));
      setHeadersText(Object.entries(detected.headers).map(([k, v]) => `${k}: ${v}`).join("\n"));
      setParamsText(Object.entries(detected.params).map(([k, v]) => `${k}=${v}`).join("\n"));
      setBody(detected.body);
      setResponsePath(detected.responsePath);
      setResponseType(detected.responseType);
      setRequiresKey(detected.requiresApiKey);
      if (detected.apiKeySendAs) setSendAs(`${detected.apiKeySendAs.kind}:${detected.apiKeySendAs.name}`);
      setApiEnabled(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const parseLines = (text: string, sep: ":" | "="): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf(sep);
      if (idx === -1) continue;
      out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return out;
  };

  const submit = async () => {
    setFormError(null);
    if (!name.trim()) {
      setFormError("Name is required.");
      return;
    }
    if (!caption.trim() && !apiEnabled) {
      setFormError("Caption is required for commands without an API configuration.");
      return;
    }
    if (handlers.includes("onChat") && !keyword.trim()) {
      setFormError("Keyword/Pattern is required when onChat is selected.");
      return;
    }
    const sendAsParts = sendAs.split(":");
    const config: CodelessCommandConfig = {
      name: name.trim().toLowerCase(),
      description,
      category: category || "Utility",
      usage,
      cooldown: Number(cooldown) || 0,
      handlers: handlers.length > 0 ? handlers : ["onCommand"],
      responseMedia: media,
      caption,
      displayCommandName: displayName,
      lineSeparator: separator,
      button: { enabled: handlers.includes("onButton"), label: buttonLabel },
      onChat: handlers.includes("onChat")
        ? { detectionMode, keyword, caseSensitive }
        : null,
      api: apiEnabled
        ? {
            endpoint,
            method,
            inputs: inputsText.split(",").map((s) => s.trim()).filter(Boolean).map((n) => ({ name: n })),
            headers: parseLines(headersText, ":"),
            params: parseLines(paramsText, "="),
            body,
            responsePath,
            responseType,
            apiKeySendAs:
              requiresKey && sendAsParts.length === 2
                ? ({ kind: sendAsParts[0] === "query" ? "query" : "header", name: sendAsParts[1] ?? "" } as { kind: "header" | "query"; name: string })
                : null,
            requiresApiKey: requiresKey,
          }
        : null,
    };
    try {
      await onSubmit(config, requiresKey ? apiKey || null : null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <ScrollView
      className="max-h-full"
      contentContainerClassName="gap-sp-4 p-sp-5"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Section title="Command Meta">
        <Field label="Name">
          <Input value={name} onChangeText={setName} placeholder="bible" autoCapitalize="none" />
        </Field>
        <Field label="Description">
          <Input value={description} onChangeText={setDescription} placeholder="What this command does" />
        </Field>
        <Field label="Category">
          <Input value={category} onChangeText={setCategory} placeholder="Utility" />
        </Field>
        <Field label="Usage">
          <Input value={usage} onChangeText={setUsage} placeholder="[passage] [--version=<ver>]" />
        </Field>
        <Field label="Cooldown (seconds)">
          <Input value={cooldown} onChangeText={setCooldown} placeholder="5" keyboardType="numeric" />
        </Field>
      </Section>

      <Section title="Handlers (multi-select)">
        <View className="flex-row flex-wrap gap-sp-2">
          {HANDLERS.map((h) => (
            <Chip
              key={h.key}
              label={h.label}
              active={handlers.includes(h.key)}
              onPress={() => toggleHandler(h.key)}
            />
          ))}
        </View>
      </Section>

      {handlers.includes("onChat") ? (
        <Section title="Message detecting (onChat)">
          <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            Detection Mode (single-select)
          </Text>
          <View className="flex-row flex-wrap gap-sp-2">
            {DETECTION.map((d) => (
              <Chip
                key={d.key}
                label={d.label}
                active={detectionMode === d.key}
                onPress={() => setDetectionMode(d.key)}
              />
            ))}
          </View>
          <Field label="Keyword / Pattern (required)">
            <Input value={keyword} onChangeText={setKeyword} placeholder="hello" />
          </Field>
          <Row label="Case Sensitive" value={caseSensitive} onChange={setCaseSensitive} />
        </Section>
      ) : null}

      <Section title="Response Media (single-select)">
        <View className="flex-row flex-wrap gap-sp-2">
          {MEDIA.map((m) => (
            <Chip key={m} label={m} active={media === m} onPress={() => setMedia(m)} />
          ))}
        </View>
      </Section>

      <Section title="Caption (required)">
        <Input value={caption} onChangeText={setCaption} placeholder="Reply text — use ${result} for API output" multiline />
      </Section>

      <Section title="Presentation">
        <Row label="Display Command Name" value={displayName} onChange={setDisplayName} hint="Prepends a /name title line" />
        <Row label="Line Separator" value={separator} onChange={setSeparator} hint="Inserts a ─── rule above the caption" />
      </Section>

      {handlers.includes("onButton") ? (
        <Section title="Button">
          <Field label="Button label">
            <Input value={buttonLabel} onChangeText={setButtonLabel} placeholder="🔄 Action" />
          </Field>
        </Section>
      ) : null}

      <Section title="API Configuration">
        <Field label="Endpoint">
          <Input value={endpoint} onChangeText={setEndpoint} placeholder="https://bible-api.com/${text}?translation=${version}" autoCapitalize="none" />
        </Field>
        <Pressable
          accessibilityRole="button"
          disabled={fetching || !endpoint.trim()}
          onPress={runFetch}
          className="h-11 items-center justify-center rounded-full bg-secondary dark:bg-secondary-dark"
          style={({ pressed }) => ({ opacity: pressed || fetching ? 0.7 : 1 })}
        >
          {fetching ? (
            <ActivityIndicator size="small" color={theme.text} />
          ) : (
            <Text className="font-sans text-base font-semibold text-foreground dark:text-foreground-dark">
              Fetch
            </Text>
          )}
        </Pressable>
        {fetchError ? <ErrorText message={fetchError} /> : null}
        {apiEnabled ? (
          <View className="gap-sp-3">
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              Method: {method} (auto-detected)
            </Text>
            <Field label="Inputs (comma separated)">
              <Input value={inputsText} onChangeText={setInputsText} placeholder="text, version" autoCapitalize="none" />
            </Field>
            <Field label="Headers (one per line, Name: value)">
              <Input value={headersText} onChangeText={setHeadersText} placeholder="Authorization: Bearer ${API_KEY}" multiline autoCapitalize="none" />
            </Field>
            <Field label="Query Params (one per line, name=value)">
              <Input value={paramsText} onChangeText={setParamsText} placeholder="translation=${version}" multiline autoCapitalize="none" />
            </Field>
            <Field label="Body (POST only)">
              <Input value={body} onChangeText={setBody} placeholder='{"q": "${text}"}' multiline autoCapitalize="none" />
            </Field>
            <Field label="Response Path">
              <Input value={responsePath} onChangeText={setResponsePath} placeholder="text" autoCapitalize="none" />
            </Field>
            <Field label="Response Type">
              <Input value={responseType} onChangeText={(v) => setResponseType(v as CodelessResponseType)} placeholder="JSON | Text | Image URL | Buffer" autoCapitalize="none" />
            </Field>
            {requiresKey ? (
              <View className="gap-sp-2 rounded-2xl border border-border p-sp-3 dark:border-border-dark">
                <Text className="font-sans text-sm font-semibold text-foreground dark:text-foreground-dark">
                  This endpoint requires an API key
                </Text>
                <Field label="API Key (stored securely, never exported)">
                  <Input value={apiKey} onChangeText={setApiKey} placeholder="••••••••" secureTextEntry autoCapitalize="none" />
                </Field>
                <Field label="Send As (header:name or query:name)">
                  <Input value={sendAs} onChangeText={setSendAs} placeholder="header:Authorization" autoCapitalize="none" />
                </Field>
              </View>
            ) : null}
          </View>
        ) : null}
      </Section>

      {formError ?? saveError ? <ErrorText message={(formError ?? saveError) as string} /> : null}

      <Pressable
        accessibilityRole="button"
        disabled={saving}
        onPress={submit}
        className="h-12 items-center justify-center rounded-full"
        style={{ backgroundColor: theme.accent, opacity: saving ? 0.6 : 1 }}
      >
        {saving ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text className="font-sans text-base font-semibold text-white">Save command</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-sp-2">
      <Text className="font-sans text-sm font-semibold uppercase tracking-wider text-muted-foreground dark:text-muted-foreground-dark">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-sp-1">
      <Text className="font-sans text-sm font-medium text-foreground dark:text-foreground-dark">{label}</Text>
      {children}
    </View>
  );
}

function Input(props: React.ComponentProps<typeof TextInput>) {
  const theme = useTheme();
  return (
    <TextInput
      className="min-h-11 rounded-xl border border-border bg-input px-sp-3 py-sp-2 font-sans text-base text-foreground dark:border-border-dark dark:bg-input-dark dark:text-foreground-dark"
      placeholderTextColor={theme.textSecondary}
      {...props}
    />
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className="rounded-full border px-sp-3 py-sp-2"
      style={{
        borderColor: active ? theme.accent : theme.border,
        backgroundColor: active ? `${theme.accent}1A` : "transparent",
      }}
    >
      <Text
        className="font-sans text-sm font-medium"
        style={{ color: active ? theme.accent : theme.text }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Row({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const theme = useTheme();
  return (
    <View className="flex-row items-center justify-between gap-sp-3">
      <View className="min-w-0 flex-1">
        <Text className="font-sans text-base text-foreground dark:text-foreground-dark">{label}</Text>
        {hint ? (
          <Text className="font-sans text-xs text-muted-foreground dark:text-muted-foreground-dark">{hint}</Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: theme.accent, false: theme.border }}
      />
    </View>
  );
}

function ErrorText({ message }: { message: string }) {
  return (
    <Text className="font-sans text-sm text-destructive dark:text-destructive-dark">{message}</Text>
  );
}
