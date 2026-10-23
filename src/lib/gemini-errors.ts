import type { AnalyzeFailureCategory } from "./types";

export type GeminiErrorCategory = AnalyzeFailureCategory;

export type ClassifiedGeminiError = {
  category: GeminiErrorCategory;
  status: number | null;
  retryable: boolean;
  userMessage: string;
};

const hasStatus = (e: unknown): e is { status: number } =>
  typeof e === "object" && e !== null && typeof (e as { status?: unknown }).status === "number";

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Classify a Gemma API failure into a stable category with a safe user-facing
 * message. Never includes the raw provider message (which can echo request URLs)
 * in the user message — that goes only to server logs, after sanitization.
 */
export function classifyGeminiError(err: unknown): ClassifiedGeminiError {
  if (err instanceof Error && err.name === "AbortError") {
    return {
      category: "timeout",
      status: null,
      retryable: true,
      userMessage: "The analysis request took too long and was stopped. Check your connection, then use Retry Analysis.",
    };
  }

  const status = hasStatus(err) ? err.status : null;
  const msg = messageOf(err);

  if (status === 400) {
    return {
      category: "invalid_request",
      status,
      retryable: false,
      userMessage: "The analysis request was rejected as invalid (HTTP 400). Try a clearer, smaller image in JPG, PNG or WebP format.",
    };
  }
  if (status === 401 || status === 403) {
    return {
      category: "auth",
      status,
      retryable: false,
      userMessage: `The server API key was rejected or lacks access to the model (HTTP ${status}). An administrator should check the GEMINI_API_KEY server secret.`,
    };
  }
  if (status === 429) {
    return {
      category: "rate_limited",
      status,
      retryable: true,
      userMessage: "The model's rate limit or quota was reached (HTTP 429). Wait about a minute, then use Retry Analysis.",
    };
  }
  if (status === 503) {
    return {
      category: "overloaded",
      status,
      retryable: true,
      userMessage: "The model service is temporarily overloaded (HTTP 503). Wait a moment, then use Retry Analysis.",
    };
  }
  if (/timed? ?out|deadline exceeded|ETIMEDOUT/i.test(msg)) {
    return {
      category: "timeout",
      status,
      retryable: true,
      userMessage: "The analysis request timed out. Check your connection, then use Retry Analysis.",
    };
  }
  if ((err instanceof TypeError && /fetch|network/i.test(msg)) || /network|ECONNRESET|ECONNREFUSED|socket hang up|EAI_AGAIN/i.test(msg)) {
    return {
      category: "network",
      status,
      retryable: true,
      userMessage: "A network error interrupted the analysis. Check connectivity, then use Retry Analysis.",
    };
  }
  return {
    category: "unknown",
    status,
    retryable: false,
    userMessage: "The analysis failed unexpectedly. The details were logged on the server; please try again or contact an administrator.",
  };
}

/** Strip API keys (query params and raw key tokens) from a message before logging. */
export function sanitizeLogMessage(msg: string): string {
  return msg
    .replace(/([?&]key=)[^&\s"']+/gi, "$1REDACTED")
    .replace(/AIza[\w-]{10,}/g, "REDACTED")
    .slice(0, 300);
}

/**
 * Run fn, retrying exactly once after a short backoff when the failure is a
 * transient one (timeout, network, 429, 503). Permanent failures (400, 401,
 * 403, unknown) are rethrown immediately.
 */
export async function withSingleRetry<T>(
  fn: () => Promise<T>,
  opts: { baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const { baseDelayMs = 1500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = opts;
  try {
    return await fn();
  } catch (e) {
    if (!classifyGeminiError(e).retryable) throw e;
    await sleep(baseDelayMs);
    return fn();
  }
}

/**
 * Ensures fn never runs twice at the same time: a call made while a previous
 * run is still in flight resolves to false without invoking fn.
 */
export function createSingleFlight<A extends unknown[]>(fn: (...args: A) => Promise<void>) {
  let running = false;
  return {
    isRunning: () => running,
    run: async (...args: A): Promise<boolean> => {
      if (running) return false;
      running = true;
      try {
        await fn(...args);
        return true;
      } finally {
        running = false;
      }
    },
  };
}
