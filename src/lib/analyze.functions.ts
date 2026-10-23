import { createServerFn } from "@tanstack/react-start";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MODEL_ID,
  type AnalyzeResult,
  type DeviceDetails,
  type Findings,
} from "./types";

type Input = { imageBase64: string; mimeType: string; details: DeviceDetails };

const clip = (v: unknown, n = 500) => (typeof v === "string" ? v.slice(0, n) : "");

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

function parseFindings(text: string): Findings | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => clip(x)) : []);
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? clip(v, 200) : null);
    const conf = ["high", "medium", "low"].includes(j.confidence) ? j.confidence : "low";
    return {
      visibleDeviceInfo: {
        manufacturer: s(j.visibleDeviceInfo?.manufacturer),
        deviceType: s(j.visibleDeviceInfo?.deviceType),
        model: s(j.visibleDeviceInfo?.model),
        serial: s(j.visibleDeviceInfo?.serial),
      },
      errorCodes: arr(j.errorCodes).slice(0, 10),
      visibleErrorText: arr(j.visibleErrorText).slice(0, 10),
      screenDescription: clip(j.screenDescription, 800),
      confidence: conf,
      uncertaintyNotes: clip(j.uncertaintyNotes, 800),
      unreadable: arr(j.unreadable).slice(0, 10),
      followUpQuestions: arr(j.followUpQuestions).slice(0, 8),
    };
  } catch {
    return null;
  }
}

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
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey });
      const res = await ai.models.generateContent({
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
      });
      const findings = parseFindings(res.text ?? "");
      if (!findings)
        return { ok: false, code: "unparseable", error: "Gemma 4 responded, but not in the expected format. Please try again." };
      return { ok: true, findings, model: MODEL_ID };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Gemma call failed:", msg.slice(0, 300));
      const hint = /API key|401|403|PERMISSION/i.test(msg)
        ? " Check that GEMINI_API_KEY is valid and has access to Gemma models."
        : /404|not found/i.test(msg)
          ? ` Model ${MODEL_ID} was not found for this key.`
          : /429|quota/i.test(msg)
            ? " Rate limit or quota reached — wait a minute and retry."
            : "";
      return { ok: false, code: "api_error", error: `Gemma 4 request failed.${hint}` };
    }
  });
