/**
 * Cancellation + race protection (§53).
 *
 * Every async intel request carries a monotonic id and the document version
 * it was issued against. Responses check `isStale()` before touching editor
 * state so rapid typing can never let an old result overwrite a newer one.
 * `runLatest` adds last-write-wins collapsing for hot paths (completion,
 * hover, diagnostics).
 */
import type { IntelRequest } from "@/modules/intel/types";

class RequestToken implements IntelRequest {
  cancelled = false;
  constructor(
    readonly requestId: number,
    readonly documentVersion: number,
  ) {}
  cancel(): void {
    this.cancelled = true;
  }
  throwIfCancelled(): void {
    if (this.cancelled) {
      const error = new Error("Request cancelled");
      error.name = "IntelCancelledError";
      throw error;
    }
  }
  isStale(currentDocumentVersion: number): boolean {
    return this.cancelled || this.documentVersion !== currentDocumentVersion;
  }
}

export function isCancelError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "IntelCancelledError" || error.name === "AbortError")
  );
}

export interface RequestManager {
  createRequest(documentVersion?: number): IntelRequest;
  cancelAll(): void;
  readonly latestRequestId: number;
}

/** Tracks request ids; optionally bound to a document version source. */
export function createRequestManager(
  getDocumentVersion: () => number = () => 0,
): RequestManager {
  let nextId = 0;
  const live = new Set<RequestToken>();
  return {
    get latestRequestId() {
      return nextId;
    },
    createRequest(documentVersion?: number): IntelRequest {
      nextId += 1;
      const token = new RequestToken(
        nextId,
        documentVersion ?? getDocumentVersion(),
      );
      live.add(token);
      return token;
    },
    cancelAll(): void {
      for (const token of live) token.cancel();
      live.clear();
    },
  };
}

export interface LatestRunnerOptions {
  /** Called when a superseded response is dropped (telemetry hook). */
  onSuperseded?: (droppedRequestId: number) => void;
}

/**
 * Last-write-wins executor: concurrent calls are each given a sequence
 * number; only the newest call's resolution is delivered. Older resolutions
 * are swallowed (never throw, never deliver).
 */
export function createLatestRunner(options: LatestRunnerOptions = {}) {
  let sequence = 0;
  return {
    async run<T>(work: (requestId: number) => Promise<T>): Promise<T | null> {
      sequence += 1;
      const mine = sequence;
      const result = await work(mine);
      if (mine !== sequence) {
        options.onSuperseded?.(mine);
        return null;
      }
      return result;
    },
    get latestSequence(): number {
      return sequence;
    },
  };
}

/** Debounce that resolves all pending callers with the final invocation. */
export function debounceShared<TArgs extends unknown[], TResult>(
  waitMs: number,
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: {
    resolve: (value: TResult) => void;
    reject: (error: unknown) => void;
  }[] = [];
  let latestArgs: TArgs | null = null;
  return (...args: TArgs): Promise<TResult> => {
    latestArgs = args;
    if (timer) clearTimeout(timer);
    return new Promise<TResult>((resolve, reject) => {
      pending.push({ resolve, reject });
      timer = setTimeout(() => {
        timer = null;
        const current = pending;
        pending = [];
        const callArgs = latestArgs as TArgs;
        fn(...callArgs).then(
          (value) => {
            for (const waiter of current) waiter.resolve(value);
          },
          (error: unknown) => {
            for (const waiter of current) waiter.reject(error);
          },
        );
      }, waitMs);
    });
  };
}
