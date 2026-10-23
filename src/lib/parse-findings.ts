import type { Findings } from "./types";

export const clip = (v: unknown, n = 500) => (typeof v === "string" ? v.slice(0, n) : "");

/** Parse the model's JSON response into Findings; null when unparseable. */
export function parseFindings(text: string): Findings | null {
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
