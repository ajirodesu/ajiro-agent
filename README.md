# Ajiro Agent (100% Native Android in Kotlin + Jetpack Compose)

**Application ID:** `com.ajirohq.ajiroagent`
**Author / Maintainer:** **AjiroDesu**
**Original Foundation:** TecnicalBot / `mobile-agent`

---

## Overview

Ajiro Agent is a fully native Android application rewritten in Kotlin and Jetpack Compose. It runs on-device AI agent capabilities, local PRoot terminal PTY sessions, SAF workspace file management, and Model Context Protocol (MCP) tool executions.

---

## Building and Running

### Requirements
- JDK 21 LTS
- Android SDK (API 34/35)
- Gradle 8.8

### Build Release APK
To assemble the release build:
```bash
./gradlew assembleRelease
```

### Run Unit Tests
To run unit tests:
```bash
./gradlew testDebugUnitTest
```

---

## Attribution & Credits

- **Ajiro Agent Modifications & Maintenance:** **AjiroDesu**
- **Original Mobile Agent Foundation:** TecnicalBot (`TecnicalBot/mobile-agent`)
- **PRoot Component:** Licensed under GPL-2.0 (`modules/terminal-pty/android/src/main/jniLibs/arm64-v8a/README.md`)
