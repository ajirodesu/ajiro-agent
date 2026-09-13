import { describe, expect, it } from "vitest";

import {
  PermissionStore,
  policyFromApprovalMode,
} from "@/modules/permissions/engine";
import { InProcessAdapter } from "@/modules/terminal/process-adapter";
import type { TerminalEvent } from "@/modules/terminal/types";

async function collect(
  run: (write: (line: string) => Promise<void>) => Promise<void>,
): Promise<TerminalEvent[]> {
  const adapter = new InProcessAdapter({
    policy: policyFromApprovalMode("ask"),
    permissions: { store: new PermissionStore() },
  });
  const process = await adapter.start({ columns: 80, rows: 24 });
  const events: TerminalEvent[] = [];
  process.onEvent((event) => {
    events.push(event);
  });
  await run((line) => process.write(line));
  await adapter.terminate(process.id);
  return events;
}

function outputText(events: TerminalEvent[]): string {
  return events
    .filter((event) => event.type === "data")
    .map((event) => (event as { data: string }).data)
    .join("");
}

describe("in-process terminal adapter", () => {
  it("answers help and echo", async () => {
    const events = await collect(async (write) => {
      await write("help\n");
      await write("echo hello-device\n");
    });
    const text = outputText(events);
    expect(text).toContain("allow-listed");
    expect(text).toContain("hello-device");
  });

  it("fails closed on unknown commands", async () => {
    const events = await collect(async (write) => {
      await write("rm -rf /\n");
    });
    expect(outputText(events)).toContain("exit 127");
  });

  it("routes run through the broker and reports honestly", async () => {
    const events = await collect(async (write) => {
      await write("run bogus-check\n");
      await write("run file-stats\n");
    });
    const text = outputText(events);
    expect(text).toContain("Unknown check");
    // No project session attached: honest limitation, android_local.
    expect(text).toContain("project folder");
  });

  it("clears the screen with the clear builtin", async () => {
    const events = await collect(async (write) => {
      await write("clear\n");
    });
    const text = outputText(events);
    expect(text).toContain("[2J");
  });

  it("exits on the exit builtin", async () => {
    const adapter = new InProcessAdapter({
      policy: policyFromApprovalMode("ask"),
      permissions: { store: new PermissionStore() },
    });
    const process = await adapter.start({ columns: 80, rows: 24 });
    const types: string[] = [];
    process.onEvent((event) => {
      types.push(event.type);
    });
    await process.write("exit\n");
    expect(types).toContain("exit");
  });
});
