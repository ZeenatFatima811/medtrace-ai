import type { EvidencePassage, ManualPage, ManualSearchResult } from "./types";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Build a tolerant regex for a code/model: "E-104" matches "E104", "E 104", "e-104". */
export function termRegex(term: string): RegExp | null {
  const groups = term.toUpperCase().match(/[A-Z]+|[0-9]+/g);
  if (!groups || groups.join("").length < 2) return null;
  return new RegExp(`(?<![A-Z0-9])${groups.map(escape).join("[\\s\\-_./]?")}(?![A-Z0-9])`, "i");
}

const CONTEXT_KEYWORDS = ["error", "alarm", "warning", "caution", "troubleshoot", "fault", "escalate"];

/**
 * Keyword search over extracted manual pages. A passage is only returned when it
 * contains one of the error codes read from the image — keyword-only hits are never
 * treated as evidence, so unrelated manuals yield zero passages.
 */
export function searchManual(
  pages: ManualPage[],
  errorCodes: string[],
  modelNumber: string | null,
  maxPassages = 6,
): ManualSearchResult {
  const codes = [...new Set(errorCodes.map((c) => c.trim()).filter(Boolean))];
  const codeRes = codes.map((c) => ({ term: c, re: termRegex(c) })).filter((x) => x.re) as {
    term: string;
    re: RegExp;
  }[];
  const modelRe = modelNumber?.trim() ? termRegex(modelNumber.trim()) : null;

  const passages: EvidencePassage[] = [];
  let modelMentioned: boolean | null = modelRe ? false : null;

  for (const { page, text } of pages) {
    if (modelRe && modelRe.test(text)) modelMentioned = true;
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const used = new Set<number>();
    lines.forEach((line, i) => {
      if (used.has(i)) return;
      const hits = codeRes.filter((c) => c.re.test(line)).map((c) => c.term);
      if (!hits.length) return;
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 4);
      for (let k = start; k < end; k++) used.add(k);
      const excerpt = lines.slice(start, end).join("\n");
      const lower = excerpt.toLowerCase();
      const kw = CONTEXT_KEYWORDS.filter((k) => lower.includes(k));
      const modelHit = modelRe && modelRe.test(excerpt) ? [modelNumber!.trim()] : [];
      passages.push({
        page,
        excerpt,
        matchedTerms: [...hits, ...modelHit, ...kw],
        score: hits.length * 10 + modelHit.length * 3 + kw.length,
      });
    });
  }

  passages.sort((a, b) => b.score - a.score || a.page - b.page);
  return {
    passages: passages.slice(0, maxPassages),
    modelMentioned,
    searchedTerms: [...codes, ...(modelNumber?.trim() ? [modelNumber.trim()] : [])],
  };
}
