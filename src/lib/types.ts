export const MODEL_ID = "gemma-4-26b-a4b-it";
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB

export type DeviceDetails = {
  manufacturer: string;
  deviceType: string;
  modelNumber: string;
  serialNumber: string;
  department: string;
  notes: string;
};

export type Findings = {
  visibleDeviceInfo: {
    manufacturer: string | null;
    deviceType: string | null;
    model: string | null;
    serial: string | null;
  };
  errorCodes: string[];
  visibleErrorText: string[];
  screenDescription: string;
  confidence: "high" | "medium" | "low";
  uncertaintyNotes: string;
  unreadable: string[];
  followUpQuestions: string[];
};

export type AnalyzeResult =
  | { ok: true; findings: Findings; model: string }
  | { ok: false; code: "missing_key" | "invalid_input" | "api_error" | "unparseable"; error: string };

export type ManualPage = { page: number; text: string };

export type EvidencePassage = {
  page: number;
  excerpt: string;
  matchedTerms: string[];
  score: number;
};

export type ManualSearchResult = {
  passages: EvidencePassage[];
  modelMentioned: boolean | null; // null when no model number is known
  searchedTerms: string[];
};
