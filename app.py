"""Shipment booking pre-flight: Streamlit web app (no login) + CLI in one file.

    streamlit run app.py                                   # web UI
    python app.py --cli [--offline]                        # terminal chat
    python app.py --check workbook.xlsx [--json]           # batch-check a Bookings+Items workbook
    python app.py --check bookings.csv items.csv           # ...or a CSV pair

Config (environment variables or Streamlit secrets):
    GEMINI_API_KEY / GOOGLE_API_KEY   enables plain-English chat (Gemini). Without one the app runs on the
                                      offline parser and says so.
    PREFLIGHT_MODEL                   Gemini model id, default gemini-2.5-flash.
"""
from __future__ import annotations

import argparse
import functools
import html
import json
import os
import sys
from datetime import date
from pathlib import Path

from preflight import Conversation
from preflight.carriers import DEFAULT_RATE_CARD
from preflight.conversation import SHIPMENT_SLOTS, ExtractorError
from preflight.extractor import DEFAULT_GEMINI_MODEL, make_extractor
from preflight.report import PreflightReport
from preflight.rules import RULEBOOK
from preflight.sheets import BookingResult, SheetError, confirmations_text, findings_csv, run_batch

HERE = Path(__file__).parent
SAMPLES = HERE / "samples"
SAMPLE_WORKBOOK = SAMPLES / "test_bookings_items.xlsx"
WELCOME = ("Hi! Tell me about your shipment from the UK to Germany, France or the Netherlands: where it's going, "
           "pallets, weight, and each product with its HS code, quantity and price. I'll ask only for what's "
           "missing and check everything before it goes anywhere.")
NL_EXAMPLE = ("I need to send 2 pallets of ceramic mugs from Manchester to a warehouse in Frankfurt, ready on "
              "1 December 2026. 520 kg in total and 30 cartons. It's 1080 mugs at £5 each, 12 per carton, "
              "0.5 kg each, HS code 691200, made in the UK. Declared value £5,400. No delivery appointment yet. "
              "Balanced please.")
EMOJI = {"READY": "🟩", "REVIEW": "🟧", "BLOCKED": "🟥"}
STATUS_TEXT = {"READY": "Ready to book", "REVIEW": "Review warnings", "BLOCKED": "Blocked: fix required"}

CSS = """
<style>
.block-container{padding-top:1.4rem;max-width:1240px}
header[data-testid="stHeader"]{background:transparent}
.hero{background:linear-gradient(120deg,#0b1f3a 0%,#16336b 100%);color:#fff;border-radius:16px;padding:22px 28px;margin-bottom:18px}
.hero h1{margin:0;font-size:1.65rem;font-weight:700;letter-spacing:-.01em;color:#fff}
.hero p{margin:6px 0 0;color:#cbd5e1;font-size:.97rem}
.hero .chips{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}
.hero .chip{background:rgba(255,255,255,.12);border-radius:999px;padding:3px 12px;font-size:.78rem;color:#e2e8f0}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px;margin-bottom:12px}
.card h4{margin:0 0 8px;font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:600}
.banner{border-radius:12px;padding:12px 16px;margin:6px 0 14px;display:flex;align-items:center;gap:12px;font-weight:600}
.banner small{font-weight:400;opacity:.85}
.banner.READY{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}
.banner.REVIEW{background:#fffbeb;color:#92400e;border:1px solid #fde68a}
.banner.BLOCKED{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
.pill{display:inline-block;border-radius:6px;padding:1px 8px;font-size:.72rem;font-weight:700;letter-spacing:.03em}
.pill.red{background:#dc2626;color:#fff}.pill.amber{background:#d97706;color:#fff}.pill.green{background:#16a34a;color:#fff}
.pill.rule{background:#e2e8f0;color:#334155;margin-left:6px}
.finding{border:1px solid #e2e8f0;border-left-width:5px;border-radius:10px;padding:11px 14px;margin:8px 0;background:#fff}
.finding.red{border-left-color:#dc2626;background:#fffafa}.finding.amber{border-left-color:#d97706;background:#fffdf7}
.finding .t{font-weight:650;color:#0f172a;margin-left:8px}
.finding .d{color:#334155;margin:6px 0 4px;font-size:.92rem}
.finding .f{color:#0f172a;font-size:.9rem}.finding .f b{color:#1d4ed8}
.carrier{border:1px solid #bfdbfe;background:linear-gradient(180deg,#f8fbff,#eef5ff);border-radius:14px;padding:16px 18px;margin:10px 0}
.carrier .top{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
.carrier .name{font-size:1.15rem;font-weight:700;color:#0b1f3a}.carrier .svc{color:#475569;font-weight:500}
.carrier .tag{background:#2563eb;color:#fff;border-radius:999px;font-size:.72rem;padding:2px 10px;font-weight:600}
.carrier .tag.prov{background:#94a3b8}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:12px 0}
.stat{background:#fff;border:1px solid #dbeafe;border-radius:10px;padding:9px 12px}
.stat .v{font-size:1.25rem;font-weight:700;color:#0b1f3a}.stat .l{font-size:.72rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
.why{color:#1e293b;font-size:.93rem;line-height:1.5}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:8px 0 16px}
.tile{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px}
.tile .v{font-size:1.7rem;font-weight:750;line-height:1.1}.tile .l{font-size:.75rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
.tile.READY .v{color:#16a34a}.tile.REVIEW .v{color:#d97706}.tile.BLOCKED .v{color:#dc2626}
.row{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid #f1f5f9;font-size:.9rem}
.row:last-child{border-bottom:0}.row .k{color:#64748b}.row .v{color:#0f172a;font-weight:550;text-align:right}.row .v.miss{color:#94a3b8;font-weight:400}
.note{background:#f1f5f9;border-radius:8px;padding:6px 10px;font-size:.85rem;color:#334155;margin:4px 0}
@media (max-width:760px){.stats,.tiles{grid-template-columns:repeat(2,1fr)}}
</style>
"""


# ------------------------------------------------------------------------------------------ HTML helpers
def esc(x) -> str:
    return html.escape("" if x is None else str(x))


def finding_html(f) -> str:
    kind = f.severity.value.lower()
    return (f'<div class="finding {kind}"><span class="pill {kind}">{f.severity.value.upper()}</span>'
            f'<span class="pill rule">{esc(f.rule_id)}</span><span class="t">{esc(f.title)}</span>'
            f'<div class="d">{esc(f.detail)}</div><div class="f"><b>How to fix:</b> {esc(f.fix)}</div></div>')


def banner_html(r: PreflightReport) -> str:
    sub = {"READY": "All 10 checks passed.",
           "REVIEW": f"{len(r.warnings)} warning(s). You can proceed, but check them first.",
           "BLOCKED": f"{len(r.errors)} blocking issue(s)" + (f" and {len(r.warnings)} warning(s)" if r.warnings else "")
                      + ". This must not ship until fixed."}[r.status]
    return (f'<div class="banner {r.status}"><span style="font-size:1.4rem">{EMOJI[r.status]}</span>'
            f'<div>{STATUS_TEXT[r.status]}<br><small>{esc(sub)}</small></div></div>')


def carrier_html(r: PreflightReport, priority) -> str:
    rec = r.recommendation
    lane = rec.lane
    tag = ("Provisional: changes once red issues are fixed" if r.provisional else f"Recommended for '{priority or 'Balanced'}'")
    stats = "".join(f'<div class="stat"><div class="v">{v}</div><div class="l">{l}</div></div>' for v, l in (
        (f"£{rec.cost_gbp:,.2f}", "Total cost"), (f"{rec.transit_days} day{'s' if rec.transit_days != 1 else ''}", "Transit time"),
        (f"{lane.on_time_pct:g}%", "On-time rate"), (f"{lane.max_pallet_kg:g} kg", "Max per pallet")))
    return (f'<div class="carrier"><div class="top"><div><span class="name">{esc(lane.name)}</span> '
            f'<span class="svc">· {esc(lane.service)}</span></div><span class="tag {"prov" if r.provisional else ""}">{esc(tag)}</span></div>'
            f'<div class="stats">{stats}</div><div class="why">{esc(r.justification)}</div></div>')


def render_report(st, r: PreflightReport, s, key: str, heading: bool = True) -> None:
    st.markdown(banner_html(r), unsafe_allow_html=True)
    if r.errors or r.warnings:
        st.markdown("".join(finding_html(f) for f in r.errors + r.warnings), unsafe_allow_html=True)
    else:
        st.markdown('<div class="finding" style="border-left-color:#16a34a"><span class="pill green">PASS</span>'
                    '<span class="t">No issues found</span><div class="d">Every rule R-01 to R-10 passed.</div></div>',
                    unsafe_allow_html=True)
    if r.recommendation:
        if heading:
            st.markdown("##### Recommended carrier")
        st.markdown(carrier_html(r, s.priority), unsafe_allow_html=True)
        if r.alternatives:
            with st.expander(f"Other options ({len(r.alternatives)})"):
                st.dataframe([{"Carrier": o.lane.name, "Service": o.lane.service, "Cost £": float(o.cost_gbp),
                               "Transit days": o.transit_days, "On-time %": float(o.lane.on_time_pct),
                               "Max kg/pallet": float(o.lane.max_pallet_kg)} for o in r.alternatives],
                             width="stretch", hide_index=True)
    else:
        st.markdown(f'<div class="note">{esc(r.justification)}</div>', unsafe_allow_html=True)
    with st.expander("Confirmation summary (plain language)", expanded=r.status != "BLOCKED"):
        st.text(r.summary)
    a, b, _ = st.columns([1, 1, 3])
    stem = (s.booking_id or "booking").replace("/", "-")
    _ = a.download_button("Download summary", r.summary, file_name=f"{stem}_confirmation.txt", key=f"{key}-txt")
    _ = b.download_button("Download JSON", json.dumps(r.to_dict(), indent=2), file_name=f"{stem}_preflight.json",
                      mime="application/json", key=f"{key}-json")


# ------------------------------------------------------------------------------------------ CLI
def run_cli(offline: bool, today: date) -> None:
    try:
        extractor, label = make_extractor("offline" if offline else "auto")
    except ExtractorError as e:
        print(f"{e}; using offline parser."); extractor, label = make_extractor("offline")
    conv = Conversation(extractor, today=today)
    print(f"[{label}]  (Ctrl-D or 'quit' to exit)\n{WELCOME}\n")
    while True:
        try:
            line = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            print(); return
        if line.lower() in ("quit", "exit"):
            return
        if line:
            print("\n" + conv.turn(line) + "\n")


def run_check(paths: list[str], as_json: bool, today: date) -> int:
    try:
        results, file_notes = run_batch([(Path(p).name, Path(p).read_bytes()) for p in paths], today)
    except (OSError, SheetError) as e:
        print(f"Error: {e}", file=sys.stderr); return 2
    if as_json:
        print(json.dumps({"notes": file_notes, "bookings": [{**r.report.to_dict(), "notes": r.notes} for r in results]}, indent=2))
    else:
        for n in file_notes: print("NOTE:", n)
        for r in results:
            print(f"\n=== {r.booking_id}: {r.report.status} ===")
            for n in r.notes: print("NOTE:", n)
            print(r.report.summary)
    statuses = {r.report.status for r in results}
    return 3 if "BLOCKED" in statuses else 1 if "REVIEW" in statuses else 0


# ------------------------------------------------------------------------------------------ Streamlit
def _load_secrets_into_env(st) -> None:
    """Streamlit Cloud keeps keys in st.secrets; the backend reads environment variables."""
    for k in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY", "PREFLIGHT_MODEL", "GEMINI_MODEL"):
        if k not in os.environ:
            try:
                if k in st.secrets:
                    os.environ[k] = str(st.secrets[k])
            except Exception:                                   # noqa: BLE001 - no secrets file is normal
                pass


def _booking_panel(st, conv: Conversation) -> None:
    s = conv.shipment
    fmt = {"ready_date": lambda v: v.strftime("%d-%m-%Y"), "total_declared_value_gbp": lambda v: f"£{v:,.2f}",
           "total_gross_weight_kg": lambda v: f"{v:g} kg"}
    labels = {"destination_country": "Destination country", "destination_type": "Destination type",
              "ready_date": "Ready to ship", "pallets": "Pallets", "total_gross_weight_kg": "Gross weight",
              "total_cartons": "Total cartons", "total_declared_value_gbp": "Declared value", "priority": "Priority"}
    rows, done = "", 0
    for f, _ in SHIPMENT_SLOTS:
        v = getattr(s, f)
        done += v is not None
        shown = esc(fmt[f](v)) if v is not None and f in fmt else esc(v)
        rows += f'<div class="row"><span class="k">{labels[f]}</span><span class="v{"" if v is not None else " miss"}">{shown if v is not None else "not yet given"}</span></div>'
    if s.destination_city or s.origin_city:
        rows += f'<div class="row"><span class="k">Route</span><span class="v">{esc(s.origin_city or "UK")} → {esc(s.destination_city or s.destination_country)}</span></div>'
    st.markdown(f'<div class="card"><h4>Booking so far</h4>{rows}</div>', unsafe_allow_html=True)
    st.progress(done / len(SHIPMENT_SLOTS), text=f"{done} of {len(SHIPMENT_SLOTS)} booking details collected")
    if s.items:
        li = "".join(f'<div class="row"><span class="k">{esc(i.sku)} · {esc(i.description or "…")}</span>'
                     f'<span class="v">{esc(i.quantity or "?")} × £{esc(i.unit_price_gbp if i.unit_price_gbp is not None else "?")}'
                     f' · HS {esc(i.hs_code or "—")}</span></div>' for i in s.items)
        st.markdown(f'<div class="card"><h4>Items ({len(s.items)})</h4>{li}</div>', unsafe_allow_html=True)
    live = conv.live_findings()
    body = "".join(finding_html(f) for f in live) if live else '<div class="note">No issues spotted so far.</div>'
    st.markdown(f'<div class="card"><h4>Live checks</h4>{body}</div>', unsafe_allow_html=True)


def _chat_tab(st, conv: Conversation, label: str, llm_on: bool) -> None:
    ss = st.session_state
    if not llm_on:
        st.info("No Gemini API key found, so chat is running on the **offline parser**. It understands `field: value` "
                "lines (try the demo button). Set `GEMINI_API_KEY` for plain-English chat.", icon="ℹ️")
    c1, c2, c3 = st.columns([1.2, 1.2, 2])
    demo = c1.button("Load structured demo", help="Fills the chat with samples/demo_chat.txt (works offline)")
    nl = c2.button("Try plain English", help="A natural-language example. Needs Gemini.", disabled=not llm_on)
    left, right = st.columns([3, 2], gap="large")
    prompt = None
    with left:
        for role, text in ss.msgs:
            with st.chat_message(role):
                st.text(text)           # st.text keeps the line breaks of pasted multi-line input
        if ss.msgs[-1][0] == "assistant" and ss.msgs[-1][1].startswith("Sorry, I couldn't read"):
            st.warning("The language-model call failed. Check the API key and quota, or switch to the offline parser in the sidebar.")
        prompt = st.chat_input("Describe your shipment, or answer my question…")
    with right:
        _booking_panel(st, conv)
    if demo:
        prompt = (SAMPLES / "demo_chat.txt").read_text()
    elif nl:
        prompt = NL_EXAMPLE
    if prompt:
        ss.msgs.append(("user", prompt))
        reply = conv.turn(prompt)
        r = conv.last_report
        if r and r.summary in reply:        # the full report is rendered below the chat; keep the bubble short
            nxt = ("Reply 'confirm' to book, or send corrections." if r.status != "BLOCKED"
                   else "Send the corrections and I'll re-check straight away.")
            reply = reply.replace(r.summary, f"Pre-flight done: {STATUS_TEXT[r.status].lower()}. "
                                  f"The full result is below the chat. {nxt}")
        ss.msgs.append(("assistant", reply))
        st.rerun()
    if conv.last_report and conv.phase.value in ("confirming", "booked"):
        st.divider()
        if conv.phase.value == "booked":
            st.success("Booking confirmed. The confirmation below can be downloaded.", icon="✅")
        else:
            st.caption("Pre-flight result. Reply **confirm** in the chat to book, or send corrections.")
        render_report(st, conv.last_report, conv.shipment, key="chat")


@functools.lru_cache(maxsize=8)
def _cached_batch(files: tuple, today: date):
    return run_batch(list(files), today)


def _batch_tab(st, today: date) -> None:
    st.markdown("Upload the **Bookings + Items** workbook (the Case 2 template: `.xlsx`, `.ods`) or a Bookings CSV and an "
                "Items CSV. Every booking is checked against the rate card and rulebook below.")
    up = st.file_uploader("Test data", type=["xlsx", "xlsm", "ods", "csv"], accept_multiple_files=True,
                          label_visibility="collapsed")
    c1, c2, _ = st.columns([1.3, 1.3, 3])
    use_sample = c1.button("Run sample workbook", help="10 bookings; BK-003 to BK-010 each plant mistakes")
    _ = c2.download_button("Download sample", SAMPLE_WORKBOOK.read_bytes(), file_name=SAMPLE_WORKBOOK.name)
    files = [(f.name, f.getvalue()) for f in up] if up else ([(SAMPLE_WORKBOOK.name, SAMPLE_WORKBOOK.read_bytes())] if use_sample else None)
    with st.expander("Rate card (Sheet 3) and rulebook (Sheet 4) in use"):
        a, b = st.columns(2)
        _ = a.dataframe([{"Carrier": l.name, "Service": l.service, "To": l.destination, "£/pallet": float(l.price_per_pallet),
                      "Days": l.transit_days, "On-time %": float(l.on_time_pct), "Max kg/pallet": float(l.max_pallet_kg)}
                     for l in DEFAULT_RATE_CARD], width="stretch", hide_index=True)
        _ = b.dataframe([{"Rule": i, "Check": t, "If broken": s} for i, t, s in RULEBOOK], width="stretch", hide_index=True)
    if not files:
        st.caption("Nothing uploaded yet. Click **Run sample workbook** to see it work.")
        return
    try:
        results, file_notes = _cached_batch(tuple(files), today)
    except SheetError as e:
        st.error(str(e), icon="🚫")
        return
    except Exception as e:                                          # noqa: BLE001 - never show a stack trace to a judge
        st.error(f"Couldn't process that file ({type(e).__name__}). Check it matches the template.", icon="🚫")
        return
    for n in file_notes:
        st.warning(n)
    counts = {k: sum(r.report.status == k for r in results) for k in ("READY", "REVIEW", "BLOCKED")}
    tiles = f'<div class="tile"><div class="v">{len(results)}</div><div class="l">Bookings checked</div></div>' + "".join(
        f'<div class="tile {k}"><div class="v">{counts[k]}</div><div class="l">{STATUS_TEXT[k]}</div></div>' for k in counts)
    st.markdown(f'<div class="tiles">{tiles}</div>', unsafe_allow_html=True)
    st.dataframe([{"Booking": r.booking_id, "Status": f"{EMOJI[r.report.status]} {STATUS_TEXT[r.report.status]}",
                   "Seller": r.shipment.seller_name,
                   "Route": f"{r.shipment.origin_city or 'UK'} → {r.shipment.destination_city or r.shipment.destination_country}",
                   "Priority": r.shipment.priority, "Red": len(r.report.errors), "Amber": len(r.report.warnings),
                   "Rules hit": ", ".join(sorted({f.rule_id for f in r.report.errors + r.report.warnings})) or "none",
                   "Recommended": r.report.recommendation.lane.label if r.report.recommendation else "none possible",
                   "Cost £": float(r.report.recommendation.cost_gbp) if r.report.recommendation else None}
                  for r in results], width="stretch", hide_index=True)
    d1, d2, d3, _ = st.columns([1, 1, 1, 2])
    _ = d1.download_button("Findings (CSV)", findings_csv(results), file_name="preflight_findings.csv", mime="text/csv")
    _ = d2.download_button("Confirmations (TXT)", confirmations_text(results), file_name="preflight_confirmations.txt")
    _ = d3.download_button("Full results (JSON)", json.dumps([{**r.report.to_dict(), "notes": r.notes} for r in results], indent=2),
                       file_name="preflight_results.json", mime="application/json")
    show = st.radio("Show", ["All", "Blocked", "Review", "Ready"], horizontal=True)
    keep = [r for r in results if show == "All" or r.report.status == show.upper()]
    for n, r in enumerate(keep[:60]):
        s = r.shipment
        title = f"{EMOJI[r.report.status]} {r.booking_id} · {s.seller_name or ''} · {s.destination_city or s.destination_country or ''}"
        with st.expander(title, expanded=(show != "All" and n == 0) or (len(keep) == 1)):
            for note in r.notes:
                st.markdown(f'<div class="note">⚠ {esc(note)}</div>', unsafe_allow_html=True)
            render_report(st, r.report, s, key=f"b{n}-{r.booking_id}", heading=False)
    if len(keep) > 60:
        st.caption(f"Showing the first 60 of {len(keep)}; use the downloads for everything.")


def run_streamlit() -> None:
    import streamlit as st

    st.set_page_config(page_title="Shipment Pre-Flight", page_icon="📦", layout="wide")
    _load_secrets_into_env(st)
    st.markdown(CSS, unsafe_allow_html=True)
    ss = st.session_state

    @st.cache_resource(show_spinner=False)
    def get_extractor(mode: str, key: str):
        return make_extractor(mode, api_key=key or None)

    with st.sidebar:
        st.markdown("### 📦 Pre-Flight")
        mode = st.radio("Understand messages with", ["Auto", "Gemini", "Offline parser"],
                        help="Auto uses Gemini when an API key is configured, otherwise the offline parser.")
        key = st.text_input("API key (optional, this session only)", type="password",
                            help="Leave blank if GEMINI_API_KEY is configured on the server.")
        today = st.date_input("Today's date (used by rule R-10)", value=date.today(), format="DD/MM/YYYY")
        if st.button("Start a new booking", width="stretch"):
            for k in ("conv", "msgs"):
                ss.pop(k, None)
            st.rerun()

    try:
        extractor, label = get_extractor({"Auto": "auto", "Gemini": "gemini", "Offline parser": "offline"}[mode], key)
    except ExtractorError as e:
        st.sidebar.warning(f"{e}. Using the offline parser instead.")
        extractor, label = make_extractor("offline")
    llm_on = not label.startswith("Offline")
    st.sidebar.caption(f"Mode: **{label}**" if llm_on else "Mode: **offline parser** (no LLM)")
    st.sidebar.caption("No login. Nothing you enter is stored.")

    if "conv" not in ss:
        ss.conv, ss.msgs = Conversation(extractor, today=today), [("assistant", WELCOME)]
    conv: Conversation = ss.conv
    conv.extractor, conv.today = extractor, today              # settings apply from the next message

    st.markdown('<div class="hero"><h1>Shipment Pre-Flight</h1>'
                '<p>Book UK → Europe freight in plain English. Every booking is checked against the rulebook before it '
                'leaves, with fixes and a carrier recommendation.</p>'
                '<div class="chips"><span class="chip">UK → Germany · France · Netherlands</span>'
                '<span class="chip">GBP</span><span class="chip">10 automated checks</span>'
                '<span class="chip">Explainable carrier choice</span></div></div>', unsafe_allow_html=True)
    chat_tab, batch_tab = st.tabs(["💬  Chat booking", "📄  Batch upload (Excel / CSV)"])
    with chat_tab:
        _chat_tab(st, conv, label, llm_on)
    with batch_tab:
        _batch_tab(st, today)


def _in_streamlit() -> bool:
    try:
        from streamlit.runtime.scriptrunner import get_script_run_ctx
        return get_script_run_ctx(suppress_warning=True) is not None
    except Exception:                                   # noqa: BLE001 - streamlit absent or API moved
        return False


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cli", action="store_true", help="terminal chat")
    ap.add_argument("--check", nargs="+", metavar="FILE", help="batch-check a workbook or a bookings+items CSV pair")
    ap.add_argument("--json", action="store_true", help="with --check: print JSON")
    ap.add_argument("--offline", action="store_true", help="never call an LLM API")
    ap.add_argument("--today", type=date.fromisoformat, default=date.today(), help="override today (YYYY-MM-DD)")
    args = ap.parse_args(argv)
    if args.check:
        return run_check(args.check, args.json, args.today)
    if args.cli:
        run_cli(args.offline, args.today); return 0
    ap.print_help(); print("\nFor the web UI run:  streamlit run app.py"); return 0


if _in_streamlit():
    run_streamlit()
elif __name__ == "__main__":
    sys.exit(main())
