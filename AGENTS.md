<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Gemma 4 calls go through `@google/genai` in `src/lib/analyze.functions.ts` only, reading `GEMINI_API_KEY` inside the handler — user required that SDK/model; key must never reach the browser.
- Manual citations come only from deterministic keyword search (`src/lib/manual-search.ts`) over pdf.js-extracted pages; the model never writes citations — prevents fabricated page numbers.
