# PORTING MANIFEST - Ajiro Agent (React Native / Expo -> Native Android Kotlin)

| Source File (RN / Expo TS) | Target File (Android Native / Kotlin) | Status | Notes |
|---|---|---|---|
| `app.json`, `plugins/*` | `app/src/main/AndroidManifest.xml` | done | Merged permissions, services, receivers, activity-aliases |
| `src/app/(root)/index.tsx` | `com.ajirohq.ajiroagent.ui.screens.ChatScreen` | done | Root chat screen |
| `src/app/(root)/files.tsx` | `com.ajirohq.ajiroagent.ui.screens.FilesScreen` | done | SAF & internal file tree |
| `src/app/(root)/git.tsx` | `com.ajirohq.ajiroagent.ui.screens.GitScreen` | done | Git status, commit, push, pull |
| `src/app/(root)/terminal.tsx` | `com.ajirohq.ajiroagent.ui.screens.TerminalScreen` | done | Native PTY xterm WebView screen |
| `src/app/(root)/run.tsx` | `com.ajirohq.ajiroagent.ui.screens.RunScreen` | done | Background execution viewer |
| `src/app/(root)/bot.tsx` | `com.ajirohq.ajiroagent.ui.screens.BotScreen` | done | Bot status & commands |
| `src/app/(root)/extensions.tsx` | `com.ajirohq.ajiroagent.ui.screens.ExtensionsScreen` | done | Extension manager |
| `src/app/(root)/library.tsx` | `com.ajirohq.ajiroagent.ui.screens.LibraryScreen` | done | Prompts & saved snippets |
| `src/app/(root)/settings/*.tsx` | `com.ajirohq.ajiroagent.ui.screens.settings.*` | done | All 15 settings screens (providers, agents, skills, mcp, memory, etc.) |
| `src/core/db/schema.ts`, `migrations.ts` | `com.ajirohq.ajiroagent.db.AppDatabase` | done | Room / SQLite 23 tables & migrations |
| `src/core/services/secure-store.ts`, `secrets.ts` | `com.ajirohq.ajiroagent.core.SecretManager` | done | Android Keystore / EncryptedSharedPreferences |
| `src/modules/runtime/**` | `com.ajirohq.ajiroagent.runtime.*` | done | Pipeline, stream bus, run manager, subagents |
| `src/modules/tools/**` | `com.ajirohq.ajiroagent.tools.*` | done | Native tools implementation |
| `src/modules/mcp/**` | `com.ajirohq.ajiroagent.mcp.*` | done | MCP client, SSE, OAuth |
| `src/modules/skills/**` | `com.ajirohq.ajiroagent.skills.*` | done | SKILL.md parser, skill store |
| `src/modules/extensions/**` | `com.ajirohq.ajiroagent.extensions.*` | done | Acode DOM host & plugin engine |
| `modules/terminal-pty/**` | `com.ajirohq.ajiroagent.pty.*` | done | JNI C++ bridge & PRoot terminal service |
| `modules/background-agent-service/**` | `com.ajirohq.ajiroagent.service.AgentForegroundService` | done | Native foreground service |
| `modules/scheduler-alarm/**` | `com.ajirohq.ajiroagent.scheduler.*` | done | Exact alarm & boot receivers |
| `modules/saf-file-operations/**` | `com.ajirohq.ajiroagent.saf.*` | done | Native SAF document access |
| `modules/process-text/**` | `com.ajirohq.ajiroagent.processtext.*` | done | Process text intent activity |
| `modules/app-icon-switcher/**` | `com.ajirohq.ajiroagent.icon.*` | done | Activity alias manager |
| `modules/persistent-model-download/**` | `com.ajirohq.ajiroagent.models.ModelDownloadWorker` | done | WorkManager background downloader |
| `src/theme/**` | `com.ajirohq.ajiroagent.ui.theme.*` | done | Aqua, Burnt, Indigo, Legacy, System theme definitions |
