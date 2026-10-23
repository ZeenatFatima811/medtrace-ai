import { describe, expect, it, vi } from "vitest";
import { classifyGeminiError, createSingleFlight, sanitizeLogMessage, withSingleRetry } from "./gemini-errors";

const apiError = (status: number, message = "api error") => Object.assign(new Error(message), { status, name: "ApiError" });

describe("classifyGeminiError", () => {
  it("classifies 400 as a non-retryable invalid request", () => {
    const c = classifyGeminiError(apiError(400));
    expect(c).toMatchObject({ category: "invalid_request", status: 400, retryable: false });
  });

  it("classifies 401 and 403 as non-retryable auth failures", () => {
    expect(classifyGeminiError(apiError(401))).toMatchObject({ category: "auth", status: 401, retryable: false });
    expect(classifyGeminiError(apiError(403))).toMatchObject({ category: "auth", status: 403, retryable: false });
  });

  it("classifies 429 as a retryable rate limit", () => {
    expect(classifyGeminiError(apiError(429))).toMatchObject({ category: "rate_limited", status: 429, retryable: true });
  });

  it("classifies 503 as retryable service overload", () => {
    expect(classifyGeminiError(apiError(503))).toMatchObject({ category: "overloaded", status: 503, retryable: true });
  });

  it("classifies the provider's intermittent bare 500 as retryable", () => {
    expect(classifyGeminiError(apiError(500, "Internal error encountered."))).toMatchObject({
      category: "overloaded",
      status: 500,
      retryable: true,
    });
  });

  it("classifies aborts and timeout messages as retryable timeouts", () => {
    expect(classifyGeminiError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toMatchObject({
      category: "timeout",
      retryable: true,
    });
    expect(classifyGeminiError(new Error("Request timed out"))).toMatchObject({ category: "timeout", retryable: true });
  });

  it("classifies fetch failures as retryable network errors", () => {
    expect(classifyGeminiError(new TypeError("fetch failed"))).toMatchObject({ category: "network", retryable: true });
  });

  it("classifies anything else as a non-retryable unknown failure", () => {
    expect(classifyGeminiError(new Error("boom"))).toMatchObject({ category: "unknown", status: null, retryable: false });
  });
});

describe("sanitizeLogMessage", () => {
  it("redacts API keys from URLs and bare key tokens", () => {
    const out = sanitizeLogMessage("GET https://x.example/v1/models?key=AIzaSyABCDEFGHIJ1234567890 failed");
    expect(out).not.toContain("AIzaSyABCDEFGHIJ1234567890");
    expect(out).toContain("key=REDACTED");
  });
});

describe("withSingleRetry", () => {
  const sleep = () => Promise.resolve();

  it("succeeds without retrying when the first call works", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withSingleRetry(fn, { sleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once on a transient failure and then succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(apiError(503)).mockResolvedValue("ok");
    await expect(withSingleRetry(fn, { sleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent failures", async () => {
    for (const err of [apiError(400), apiError(401), apiError(403), new Error("boom")]) {
      const fn = vi.fn().mockRejectedValue(err);
      await expect(withSingleRetry(fn, { sleep })).rejects.toBe(err);
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it("gives up after the single retry when the transient failure persists", async () => {
    const fn = vi.fn().mockRejectedValue(apiError(429));
    await expect(withSingleRetry(fn, { sleep })).rejects.toMatchObject({ status: 429 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("waits before retrying", async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValueOnce(apiError(429)).mockResolvedValue("ok");
    await withSingleRetry(fn, { baseDelayMs: 42, sleep: async (ms) => void delays.push(ms) });
    expect(delays).toEqual([42]);
  });
});

describe("createSingleFlight", () => {
  it("blocks a second run while the first is in flight", async () => {
    let resolveFirst!: () => void;
    const fn = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r))).mockResolvedValue(undefined);
    const flight = createSingleFlight(fn);

    const first = flight.run();
    expect(flight.isRunning()).toBe(true);
    await expect(flight.run()).resolves.toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);

    resolveFirst();
    await expect(first).resolves.toBe(true);
    expect(flight.isRunning()).toBe(false);
  });

  it("allows a new run after the previous one finishes, even on failure", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(undefined);
    const flight = createSingleFlight(fn);
    await expect(flight.run()).rejects.toThrow("x");
    await expect(flight.run()).resolves.toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
