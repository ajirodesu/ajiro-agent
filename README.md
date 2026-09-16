# Ajiro Agent

Ajiro Agent is an open-source AI agent built specifically for mobile devices that runs entirely on your phone.

## Demo

[![Ajiro Agent demo](https://img.youtube.com/vi/_P_SQ0MW-aU/maxresdefault.jpg)](https://youtu.be/_P_SQ0MW-aU?si=klxA4b7RU3Y2j5iy)

## Features

- On-device models that can run completely offline
- Runs completely on-device
- No external server required
- MCP support
- Skills system
- Persistent memory
- Multi-modal support
- Direct access to phone's internal storage
- Android permission-based access

## Installation

The application is distributed through GitHub Releases.

1. Download the latest APK from the Releases page.
2. Install the APK on your Android device.
3. Grant the required permissions.
4. Start using Ajiro Agent.

## 🙏 Original Source & Special Thanks

Ajiro Agent is based on the original **Mobile Agent** project developed by **TecnicalBot**.

### Original Source Code

**Repository:** TecnicalBot/mobile-agent
**Author:** TecnicalBot

**GitHub:** https://github.com/TecnicalBot/mobile-agent

The original Mobile Agent repository served as the foundation for Ajiro Agent. Ajiro Agent has since been independently modified, refactored, expanded, and rebranded to build a distinct mobile AI-agent experience with additional functionality, integrations, UI/UX changes, Android-specific capabilities, and ongoing development by **AjiroDesu**.

### Special Thanks

Special thanks to **TecnicalBot** for creating and open-sourcing the original Mobile Agent project and for providing the foundation on which Ajiro Agent was developed.

We greatly appreciate the original architecture, ideas, engineering work, and contributions that made it possible to extend the project into Ajiro Agent.

**Original Project:**
https://github.com/TecnicalBot/mobile-agent

**Ajiro Agent:**
https://github.com/ajirodesu/ajiro-agent

All subsequent modifications and additions specific to Ajiro Agent are maintained by **AjiroDesu**.

## 📚 Technical References & Attribution

The Skills ecosystem and on-device terminal were designed with the following
projects as **functional references**. Unless noted otherwise, behavior was
re-implemented for Ajiro Agent — no third-party application code is vendored
in `src/`, and Ajiro's UI, branding, and architecture remain its own.

### LobeHub (Skills functional reference)

- **Repository:** https://github.com/lobehub/lobehub (`canary` branch)
- **Adapted subsystems:** SKILL.md frontmatter rules and metadata validation
  (`src/utils/skillMarkdown.ts`,
  `apps/server/src/services/skillManagement/frontmatter.ts`), skill import
  route classification
  (`packages/context-engine/src/providers/SkillImportRouteInjector.ts`),
  project skill resolution concepts (`src/features/SkillsList`), Skill Store
  / Composer Skills / skill management structure
  (`src/features/SkillStore`, `src/features/ChatInput`,
  `src/features/SkillsList`, `src/features/AgentSkillEdit`,
  `src/features/AgentSkillDetail`), skill script execution model
  (  `src/store/tool/slices/builtin/executors/lobe-skills.ts`).
- **Not ported:** cloud sandbox execution, Electron/desktop transports and
  APIs, web-only UI, marketplace/registry backend, and all
  `.agents/skills/*` repository-development workflows.
- **License:** LobeHub Community License (Apache-2.0 based with additional
  conditions — notably, distributing a *derivative work* commercially
  requires a commercial license from the producer; see
  https://github.com/lobehub/lobehub/blob/canary/LICENSE). Verify these
  requirements before distribution.

### LobeHub (model selection functional reference)

- **Repository:** https://github.com/lobehub/lobehub (`canary` branch)
- **Adapted behavior:** ModelSwitchPanel information architecture (provider
  group headers with settings affordance, model rows with ability badges
  and active state, detail panel with context/pricing/abilities sections),
  ModelSelect capability representation, and provider configuration
  concepts. Rebuilt as a native React Native bottom sheet on Ajiro Agent's
  own provider registry, model catalogs, secure credential storage, and
  runtime — no LobeHub code or branding is shipped.
- Same LobeHub Community License terms and verification duty as above.

### Acode (terminal UI behavior reference)

- **Repository:** https://github.com/Acode-Foundation/Acode
- **Adapted:** terminal interaction behavior (touch scrolling with momentum,
  long-press selection, defaults, theme management). Re-implemented in
  TypeScript + local xterm; no Acode code is shipped.
- **License:** MIT License, Copyright 2020 Foxdebug (Ajit Kumar).

### PRoot (shipped binary)

- The `arm64-v8a` PRoot binary bundled under
  `modules/terminal-pty/android/src/main/jniLibs/` (built from
  https://github.com/termux/proot) is **GPL-2.0**. Shipping it inside the
  APK carries GPL obligations for that component — see the README next to
  the binary and resolve before store distribution.

### Community skills (installable content)

- The bundled Skill Store catalog (`catalog/skills.json`) links installable
  skills from https://github.com/anthropics/skills. Installed skills carry
  **their own licenses** (check the skill's `LICENSE` / frontmatter
  `license:` field, shown in Skill Store detail when present).

## Contributing

Contributions are welcome. Feel free to open an issue for bug reports, feature requests, or submit a pull request if you'd like to contribute.

## License

This project is licensed under the MIT License.

## Note

Do not install the APK for now. I will fix the issues soon.
