import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, BookOpen, FileDown, ImageUp, Loader2, Printer, ShieldCheck, Upload } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { analyzeErrorScreen } from "@/lib/analyze.functions";
import { createSingleFlight } from "@/lib/gemini-errors";
import { prepareImageForAnalysis, type PreparedImage } from "@/lib/image-prepare";
import { searchManual } from "@/lib/manual-search";
import { buildHypotheses, downloadReportPdf, NO_EVIDENCE, type IncidentReport } from "@/lib/report";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  MODEL_ID,
  type DeviceDetails,
  type ManualPage,
} from "@/lib/types";

export const Route = createFileRoute("/incident")({
  head: () => ({
    meta: [
      { title: "New Device Incident — MedTrace AI" },
      { name: "description", content: "Upload a device error screen and manual to generate a cited incident report." },
      { property: "og:title", content: "New Device Incident — MedTrace AI" },
      { property: "og:description", content: "Create an evidence-cited medical-device incident report." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IncidentPage,
});

const SAMPLE_MANUAL = { name: "NovaFlow IP-200 Sample Manual (FICTIONAL)", url: "/samples/novaflow-ip200-sample-manual.pdf" };
const SAMPLE_DETAILS: DeviceDetails = {
  manufacturer: "NovaFlow Medical (fictional)",
  deviceType: "Volumetric infusion pump",
  modelNumber: "IP-200",
  serialNumber: "",
  department: "Demo Ward 4B (fictional)",
  notes: "Synthetic demo incident. Alarm reported during routine round.",
};
const EMPTY: DeviceDetails = { manufacturer: "", deviceType: "", modelNumber: "", serialNumber: "", department: "", notes: "" };

type ManualChoice = { kind: "none" } | { kind: "sample" } | { kind: "file"; file: File };

// Module-level caches so re-running an analysis never re-reads the same manual
// or re-encodes the same image.
const manualCache = new Map<string, ManualPage[]>();
const imageCache = new WeakMap<File, Promise<PreparedImage>>();

const getManualPages = async (key: string, load: () => Promise<ArrayBuffer>): Promise<ManualPage[]> => {
  const hit = manualCache.get(key);
  if (hit) return hit;
  const pages = await (await import("@/lib/pdf-extract")).extractPdfPages(await load());
  manualCache.set(key, pages);
  return pages;
};

const getPreparedImage = (f: File): Promise<PreparedImage> => {
  let p = imageCache.get(f);
  if (!p) {
    p = prepareImageForAnalysis(f);
    imageCache.set(f, p);
  }
  return p;
};

function IncidentPage() {
  const analyze = useServerFn(analyzeErrorScreen);
  const flightRef = useRef<ReturnType<typeof createSingleFlight>>(null);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [details, setDetails] = useState<DeviceDetails>(EMPTY);
  const [manual, setManual] = useState<ManualChoice>({ kind: "none" });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [report, setReport] = useState<IncidentReport | null>(null);

  const set = (k: keyof DeviceDetails) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDetails((d) => ({ ...d, [k]: e.target.value }));

  const onImage = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setError(null);
    if (!f) return;
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(f.type)) return setError("Image must be JPG, PNG or WebP.");
    if (f.size > MAX_IMAGE_BYTES) return setError("Image must be 5 MB or smaller.");
    setImage(f);
    setPreview(URL.createObjectURL(f));
  };

  const onManual = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setError(null);
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) return setError("Manual must be a PDF.");
    if (f.size > MAX_PDF_BYTES) return setError("Manual PDF must be 20 MB or smaller.");
    setManual({ kind: "file", file: f });
  };

  const loadDemo = async () => {
    const blob = await (await fetch("/samples/sample-error-screen.png")).blob();
    const f = new File([blob], "sample-error-screen.png", { type: "image/png" });
    setImage(f);
    setPreview(URL.createObjectURL(f));
    setDetails(SAMPLE_DETAILS);
    setManual({ kind: "sample" });
  };

  const runOnce = async () => {
    if (!image) return setError("Upload an error-screen image first.");
    const t0 = performance.now();
    setError(null);
    setReport(null);
    const warn: string[] = [];
    try {
      let pages: ManualPage[] | null = null;
      let manualName: string | null = null;
      let manualMs = 0;
      if (manual.kind !== "none") {
        setStatus("Extracting manual text…");
        const t = performance.now();
        manualName = manual.kind === "sample" ? SAMPLE_MANUAL.name : manual.file.name;
        const key = manual.kind === "sample" ? SAMPLE_MANUAL.url : `${manual.file.name}:${manual.file.size}`;
        const load =
          manual.kind === "sample"
            ? async () => (await fetch(SAMPLE_MANUAL.url)).arrayBuffer()
            : () => manual.file.arrayBuffer();
        try {
          pages = await getManualPages(key, load);
          if (!pages.some((p) => p.text.length > 20)) {
            warn.push("The manual has no extractable text (it may be a scanned PDF). OCR is not supported in this MVP, so no manual evidence can be cited.");
          }
        } catch {
          warn.push("The manual PDF could not be read. It may be corrupted or password-protected.");
          pages = [];
        }
        manualMs = performance.now() - t;
      }

      setStatus(`Reading the error screen with ${MODEL_ID}…`);
      const tPrep = performance.now();
      const prepared = await getPreparedImage(image);
      const prepMs = performance.now() - tPrep;
      const tApi = performance.now();
      const res = await analyze({ data: { imageBase64: prepared.base64, mimeType: prepared.mimeType, details } });
      const apiMs = performance.now() - tApi;
      if (!res.ok) {
        console.info(`[incident] failed prepMs=${prepMs.toFixed(0)} apiMs=${apiMs.toFixed(0)}`);
        setError(res.error);
        return;
      }

      setStatus("Searching manual for evidence…");
      const tSearch = performance.now();
      const search = pages
        ? searchManual(pages, res.findings.errorCodes, details.modelNumber || res.findings.visibleDeviceInfo.model)
        : null;
      const searchMs = performance.now() - tSearch;
      setWarnings(warn);
      setReport({
        id: Date.now().toString(36).toUpperCase(),
        createdAt: new Date().toISOString(),
        model: res.model,
        details,
        findings: res.findings,
        manualName,
        manualPages: pages?.length ?? 0,
        search,
        hypotheses: buildHypotheses(res.findings, details, search),
      });
      console.info(
        `[incident] ok manualMs=${manualMs.toFixed(0)} prepMs=${prepMs.toFixed(0)} resized=${prepared.resized} apiMs=${apiMs.toFixed(0)} searchMs=${searchMs.toFixed(0)} totalMs=${(performance.now() - t0).toFixed(0)}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setStatus(null);
    }
  };

  // Single-flight guard: clicks (or the Retry button) while an analysis is
  // running are ignored instead of launching duplicate API requests.
  if (!flightRef.current) flightRef.current = createSingleFlight(runOnce);
  else (flightRef.current as { fn?: unknown }).fn = undefined;
  const run = () => flightRef.current!.run();

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">New Device Incident</h1>
          <p className="text-sm text-muted-foreground">Serial number and all device fields are optional.</p>
        </div>
        <Button variant="outline" onClick={loadDemo}>Load fictional demo data</Button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-5 print:hidden">
          <Panel title="1. Error-screen photo" icon={<ImageUp className="h-4 w-4" />}>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input bg-muted p-5 text-center text-sm hover:border-primary">
              {preview ? (
                <img src={preview} alt="Uploaded device error screen" className="max-h-48 rounded" />
              ) : (
                <><Upload className="h-6 w-6 text-primary" /><span>Click to upload JPG, PNG or WebP (max 5 MB)</span></>
              )}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onImage} />
            </label>
          </Panel>

          <Panel title="2. Device details (optional)">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="mf" label="Manufacturer" value={details.manufacturer} onChange={set("manufacturer")} />
              <Field id="dt" label="Device type" value={details.deviceType} onChange={set("deviceType")} />
              <Field id="mn" label="Model number" value={details.modelNumber} onChange={set("modelNumber")} />
              <Field id="sn" label="Serial number" value={details.serialNumber} onChange={set("serialNumber")} />
              <div className="sm:col-span-2"><Field id="dp" label="Hospital department" value={details.department} onChange={set("department")} /></div>
              <div className="sm:col-span-2">
                <Label htmlFor="nt">Incident notes</Label>
                <Textarea id="nt" className="mt-1" rows={3} value={details.notes} onChange={set("notes")} placeholder="No patient information." />
              </div>
            </div>
          </Panel>

          <Panel title="3. Manufacturer manual" icon={<BookOpen className="h-4 w-4" />}>
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={manual.kind === "sample"} onChange={() => setManual({ kind: "sample" })} />
                Use bundled sample: <strong>{SAMPLE_MANUAL.name}</strong>
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={manual.kind === "none"} onChange={() => setManual({ kind: "none" })} />
                No manual
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border bg-muted px-3 py-2 hover:border-primary">
                <Upload className="h-4 w-4 text-primary" />
                {manual.kind === "file" ? manual.file.name : "Upload PDF (max 20 MB)"}
                <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={onManual} />
              </label>
            </div>
          </Panel>

          <Button size="lg" className="w-full" disabled={!!status} onClick={run}>
            {status ? <><Loader2 className="h-4 w-4 animate-spin" /> {status}</> : "Analyze & build report"}
          </Button>
          {error && (
            <div role="alert" className="flex gap-2 rounded-md border border-destructive bg-card p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span>
            </div>
          )}
        </div>

        <div>
          {report ? (
            <ReportView report={report} warnings={warnings} />
          ) : (
            <div className="flex h-full min-h-64 items-center justify-center rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
              The structured report with image observations, manual citations and open questions will appear here.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Panel({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-primary">{icon}{title}</h2>
      {children}
    </section>
  );
}

function Field(p: { id: string; label: string; value: string; onChange: (e: ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <div>
      <Label htmlFor={p.id}>{p.label}</Label>
      <Input id={p.id} className="mt-1" value={p.value} onChange={p.onChange} maxLength={100} />
    </div>
  );
}

function ReportView({ report: r, warnings }: { report: IncidentReport; warnings: string[] }) {
  const f = r.findings;
  const v = f.visibleDeviceInfo;
  const passages = r.search?.passages ?? [];
  return (
    <article className="space-y-5 rounded-lg border bg-card p-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div>
          <h2 className="text-xl font-semibold">Device Incident Report</h2>
          <p className="font-mono text-xs text-muted-foreground">#{r.id} · {new Date(r.createdAt).toLocaleString()} · {r.model}</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button onClick={() => downloadReportPdf(r)}><FileDown className="h-4 w-4" /> PDF</Button>
          <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
        </div>
      </header>

      {warnings.map((w) => (
        <p key={w} className="rounded-md bg-warning p-3 text-sm text-warning-foreground">{w}</p>
      ))}

      <Section n="1" title="Observations from the image" tag="Unverified AI reading">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Item k="Error codes" v={f.errorCodes.join(", ") || "None legible"} mono />
          <Item k="Confidence" v={f.confidence} />
          <Item k="On-screen text" v={f.visibleErrorText.join(" | ") || "—"} />
          <Item k="Visible device info" v={[v.manufacturer, v.deviceType, v.model, v.serial].filter(Boolean).join(", ") || "—"} />
        </dl>
        <p className="mt-2 text-sm">{f.screenDescription}</p>
        {f.uncertaintyNotes && <p className="mt-1 text-sm text-muted-foreground">{f.uncertaintyNotes}</p>}
      </Section>

      <Section n="2" title="Supported by the manual" tag={r.manualName ? `${r.manualName} · ${r.manualPages} pages` : "No manual"}>
        {passages.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm font-semibold">{NO_EVIDENCE}</p>
        ) : (
          <ul className="space-y-3">
            {passages.map((p, i) => (
              <li key={i} className="rounded-md border-l-4 border-primary bg-muted p-3">
                <p className="font-mono text-xs font-medium text-primary">Page {p.page} · matched: {p.matchedTerms.join(", ")}</p>
                <blockquote className="mt-1 whitespace-pre-line text-sm">{p.excerpt}</blockquote>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Retrieval: exact keyword match on error codes and model number. Excerpts are verbatim manual text.</p>
      </Section>

      <Section n="3" title="Unverified hypotheses & missing information">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {(r.hypotheses.length ? r.hypotheses : ["None noted."]).map((h) => <li key={h}>{h}</li>)}
        </ul>
        {f.followUpQuestions.length > 0 && (
          <>
            <p className="mt-3 text-sm font-semibold">Follow-up questions</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">{f.followUpQuestions.map((q) => <li key={q}>{q}</li>)}</ul>
          </>
        )}
      </Section>

      <Section n="4" title="Recommended escalation">
        <p className="flex gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
          Escalate to a qualified biomedical engineer for verification. Follow hospital procedures for equipment in clinical use. This report is not a diagnosis or repair instruction.
        </p>
      </Section>
    </article>
  );
}

function Section({ n, title, tag, children }: { n: string; title: string; tag?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy text-xs text-navy-foreground">{n}</span>
        <h3 className="font-semibold">{title}</h3>
        {tag && <span className="rounded bg-accent px-2 py-0.5 text-xs text-accent-foreground">{tag}</span>}
      </div>
      {children}
    </section>
  );
}

function Item({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className={mono ? "font-mono font-medium" : ""}>{v}</dd>
    </div>
  );
}
