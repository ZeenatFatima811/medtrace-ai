import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, FileText, Search, FileDown, Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { MODEL_ID } from "@/lib/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MedTrace AI — Device incident documentation" },
      { name: "description", content: "Turn a medical-device error screen and its manual into a cited, structured incident report." },
      { property: "og:title", content: "MedTrace AI — From Device Error to Evidence-Based Action" },
      { property: "og:description", content: "AI-assisted incident documentation for biomedical engineering teams, with page-cited manual evidence." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

const steps = [
  { icon: Camera, title: "Error screen photo", body: "JPG, PNG or WebP up to 5 MB." },
  { icon: FileText, title: "Manufacturer manual", body: "PDF with selectable text, or the fictional sample." },
  { icon: Search, title: "Read & retrieve", body: `${MODEL_ID} reads the screen; keyword search finds cited pages.` },
  { icon: FileDown, title: "Incident report", body: "Observations, citations and open questions — PDF or print." },
];

function Dashboard() {
  return (
    <AppShell>
      <section className="rounded-xl bg-navy p-8 text-navy-foreground sm:p-10">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Biomedical engineering · documentation</p>
        <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl">
          From device error to evidence-based action.
        </h1>
        <p className="mt-3 max-w-xl opacity-85">
          Document a device alarm with what the screen shows, what the manual actually says (with page numbers), and what still needs a qualified engineer.
        </p>
        <Button asChild size="lg" className="mt-6">
          <Link to="/incident"><Plus className="h-4 w-4" /> New Device Incident</Link>
        </Button>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <div key={s.title} className="rounded-lg border bg-card p-5">
            <div className="flex items-center gap-2 text-primary">
              <s.icon className="h-5 w-5" aria-hidden />
              <span className="font-mono text-xs">0{i + 1}</span>
            </div>
            <h2 className="mt-3 font-semibold">{s.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </section>

      <section className="mt-8 rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Try the fictional demo</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The bundled “NovaFlow IP-200” infusion pump manual and error screen are entirely fictional, created for this demo. NovaFlow is not a real manufacturer.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <a className="text-primary underline" href="/samples/sample-error-screen.png" download>Download sample error screen</a>
          <a className="text-primary underline" href="/samples/novaflow-ip200-sample-manual.pdf" target="_blank" rel="noreferrer">View sample manual (PDF)</a>
        </div>
      </section>
    </AppShell>
  );
}
