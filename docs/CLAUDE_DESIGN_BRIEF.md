# Shipment Pre-Flight: UI/UX design brief

Paste or upload this file into Claude Design. It describes the product, every screen and state, the current visual system, and what is open for redesign.

Live app: https://shipment-preflight-nine.vercel.app · Code: github.com/manasvinipant-cloud9/shipment-preflight (Next.js App Router, TypeScript, deployed on Vercel)

---

## 1. Product in one paragraph

Shipment Pre-Flight is a conversational booking and error-checking tool for UK → Europe freight (destinations: Germany, France, Netherlands; currency GBP only). A seller describes a shipment in plain English (or uploads a Bookings + Items spreadsheet). The app extracts the details, asks only for what is missing, checks the booking against 10 customs and warehouse rules, shows exactly what is wrong and how to fix it, recommends a carrier with a plain-language reason based on the seller's priority, and produces a confirmation the seller can understand. It was built for an AI x Ops hackathon; judges open a public link with no login and test it.

**Primary users:** hackathon judges (first-time visitors, minutes to explore), and by extension freight sellers / ops staff booking pallets.
**Success looks like:** within 30 seconds a first-time visitor understands what it does, triggers a result, sees *what is wrong, how serious, how to fix it*, and *which carrier and why*.

## 2. Hard constraints (do not change)

- Stack: Next.js (App Router) + TypeScript on Vercel. No login. Public, anonymous.
- All behaviour, data, copy of rules/findings, routes (`/` plus `/api/chat`, `/api/batch`, `/api/status`).
- Rules R-01 to R-10, severities (Red blocks, Amber warns), the fixed rate card, GBP only.
- Window set: Telegraph (chat), Ledger (compliance), Freight (rate matrix), Manifest (batch inspector) stay in sync. Minimize and maximize on each window.
- Keyboard accessible, visible focus, legible text, reduced-motion respected, no horizontal page scroll on phones.

## 3. Visual system currently applied ("Software")

Open light page, tightly set dark sans headings, one electric-blue action colour, white rounded cards, two dark passages.

| Token | Value | Use |
|---|---|---|
| ground | `#fcfcfd` | page |
| ground-muted | `#f3f4f6` | shared pale fields (workspace band) |
| panel | `#ffffff` | cards |
| ink / ink-secondary | `#16191f` / `#454c58` | text |
| rule | `#dde0e6` | hairlines (1px) |
| accent | `#074ce0` | actions, selected states, small icons |
| field / on-field / on-field-secondary | `#16191f` / `#fcfcfd` / `#d0d4dd` | dark passages |
| status red / amber / green | `#b42318` / `#93370d` / `#067647` (+ tinted backgrounds) | functional only: badges and rows |

Type: **Host Grotesk** (display, headings, figures; bold, tight tracking) and **Instrument Sans** (body, labels, controls). Body 16px / 1.6; interface 15px; small 14px; metadata 13px; labels 12px (uppercase, tracked).
Shape: card radius 12px, buttons 8px, hairline borders, soft shadow `0 1px 2px / 0 8px 24px` at low opacity.
Motion: 160ms ease-out on hover and press only. No page-entrance animation, no continuous animation. Hero diagram is still.

## 4. Page structure (top to bottom)

```
┌ Sticky top bar: logo + "Shipment Pre-Flight" | Telegraph · Ledger · Rate matrix · Manifest | mode pill · Settings
├ Hero (white): headline + lead + 2 buttons          |  still diagram: chat + Sheets 1-4 converge on "Pre-flight"
│   ruled facts strip: Lanes · Currency · Automated checks · Blocks/Warns · Open to everyone
├ Workspace (pale grey field)
│   heading + one-line lead
│   Freight ticker: static scrollable rate board (one chip per carrier/lane)
│   ┌───────────────┬──────────────────┐
│   │ Telegraph     │ Ledger           │   desktop: chat is tall on the left,
│   │ (chat)        ├──────────────────┤   ledger + freight stacked on the right,
│   │               │ Freight          │   manifest full width underneath
│   ├───────────────┴──────────────────┤
│   │ Manifest (batch inspector)       │
│   └──────────────────────────────────┘
├ Dark passage: "How it works": 3 numbered steps linked across a row + 3 benefits
├ Pale: "Rate card and rulebook": two native disclosures (plus rotates)
└ Dark footer: brand, one line, links
```

Headline: "Catch shipment mistakes **before** they leave the UK." (word "before" in accent blue)
Lead: "Describe a booking in plain English or upload a sheet. Ten automated customs and warehouse checks, the exact fix for each problem, and a carrier recommendation you can explain."
Buttons: primary "Start a booking" (scrolls to workspace), secondary "See the rate card and rulebook".

Steps: 1 Describe or upload · 2 Pre-flight checks · 3 Fix, then confirm. Benefits: Exact fixes · Explainable carrier choice · No login.

## 5. The four windows

Each window is a white card with a header (title, subtitle, minimize ＋/－, maximize ⤢/⤡). Maximizing one hides the others and gives it the full width.

### 5.1 Telegraph: conversational intake
- **Notice** when no AI key is set: offline parser in use, explains the `field: value` format.
- **Quick launch** buttons: ▶ Clean booking · ▶ Booking with mistakes · ▶ Change mid-chat (loads clean booking, then "add a pallet") · ▶ Plain English (disabled without Gemini).
- **Message log**: rows of label + text. Operator (blue label) and Seller (grey label). Operator lines are short; the full result goes to the slip below.
- **Booking docket** (collapsed disclosure): "8/8 details · 2 item(s) · London → Lyon", chips for each of 8 required fields (green when filled), item lines.
- **Confirmation slip** (after pre-flight): status badge, red/amber counts, the plain-language summary (monospace-free paragraph), buttons CONFIRM BOOKING (only if not blocked), Save summary, Save JSON. After confirming: [BOOKED] badge.
- **Composer**: textarea (Enter sends, Shift+Enter newline), SEND and NEW buttons.
- **Behaviour to design for:** asks at most 3 questions per turn; re-asks to reconfirm totals after a change ("add a pallet" → "is the total gross weight still 620 kg?"); shows live warnings ("Heads-up [Red] …") as soon as data allows.
- **Error state:** "Sorry, I couldn't read that just now … Nothing was changed" plus a warning strip about the key/quota.

### 5.2 Ledger: customs and compliance
- Header line: "AUDITING: Telegraph session" or a booking id; overall status badge; tally "RED 5 · AMBER 1 · PASS 4".
- Table of all 10 rules: Rule id · Check · Severity · Status badge. Failing rules expand inline with FIELD (code style), detail with the actual numbers, and a **FIX** line.
- Badges: `[RED - BLOCKING]` `[AMBER - WARNING]` `[PASS]` `[PENDING]` (pending = draft, not enough data yet).
- Empty state: "LEDGER IDLE. Describe a booking … or select an uploaded booking …".

### 5.3 Freight: ticker and rate matrix
- Header: "QUOTING: <source> · Germany · 2 pallets", and a **Seller priority** dropdown (Cheapest, Fastest, Most reliable, Balanced) so users can try "what-if" re-ranking. A note appears when the choice differs from the seller's.
- One card per carrier on the lane: rank (#1, #2, --), carrier name, service, badge ([RECOMMENDED] [RANKED] [COST-CAPPED] [TOO HEAVY]), stats (cost, transit days, on-time %, max kg/pallet, score), a "rate ratio" meter (best cost ÷ this cost; explains why air/express outliers can't dominate), and a one-line note.
- **Operator note**: plain-language justification, e.g. "Carrier B (Road standard) is recommended for a 'Balanced' priority because it gives the best trade-off … It costs £80.00 more than the cheapest option … but is 2 days faster and 3 points more reliable."
- Empty state: "NO LANE SELECTED …".

### 5.4 Manifest: batch file inspector
- **Drop zone** (click or drag): .xlsx, .ods, or two .csv files (Bookings + Items). Buttons: RUN SAMPLE WORKBOOK, Download sample.
- **Tally:** "10 BOOKINGS · 2 READY · 2 REVIEW · 6 BLOCKED" with filter buttons (All / Blocked / Review / Ready).
- **Booking table** (selectable rows): Booking · Status badge · Seller · Route · Priority · Red · Amber · Rules hit · Recommended carrier · Cost. Selecting a row drives the Ledger and Freight windows.
- **Export:** Findings (CSV), Confirmations (TXT), Full results (JSON).
- **Inspector** for the selected booking: header, totals strip (pallets, cartons vs items, gross vs goods weight, declared vs items value, ready date, appointment, priority; mismatches in red/amber), **item grid** (SKU, description, HS code, qty, £/unit, units/carton, cartons, kg/unit, line kg, origin; missing HS or origin shown in red/amber), data notes, Save confirmation / Save JSON, collapsible plain-language summary.
- Collapsibles: "What each sample booking tests", "Rate card and rulebook in use".
- States: empty ("MANIFEST EMPTY …"), processing spinner, upload error banner, file-level notes (e.g. orphan items).

## 6. Domain content (use real wording; do not invent data)

**Rules** (Red = blocks booking, Amber = warns):
R-01 HS code ≥ 6 digits (Red) · R-02 declared value = Σ qty × unit price within 1% (Red) · R-03 units per carton × cartons = quantity (Red) · R-04 total cartons = Σ item cartons (Red) · R-05 weight per pallet ≤ chosen carrier's max (Red) · R-06 no lithium batteries, aerosols, flammable liquids (Red) · R-07 gross weight ≥ goods weight (Amber) · R-08 warehouse needs a delivery appointment (Amber) · R-09 every item has a country of origin (Amber) · R-10 ready date not in the past (Amber).

**Rate card** (UK → destination): Carrier A Road economy £180/£170/£160 per pallet (DE/FR/NL), 5 days, 92% on time, max 500 kg/pallet · Carrier B Road standard £220/£210/£200, 3 days, 95%, 750 kg · Carrier C Road express £340/£330/£320, 2 days, 98%, 400 kg.

**Seller priorities:** Cheapest · Fastest · Most reliable · Balanced. Cost-ratio cap keeps premium services out of Cheapest/Balanced/Most reliable unless the seller asked for Fastest.

**Overall status:** Ready to book (all pass) · Review warnings (amber only) · Blocked: fix required (any red).

**Sample finding:** "R-05 Pallet too heavy: 1300 kg over 2 pallet(s) = 650 kg/pallet; Carrier A (Road economy) allows 500 kg. FIX: Either split the load over at least 3 pallets so each is under 500 kg, or switch to Carrier B (Road standard), which accepts 750 kg per pallet (£440.00, 3 days)."

**Sample confirmation:** "Booking BK-002 (Harbour Home Ltd): London, United Kingdom to Paris, France (Business address), 2 pallet(s), 200 kg … Recommended carrier: Carrier B (Road standard) - £420.00, 3 day(s), 95% on time. What happens next: Everything checks out. Carrier B collects from London on 09-11-2026 and delivers to Paris in about 3 day(s) (around 12-11-2026), for £420.00."

## 7. Key flows to design around

1. **First visit → first result (target < 30 s):** land on hero → "Start a booking" → click a Quick launch example → Ledger, Freight and the confirmation slip all fill → CONFIRM BOOKING.
2. **Mid-conversation change:** "Change mid-chat" → pallets 2 → 3 → app asks to reconfirm weight → "unchanged" → new cost shown.
3. **Fix a blocked booking:** "Booking with mistakes" → read red findings with fixes → answer in chat → status moves Blocked → Review/Ready.
4. **Batch:** Run sample workbook → scan tally → click a blocked booking → read Ledger + item grid → export CSV.
5. **What-if pricing:** change the priority dropdown in Freight and watch the ranking and justification change.

## 8. Responsive and accessibility requirements

- ≥1051px: two-column workspace as above. ≤1050px: tighter gaps, windows stack in one column. ≤760px: hero stacks (diagram under copy), facts become 2 columns, process and benefits stack, top-bar window links hide, window subtitles hide. ≤480px: lists single column, footer links two columns.
- Tables scroll horizontally inside their own container; the page never scrolls sideways.
- Status must never rely on colour alone (text badges always present).

## 9. Known UX weaknesses (good places to improve)

- The Workspace is dense: four windows compete for attention. Is a guided "step" view (intake → issues → carrier → confirm) clearer than a four-window dashboard? Keep the windows available for power users.
- First-time visitors may not know where to click; the Quick launch buttons are small and live inside the chat window.
- Ledger rows with expanded fixes are long; consider grouping Red first, collapsing PASS rows.
- On phones the four windows stack into a very long page and the top-bar shortcuts disappear: needs a compact mobile navigation.
- The chat log and the confirmation slip are both plain text; the slip could use structure (route, totals, carrier, next steps) instead of one paragraph.
- Badge text keeps its bracket style (`[RED - BLOCKING]`) for continuity; open to a cleaner badge treatment if wording is preserved.
- Offline-parser and quota notices are technical; they could be friendlier.

## 10. What I want from the redesign

Improve clarity and speed to first result, reduce density without losing any function, keep the "Software" visual identity (or propose a stronger one that keeps these tokens recognisable), and deliver desktop and 390px mobile layouts for: hero, workspace (empty and populated), blocked-booking result, ready-booking result, batch result with an open booking, and the dark process and footer sections.
