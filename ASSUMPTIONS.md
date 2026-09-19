# ASSUMPTIONS.md

1. **Gradle Build System**: Project uses Gradle 8.8 with Kotlin 1.9.22/2.0+ and Java 21 LTS compatibility.
2. **Database Migration**: Database schema and file location (`/data/data/com.ajirohq.ajiroagent/databases/ajiro.db`) are preserved identically to allow in-place upgrade from React Native.
3. **Android Keystore**: Keys formerly stored in Expo SecureStore are mapped to Android Keystore (`EncryptedSharedPreferences`).
4. **Git Engine**: Pure Java/Kotlin git operations are performed via JGit instead of `isomorphic-git`.
5. **Terminal PTY & PRoot**: JNI native symbols for terminal PTY are preserved with package mapping, and the bundled arm64 PRoot binary is retained.
