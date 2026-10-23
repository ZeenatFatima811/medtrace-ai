import type { DeviceDetails, Findings, ManualSearchResult } from "./types";

export const NO_EVIDENCE = "No matching manual evidence found.";
export const DISCLAIMER =
  "MedTrace AI is a documentation and evidence-retrieval aid only. It does not diagnose devices, make clinical decisions or provide repair instructions. AI observations are unverified. Follow your hospital's procedures and escalate active equipment issues to a qualified biomedical engineer.";

export type IncidentReport = {
  id: string;
  createdAt: string;
  model: string;
  details: DeviceDetails;
  findings: Findings;
  manualName: string | null;
  manualPages: number;
  search: ManualSearchResult | null;
  hypotheses: string[];
};

export function buildHypotheses(f: Findings, d: DeviceDetails, s: ManualSearchResult | null): string[] {
  const out: string[] = [];
  if (!f.errorCodes.length) out.push("No error code could be read from the image; the alarm cannot be matched to manual content.");
  if (f.confidence !== "high") out.push(`Image reading confidence is ${f.confidence}. ${f.uncertaintyNotes}`.trim());
  if (!s) out.push("No manual was provided, so no statement can be verified against manufacturer documentation.");
  else if (!s.passages.length) out.push(`${NO_EVIDENCE} The meaning of the displayed code is unverified.`);
  if (s?.modelMentioned === false) out.push("The supplied manual does not mention the stated model number — it may not match this device.");
  if (!d.serialNumber) out.push("Serial number not provided.");
  if (f.visibleDeviceInfo.model && d.modelNumber && f.visibleDeviceInfo.model.replace(/\W/g, "").toUpperCase() !== d.modelNumber.replace(/\W/g, "").toUpperCase())
    out.push(`Model on screen ("${f.visibleDeviceInfo.model}") differs from model entered ("${d.modelNumber}").`);
  f.unreadable.forEach((u) => out.push(`Unreadable: ${u}`));
  return out;
}

export async function downloadReportPdf(r: IncidentReport) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  let y = M;
  const write = (text: string, size = 10, style: "normal" | "bold" | "italic" = "normal", gap = 4) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    for (const line of doc.splitTextToSize(text || "—", W - M * 2) as string[]) {
      if (y > H - M) { doc.addPage(); y = M; }
      doc.text(line, M, y);
      y += size * 1.35;
    }
    y += gap;
  };
  const h = (t: string) => { y += 6; write(t, 13, "bold", 2); };

  write("MedTrace AI — Device Incident Report", 18, "bold");
  write(`Report ${r.id} · ${new Date(r.createdAt).toLocaleString()} · Image analysis: ${r.model}`, 9, "italic");
  write(DISCLAIMER, 9, "italic", 8);

  h("Device details (user-entered)");
  const d = r.details;
  write(`Manufacturer: ${d.manufacturer || "—"}   Device type: ${d.deviceType || "—"}\nModel: ${d.modelNumber || "—"}   Serial: ${d.serialNumber || "not provided"}\nDepartment: ${d.department || "—"}`);
  if (d.notes) write(`Notes: ${d.notes}`);

  h("1. Observations from the uploaded image (unverified AI reading)");
  const v = r.findings.visibleDeviceInfo;
  write(`Error codes: ${r.findings.errorCodes.join(", ") || "none legible"}`);
  write(`On-screen text: ${r.findings.visibleErrorText.join(" | ") || "—"}`);
  write(`Visible device info: ${[v.manufacturer, v.deviceType, v.model, v.serial].filter(Boolean).join(", ") || "—"}`);
  write(`Description: ${r.findings.screenDescription}`);
  write(`Confidence: ${r.findings.confidence}. ${r.findings.uncertaintyNotes}`);

  h(`2. Statements supported by the manual${r.manualName ? ` (${r.manualName})` : ""}`);
  if (!r.search || !r.search.passages.length) write(NO_EVIDENCE, 10, "bold");
  else r.search.passages.forEach((p) => { write(`Page ${p.page}`, 10, "bold", 0); write(`"${p.excerpt}"`, 9, "normal", 6); });

  h("3. Unverified hypotheses / missing information");
  (r.hypotheses.length ? r.hypotheses : ["None noted."]).forEach((x) => write(`• ${x}`));
  if (r.findings.followUpQuestions.length) {
    write("Follow-up questions:", 10, "bold", 0);
    r.findings.followUpQuestions.forEach((q) => write(`• ${q}`));
  }

  h("4. Recommended escalation");
  write("Escalate to a qualified biomedical engineer for verification. Follow hospital procedures for equipment in clinical use. Do not rely on this report as a diagnosis or repair instruction.");

  doc.save(`medtrace-${r.id}.pdf`);
}
