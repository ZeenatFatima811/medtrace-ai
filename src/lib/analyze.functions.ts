import { createServerFn } from "@tanstack/react-start";
import { classifyGeminiError, sanitizeLogMessage, withSingleRetry } from "./gemini-errors";
import { clip, parseFindings } from "./parse-findings";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MODEL_ID,
  type AnalyzeResult,
  type DeviceDetails,
} from "./types";

type Input = { imageBase64: string; mimeType: string; details: DeviceDetails };

const API_TIMEOUT_MS = 90_000; // generous bound for image analysis; aborts only on genuine stalls
// No maxOutputTokens cap: the prompt itself constrains the response to a small
// JSON object, and a hard cap risks truncating the JSON mid-object (verified
// against the live model), which makes the response unparseable.

const PROMPT = (d: DeviceDetails) => `You are assisting a hospital biomedical engineering team with DOCUMENTATION of a medical-device error screen.
Describe only what is visibly present in the image. Do NOT diagnose, do NOT give repair or clinical instructions, do NOT guess the meaning of error codes.
User-supplied context (may be empty or wrong): manufacturer="${d.manufacturer}", deviceType="${d.deviceType}", model="${d.modelNumber}", department="${d.department}".

Return ONLY a JSON object with exactly these keys:
{
  "visibleDeviceInfo": {"manufacturer": string|null, "deviceType": string|null, "model": string|null, "serial": string|null},
  "errorCodes": string[],          // codes exactly as displayed, e.g. "E-104"; [] if none legible
  "visibleErrorText": string[],    // verbatim on-screen messages
  "screenDescription": string,     // 1-2 neutral sentences
  "confidence": "high"|"medium"|"low",
  "uncertaintyNotes": string,      // why confidence is not higher
  "unreadable": string[],          // parts of the screen that could not be read
  "followUpQuestions": string[]    // questions a biomedical engineer should ask to document this incident
}
If the image is not a device screen or is unreadable, set confidence "low" and explain in uncertaintyNotes.`;

export const analyzeErrorScreen = createServerFn({ method: "POST" })
  .inputValidator((input: Input) => {
    if (!input || typeof input.imageBase64 !== "string") throw new Error("Missing image");
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(input.mimeType))
      throw new Error("Unsupported image type. Use JPG, PNG or WebP.");
    if (input.imageBase64.length * 0.75 > MAX_IMAGE_BYTES) throw new Error("Image exceeds 5 MB limit.");
    const d = input.details ?? ({} as DeviceDetails);
    return {
      imageBase64: input.imageBase64,
      mimeType: input.mimeType,
      details: {
        manufacturer: clip(d.manufacturer, 100),
        deviceType: clip(d.deviceType, 100),
        modelNumber: clip(d.modelNumber, 100),
        serialNumber: clip(d.serialNumber, 100),
        department: clip(d.department, 100),
        notes: clip(d.notes, 2000),
      },
    };
  })
  .handler(async ({ data }): Promise<AnalyzeResult> => {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
      return {
        ok: false,
        code: "missing_key",
        error:
          "GEMINI_API_KEY is not configured on the server. Create a key at https://aistudio.google.com/apikey and add it as a server secret (or to .env when running locally).",
      };
    }
    const t0 = Date.now();
    const imageBytes = Math.round(data.imageBase64.length * 0.75);
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey });
      const tApi = Date.now();
      const res = await withSingleRetry(() =>
        ai.models.generateContent({
          model: MODEL_ID,
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: data.mimeType, data: data.imageBase64 } },
                { text: PROMPT(data.details) },
              ],
            },
          ],
          config: {
            httpOptions: { timeout: API_TIMEOUT_MS },
          },
        }),
      );
      const apiMs = Date.now() - tApi;
      const tParse = Date.now();
      const findings = parseFindings(res.text ?? "");
      console.info(
        `[analyze] ok imageBytes=${imageBytes} apiMs=${apiMs} parseMs=${Date.now() - tParse} totalMs=${Date.now() - t0}`,
      );
      if (!findings)
        return { ok: false, code: "unparseable", error: "Gemma 4 responded, but not in the expected format. Please try again." };
      return { ok: true, findings, model: MODEL_ID };
    } catch (e) {
      const c = classifyGeminiError(e);
      // Server-side diagnostics keep the real status and category; the message is
      // sanitized so no API key or request URL can reach the logs or the browser.
      console.error(
        `[analyze] failed category=${c.category} status=${c.status ?? "n/a"} totalMs=${Date.now() - t0} msg=${sanitizeLogMessage(e instanceof Error ? e.message : String(e))}`,
      );
      return { ok: false, code: "api_error", error: c.userMessage, category: c.category, retryable: c.retryable };
    }
  });
