/**
 * Test-framework detection (§33): vitest, jest, pytest, go test, cargo
 * test, and other language runners — inferred from project files, never
 * hard-coded to one framework.
 */
export type TestFramework =
  | "vitest"
  | "jest"
  | "pytest"
  | "go-test"
  | "cargo-test"
  | "mocha"
  | "unknown";

export interface TestProjectSignals {
  files: string[];
  packageJson: { dependencies: string[]; devDependencies: string[]; scripts: Record<string, string> } | null;
}

export interface DetectedTestSetup {
  framework: TestFramework;
  /** How tests are usually invoked in this project. */
  command: string[];
  /** Glob-ish file patterns holding tests. */
  testFilePatterns: string[];
  configFile: string | null;
}

export function detectTestFramework(signals: TestProjectSignals): DetectedTestSetup {
  const { files, packageJson } = signals;
  const has = (name: string): boolean => files.some((file) => file === name || file.endsWith(`/${name}`));
  const deps = new Set([...(packageJson?.dependencies ?? []), ...(packageJson?.devDependencies ?? [])]);

  if (deps.has("vitest") || has("vitest.config.ts") || has("vitest.config.js") || has("vitest.config.mts")) {
    return { framework: "vitest", command: ["npx", "vitest", "run"], testFilePatterns: ["**/*.test.{ts,tsx,js,jsx}", "**/*.spec.{ts,tsx}"], configFile: signals.files.find((file) => /vitest\.config\./.test(file)) ?? null };
  }
  if (deps.has("jest") || has("jest.config.js") || has("jest.config.ts")) {
    return { framework: "jest", command: ["npx", "jest"], testFilePatterns: ["**/*.test.{ts,tsx,js,jsx}", "**/__tests__/**"], configFile: signals.files.find((file) => /jest\.config\./.test(file)) ?? null };
  }
  if (deps.has("mocha") || has(".mocharc.json") || has(".mocharc.yml")) {
    return { framework: "mocha", command: ["npx", "mocha"], testFilePatterns: ["test/**/*.js", "**/*.spec.js"], configFile: null };
  }
  if (has("pytest.ini") || has("pyproject.toml") || has("setup.cfg") || files.some((file) => /(^|\/)test_.*\.py$/.test(file) || /_test\.py$/.test(file))) {
    return { framework: "pytest", command: ["pytest"], testFilePatterns: ["test_*.py", "*_test.py"], configFile: signals.files.find((file) => /(pytest\.ini|pyproject\.toml)$/.test(file)) ?? null };
  }
  if (has("go.mod") || files.some((file) => file.endsWith("_test.go"))) {
    return { framework: "go-test", command: ["go", "test", "./..."], testFilePatterns: ["*_test.go"], configFile: signals.files.find((file) => file.endsWith("go.mod")) ?? null };
  }
  if (has("Cargo.toml")) {
    return { framework: "cargo-test", command: ["cargo", "test"], testFilePatterns: ["tests/**/*.rs"], configFile: signals.files.find((file) => file.endsWith("Cargo.toml")) ?? null };
  }
  return { framework: "unknown", command: [], testFilePatterns: [], configFile: null };
}

/** True when a file path looks like a test file for the detected setup. */
export function isTestFile(path: string, setup: DetectedTestSetup): boolean {
  const base = path.split("/").pop() ?? path;
  switch (setup.framework) {
    case "vitest":
    case "jest":
      return /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(base) || path.includes("/__tests__/");
    case "mocha":
      return /\.spec\.js$/.test(base) || path.includes("/test/");
    case "pytest":
      return /^test_.*\.py$/.test(base) || /_test\.py$/.test(base);
    case "go-test":
      return /_test\.go$/.test(base);
    case "cargo-test":
      return path.includes("/tests/") && base.endsWith(".rs");
    default:
      return false;
  }
}
