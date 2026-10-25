# Shipment Pre-Flight

Conversational shipment booking and "pre-flight" error checker for UK → Germany / France / Netherlands freight
(GBP only). Two ways in, one rulebook:

- **Chat booking**: describe a shipment in plain English. A Gemini model turns each message into structured edits;
  deterministic code applies them, asks only for what is missing (max 3 questions per turn), re-checks after every
  change (e.g. "add a pallet"), and shows live warnings.
- **Batch upload**: upload the case's **Bookings + Items** workbook (`.xlsx`, `.ods`) or a Bookings CSV and an Items CSV.
  Every booking is checked against the rate card (Sheet 3) and rulebook R-01 to R-10 (Sheet 4).

Every result gives: what is wrong, how serious (Red blocks, Amber warns), how to fix it, a recommended carrier with
the reasoning for the seller's priority, a plain-language confirmation, and what happens next. No login.

## Run locally

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export GEMINI_API_KEY=your-key        # optional; without it the app uses the offline parser
streamlit run app.py
```

Also: `python app.py --cli`, and `python app.py --check samples/test_bookings_items.xlsx [--json]`.

| Setting | Purpose |
|---|---|
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | Enables plain-English chat. Missing key: the app says so and runs the offline parser. |
| `PREFLIGHT_MODEL` | Gemini model id, default `gemini-2.5-flash`. |

Set them as environment variables or as Streamlit secrets (see `.streamlit/secrets.toml.example`).
The **offline parser** needs no key or network and understands `field: value` lines
(`samples/demo_chat.txt`, "Load structured demo" in the app). Batch upload never uses an LLM.

## Verify

```bash
python verify.py                       # structure, 3 test modules, headless UI run; no key needed
GEMINI_API_KEY=... python verify.py --live   # also calls the real model
```

## Deploy (public link, no login for visitors)

Streamlit Community Cloud, free:

1. Push this folder to a GitHub repo (`.venv/` and `secrets.toml` are git-ignored).
2. At share.streamlit.io choose **Create app**, pick the repo, main file `app.py`.
3. Advanced settings: Python 3.11 or newer; in **Secrets** paste `GEMINI_API_KEY = "..."`.
4. Deploy. Open the URL in a private window to confirm it loads without a login.

A public URL plus your key means anyone can spend your quota. Use a key with a spending cap or free tier; if the
quota runs out the app reports the failure and judges can switch the sidebar to **Offline parser**. Batch upload and
all rule checks keep working with no key.

## How it is built

```
app.py                  Streamlit UI + CLI
preflight/
  conversation.py       state machine: slots, patch ops, stale totals, phases
  extractor.py          GeminiExtractor, LLMExtractor (Claude), RuleBasedExtractor (offline); output is untrusted
  rules.py              R-01..R-10, pure functions
  carriers.py           fixed rate card, hard weight filter, priority scoring, cost cap, justification
  report.py             findings + carrier + plain-language summary
  sheets.py             Bookings + Items workbook / CSV loader and batch runner
samples/                test_bookings_items.xlsx (10 bookings, planted mistakes), CSV pair, demo chat
```

Design choices worth knowing:

- **The model only extracts.** All state changes, arithmetic and rule decisions are deterministic and unit-tested; model
  output is filtered and re-validated, so it cannot write bad state or skip a rule.
- **R-05 is judged against the chosen carrier**, as the rulebook says: the service the seller's priority points to.
  If it cannot take the pallet weight, R-05 is Red with concrete fixes (add pallets, or switch to a named service that can),
  and the recommendation shows the compliant option. If no service can take it, there is no recommendation.
- **Carrier scoring**: cost, transit and on-time rate relative to the best option, weighted by priority
  (Cheapest 70/15/15, Fastest 10/70/20, Most reliable 10/15/75, Balanced 40/30/30). A cost-ratio cap (1.5x cheapest for
  Cheapest and Balanced, 3x for Most reliable, none for Fastest) stops a small gain from justifying a large premium.
- **Blank HS code** is a Red (R-01) and blank origin an Amber (R-09), even though the template allows blanks.
