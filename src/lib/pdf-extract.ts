import type { ManualPage } from "./types";

/** Browser-only: extract text per page (1-indexed page numbers) from a PDF. */
export async function extractPdfPages(data: ArrayBuffer): Promise<ManualPage[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: ManualPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.str + (item.hasEOL ? "\n" : " ");
    }
    pages.push({ page: i, text: text.replace(/[ \t]+/g, " ").trim() });
  }
  return pages;
}
