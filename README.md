# MedTrace AI

**From Device Error to Evidence-Based Action.**

MedTrace AI is a hackathon MVP that helps hospital biomedical engineering teams *document* medical-device incidents. Upload a photo of a device error screen, optionally add device details and a manufacturer manual (PDF), and get a structured incident report that separates:

1. Observations from the image (unverified AI reading)
2. Statements supported by the manual, with page citations (verbatim excerpts)
3. Unverified hypotheses and missing information
4. Recommended escalation to a qualified biomedical engineer

> **Disclaimer:** Documentation and evidence retrieval only. Not a diagnostic tool, not repair guidance, no clinical decision-making. Follow hospital procedures and escalate active equipment issues to qualified staff. Use synthetic data only — never upload patient information.

## Model

- Google **Gemma 4** — exact model ID `gemma-4-26b-a4b-it`
- SDK: official [`@google/genai`](https://www.npmjs.com/package/@google/genai), image sent as `inlineData` (base64) per the [Gemini API image understanding docs](https://ai.google.dev/gemini-api/docs/image-understanding)
- Gemma on the Gemini API: https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api
- Gemma 4 model docs: https://ai.google.dev/gemma/docs

## Architecture

```text
Browser (React + TS + Tailwind)                Server (TypeScript server function)
-------------------------------                -----------------------------------
image upload ── validate type/size ──────────► analyzeErrorScreen()
                                                 reads GEMINI_API_KEY (server only)
                                                 @google/genai → gemma-4-26b-a4b-it
                                     ◄──────── structured JSON findings
manual PDF ── pdf.js text per page
          └── keyword search (error codes, model) → cited passages
report = findings + verbatim passages + hypotheses → PDF (jsPDF) / print
```

- **Backend note:** this project runs on TanStack Start (React 19 + Vite), whose typed server functions play the role of the Express API. The model call, API key and prompt live only in `src/lib/analyze.functions.ts` and never reach the browser.
- **Retrieval:** deterministic keyword matching (`src/lib/manual-search.ts`). A passage is cited only when it contains an error code read from the screen. No vector DB, no semantic search.
- **Report:** assembled deterministically — the model never writes citations, so page numbers cannot be fabricated. If nothing matches: *"No matching manual evidence found."*

## Setup

```bash
git clone <your-repo-url> medtrace-ai && cd medtrace-ai
bun install            # or: npm install
cp .env.example .env   # then put your key after GEMINI_API_KEY=
bun run dev            # or: npm run dev → http://localhost:8080
bun run test           # or: npx vitest run
```

Get a key at https://aistudio.google.com/apikey. Frontend and backend start together with the single `dev` command.

### Test the real API call

1. Open http://localhost:8080 → **New Device Incident** → **Load fictional demo data**.
2. Click **Analyze & build report**. Gemma 4 should read code `E-104`; the report cites pages 3 and 4 of the sample manual.
3. Remove the key and retry to see the configuration error.

## Demo walkthrough

- Sample error screen: `public/samples/sample-error-screen.png` (synthetic)
- Sample manual: `public/samples/novaflow-ip200-sample-manual.pdf` — **fictional** manufacturer “NovaFlow”, not a real device.
- Try a different manual or code to see the *No matching manual evidence found* path.

## Limits & validation

- Images: JPG/PNG/WebP, ≤ 5 MB. Manuals: PDF, ≤ 20 MB, processed in the browser.
- Scanned PDFs with no text layer are detected and reported; OCR is not implemented.
- Model readings can be wrong; always verify against the physical device.
- No authentication or storage — reports exist only in the browser session.

## Publishing to GitHub

```bash
git init && git add . && git commit -m "MedTrace AI MVP"
git branch -M main
git remote add origin https://github.com/<you>/medtrace-ai.git
git push -u origin main
```

`.env` is git-ignored; never commit your key.

## License

MIT — see [LICENSE](LICENSE).
