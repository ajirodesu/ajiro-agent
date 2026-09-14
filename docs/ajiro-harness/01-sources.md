# A. Source Inventory

## Official documentation (OFFICIAL DOCUMENTATION, primary truth where applicable)
- https://docs.claude.com/ — Claude, Messages API, streaming, thinking, tools, MCP, skills, memory, permissions, hooks, prompt caching, citations, files/images/PDFs.
- https://platform.claude.com/docs/ — API-side companion.
- https://code.claude.com/docs/ — Claude Code (incl. sandboxing docs), GitHub integration, plugins.
- https://support.claude.com/ , https://support.anthropic.com/ , https://www.anthropic.com/ — product/changelog/engineering notes (incl. sandboxing engineering post).

## Required Anthropic repositories (OPEN-SOURCE IMPLEMENTATION; verified firsthand: sandbox-runtime)
- anthropics/sandbox-runtime — OS-primitive sandbox (sandbox-exec/bubblewrap), secure-by-default, deny-then-allow reads, allow-only writes/network, violation attribution. NOT portable to Android apps as-is (no OS primitives for apps) → adapted at the dispatch layer.
- anthropics/claude-plugins-official — marketplace/manifest/commands/skills/agents/hooks/MCP/install/updates/trust (structure-level reference).
- anthropics/claude-code-action — issue/PR-driven coding and review workflows (adapted to on-device runs).
- anthropics/claude-agent-sdk-typescript + claude-agent-sdk-python — queries, streaming, stateful sessions, interrupts, tools, permissions, hooks, MCP, resume (TypeScript preferred).
- anthropics/knowledge-work-plugins — reusable skills/connectors/domain workflows (include only relevant parts).
- anthropics/claude-tag-plugins — service integrations/API adapters/credential handling (shell assumptions adapted).
- anthropics/commerce-agents — staged writes, approval gates, fencing, provenance (generalized safety patterns).
- anthropics/claude-plugins-community — third-party manifests/skills/commands/agents/MCP; untrusted by default.
- anthropics/financial-services — domain agent/skill/connector/approval patterns; not bundled into core.

Depth note: sandbox-runtime README verified firsthand during this build. Remaining repos are mapped at structure level from public knowledge; anything beyond that is marked STRONG ENGINEERING INFERENCE or UNKNOWN / PROPRIETARY per the rules — no private prompts, routing, or ranking invented.

## Required OpenCode sources (OPEN-SOURCE IMPLEMENTATION / PUBLICLY OBSERVABLE)
- github.com/opencode-ai/opencode README verified firsthand 2026-09-12
  (Go TUI: Bubble Tea; providers; sessions + SQLite; tools incl. bash/glob/
  grep/view/write/edit/patch/diagnostics/fetch/agent; MCP stdio+SSE with the
  same permission model; LSP diagnostics; file-change tracking; custom
  commands with $NAME args; auto-compact at 95%; permission dialog keys
  a=allow, A=allow-session, d=deny; agents coder/task/title with
  model+maxTokens). IMPORTANT CORRECTION: this repo is ARCHIVED (read-only
  since 2025-09-18); the project continued as charmbracelet/crush. Ajiro's
  OpenCode-derived mappings describe observable behavior of that lineage;
  "current maintained implementation" now means Crush, not the archived repo.
- opencode.ai/docs fetch failed at build time; web behavior mapped from the
  verified README instead. License: MIT (verified).
- Agent SDK TS README verified firsthand: queries, streaming, stateful
  sessions, interrupts, tools, permissions, hooks, MCP, resume; governed by
  Anthropic Commercial Terms (NOT Apache) — corrected below.

## Platform (ANDROID / EXPO)
- Android: app-private storage, Storage Access Framework, runtime permissions, package installer, notifications, IME/hardware keyboard.
- React Native + Expo + TypeScript for app/UI code; the canonical terminal
  stack additionally uses react-native-webview (local vendored xterm) and an
  Android PTY layer (Kotlin + JNI + C++/CMake, openpty/forkpty) under PRoot +
  Debian — see 06-agents-terminal-runtime.md.
