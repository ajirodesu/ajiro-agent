/**
 * Local performance/debug instrumentation (§54). No external telemetry:
 * in-memory latency samples + counters the settings/debug UI can read.
 */
export interface IntelPerfSample {
  samples: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
}

export interface IntelPerfSnapshot {
  operations: Record<string, IntelPerfSample>;
  counters: Record<string, number>;
}

export interface IntelPerf {
  time<T>(operation: string, work: () => Promise<T>): Promise<T>;
  count(counter: string, by?: number): void;
  snapshot(): IntelPerfSnapshot;
  reset(): void;
}

const MAX_OPERATIONS = 64;

export function createIntelPerf(): IntelPerf {
  const operations = new Map<string, IntelPerfSample>();
  const counters = new Map<string, number>();

  function record(operation: string, elapsedMs: number): void {
    let sample = operations.get(operation);
    if (!sample) {
      if (operations.size >= MAX_OPERATIONS) return;
      sample = { samples: 0, totalMs: 0, maxMs: 0, lastMs: 0 };
      operations.set(operation, sample);
    }
    sample.samples += 1;
    sample.totalMs += elapsedMs;
    sample.maxMs = Math.max(sample.maxMs, elapsedMs);
    sample.lastMs = elapsedMs;
  }

  return {
    async time(operation, work) {
      const start = Date.now();
      try {
        return await work();
      } finally {
        record(operation, Date.now() - start);
      }
    },
    count(counter, by = 1) {
      counters.set(counter, (counters.get(counter) ?? 0) + by);
    },
    snapshot() {
      const ops: Record<string, IntelPerfSample> = {};
      for (const [key, value] of operations) ops[key] = { ...value };
      const counts: Record<string, number> = {};
      for (const [key, value] of counters) counts[key] = value;
      return { operations: ops, counters: counts };
    },
    reset() {
      operations.clear();
      counters.clear();
    },
  };
}

/** Average latency helper for debug UI rows. */
export function averageMs(sample: IntelPerfSample): number {
  return sample.samples === 0 ? 0 : sample.totalMs / sample.samples;
}
