import { Link } from "@tanstack/react-router";
import { ShieldAlert, Activity } from "lucide-react";
import type { ReactNode } from "react";
import { DISCLAIMER } from "@/lib/report";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy text-navy-foreground print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Activity className="h-5 w-5 text-primary" aria-hidden />
            MedTrace AI
          </Link>
          <span className="hidden text-sm opacity-80 sm:block">From Device Error to Evidence-Based Action</span>
        </div>
      </header>
      <div role="note" className="border-b bg-warning text-warning-foreground print:hidden">
        <div className="mx-auto flex max-w-6xl gap-2 px-5 py-2.5 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{DISCLAIMER} Use synthetic data only — never upload patient information.</p>
        </div>
      </div>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  );
}
