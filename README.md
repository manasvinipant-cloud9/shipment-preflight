# Shipment Pre-Flight

Conversational shipment booking and "pre-flight" error checker for UK → Germany / France / Netherlands freight
(GBP only). Next.js (App Router, TypeScript) on Vercel, Gemini for plain-English chat.

- **Chat booking**: describe a shipment in plain English. Gemini turns each message into structured edits;
  deterministic code applies them, asks only for what is missing (max 3 questions per turn), re-checks after every
  change (e.g. "add a pallet"), and shows live warnings.
- **Batch upload**: upload the case's **Bookings + Items** workbook (`.xlsx`, `.ods`) or a Bookings CSV and an Items CSV.
  Every booking is checked against the rate card (Sheet 3) and rulebook R-01 to R-10 (Sheet 4). No LLM, no key.

Every result gives: what is wrong, how serious (Red blocks, Amber warns), how to fix it, a recommended carrier with the
reasoning for the seller's priority, a plain-language confirmation, and what happens next. No login.

## Run locally

```bash
npm install
cp .env.example .env.local     # then paste your key after GEMINI_API_KEY=
npm run dev                    # http://localhost:3000
```

Without a key the app still works: chat falls back to the offline parser (`field: value` lines, which the example buttons
use) and says so on screen. Batch upload never needs a key.

```bash
npm run verify                 # typecheck + tests + production build
```

## Keys and settings

Local: `.env.local` (git-ignored). Production: Vercel → Project → Settings → Environment Variables (same names). Never commit keys.

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | Enables plain-English chat. Server-only; the browser never sees it. |
| `GEMINI_MODEL` | Primary model. Default `gemini-3.7-flash`. |
| `GEMINI_FALLBACK_MODELS` | Comma-separated models tried in order when the primary is out of quota (429), overloaded (503) or retired (404). |

A wrong key fails fast with a clear message in the chat. The header has an **Offline mode** switch for demos if the API is slow.

## Deploy to Vercel

1. Push this repo to GitHub.
2. vercel.com → **Add New → Project** → import the repo. Framework is detected as Next.js (`vercel.json`).
3. Before deploying, open **Environment Variables** and add `GEMINI_API_KEY` (and optionally the two model variables). Apply to Production and Preview.
4. **Deploy**. If you add or change a variable later, **redeploy** so it takes effect.
5. Open the URL in a private window: it loads with no login.

Public URL plus your key means anyone can spend your quota: use a key with a spending cap. If the quota runs out the chat
says so and judges can switch on Offline mode; batch upload and all rule checks keep working.

## How it is built

```
src/app/                 page, API routes: /api/chat (stateless), /api/batch, /api/status
src/components/          App, ChatTab, BatchTab, ReportView
src/lib/engine/
  rules.ts               R-01..R-10, pure functions
  carriers.ts            fixed rate card, hard weight filter, priority scoring, cost cap, justification
  report.ts              findings + carrier + plain-language summary
  conversation.ts        state machine: slots, patch ops, stale totals, phases (state is plain JSON)
  extractor.ts           output sanitising + the keyless offline parser
  gemini.ts              Gemini extractor with model fallback (server-only)
  sheets.ts              Bookings + Items workbook / CSV / .ods loader and batch runner
fixtures/                sample workbook + CSV pair, golden.json
public/samples/          sample files served to the browser
```

- **The model only extracts.** All state changes, arithmetic and rule decisions are deterministic and tested; model output
  is filtered and re-validated, so it cannot write bad state or skip a rule.
- **Stateless API.** The browser holds the conversation state and sends it with each message, so it works on serverless.
- **R-05 is judged against the chosen carrier**, as the rulebook says: the service the seller's priority points to. If it
  cannot take the pallet weight, R-05 is Red with concrete fixes (add pallets, or switch to a named service that can), and
  the recommendation shows the compliant option. If no service can, there is no recommendation.
- **Carrier scoring**: cost, transit and on-time rate relative to the best option, weighted by priority (Cheapest 70/15/15,
  Fastest 10/70/20, Most reliable 10/15/75, Balanced 40/30/30). A cost-ratio cap (1.5x cheapest for Cheapest and Balanced,
  3x for Most reliable, none for Fastest) stops a small gain from justifying a large premium.
- **Blank HS code** is a Red (R-01) and blank origin an Amber (R-09), even though the template allows blanks.
- **Parity test.** `fixtures/golden.json` holds outputs of the original Python engine; `npm test` asserts this TypeScript
  engine reproduces every finding, carrier pick, justification and chat reply exactly.
