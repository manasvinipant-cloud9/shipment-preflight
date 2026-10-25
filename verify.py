"""Final verification. Run:  python verify.py     (exit code 0 only if nothing FAILED)

Reports PASS / FAIL / SKIP per check. SKIP is not a pass: it means the check could not run here
(e.g. no API key for the live-model smoke test) and is listed in the final summary.
    python verify.py --live      also calls the real Gemini API (needs GEMINI_API_KEY)
"""
from __future__ import annotations

import importlib
import os
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
KEYS = ("ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY")
if "--live" not in sys.argv:
    for k in KEYS:
        os.environ.pop(k, None)             # UI / CLI checks must run offline and deterministically

results: list[tuple[str, str, str]] = []   # (status, name, detail)


def record(status, name, detail=""):
    results.append((status, name, detail))
    print(f"{status:<5} {name}" + (f"  - {detail}" if detail else ""))


def check(name):
    def deco(fn):
        try:
            out = fn()
            record("SKIP" if out and str(out).startswith("skip:") else "PASS", name, (out or "").replace("skip: ", ""))
        except Exception as e:                                   # noqa: BLE001
            traceback.print_exc()
            record("FAIL", name, f"{type(e).__name__}: {e}")
        return fn
    return deco


@check("project structure")
def _():
    required = ["app.py", "verify.py", "README.md", "requirements.txt", ".streamlit/config.toml",
                "test_preflight.py", "test_extractor.py", "test_batch.py",
                *(f"preflight/{m}.py" for m in ("__init__", "models", "rules", "carriers", "report", "conversation",
                                                "extractor", "sheets")),
                "samples/demo_chat.txt", "samples/test_bookings_items.xlsx", "samples/bookings.csv",
                "samples/items.csv", "samples/build_samples.py"]
    missing = [f for f in required if not (HERE / f).exists()]
    assert not missing, f"missing {missing}"


@check("all modules compile")
def _():
    for f in list(HERE.glob("*.py")) + list((HERE / "preflight").glob("*.py")):
        compile(f.read_text(), str(f), "exec")      # syntax check in memory; writes nothing


for modname in ("test_preflight", "test_extractor", "test_batch"):
    try:
        mod = importlib.import_module(modname)
    except ImportError as e:
        record("SKIP", modname, f"cannot import ({e})")
        continue
    tests = [(n, f) for n, f in vars(mod).items() if n.startswith("test_") and callable(f)]
    failed = []
    for n, f in tests:
        try:
            f()
        except Exception:                                        # noqa: BLE001
            traceback.print_exc(); failed.append(n)
    record("FAIL" if failed else "PASS", f"{modname} ({len(tests)} tests)", ", ".join(failed))


def _md(at) -> str:
    return " ".join(m.value for m in at.markdown)


@check("Streamlit UI (headless AppTest, no API key)")
def _():
    try:
        from streamlit.testing.v1 import AppTest
    except ImportError:
        return "skip: streamlit not installed"
    at = AppTest.from_file(str(HERE / "app.py"), default_timeout=60).run()
    assert not at.exception, at.exception
    assert any("offline parser" in i.value for i in at.info), "missing-API-key banner not shown"
    assert [t.label for t in at.tabs][0].strip().endswith("Chat booking")

    # Chat: structured demo end to end, then a mid-conversation edit
    next(b for b in at.button if b.label == "Load structured demo").click().run()
    assert not at.exception, at.exception
    conv = at.session_state["conv"]
    assert conv.phase.value == "confirming" and conv.last_report.status == "REVIEW"
    md = _md(at)
    assert "Booking so far" in md and "Live checks" in md and "Recommended carrier" in md and "R-08" in md
    at.chat_input[0].set_value("add a pallet").run()
    assert not at.exception and at.session_state["conv"].shipment.pallets == 3
    assert any("still right" in t.value for t in at.text), "no re-confirmation of the stale total weight"

    # Batch: sample workbook -> tiles, table, findings with fixes
    next(b for b in at.button if b.label == "Run sample workbook").click().run()
    assert not at.exception, at.exception
    md = _md(at)
    for needle in ("Bookings checked", "Blocked: fix required", "Pallet too heavy", "How to fix", "Carrier B"):
        assert needle in md, needle
    assert any(len(df.value) == 10 for df in at.dataframe), "results table missing"


@check("live Gemini extraction (needs GEMINI_API_KEY and --live)")
def _():
    if "--live" not in sys.argv or not any(os.environ.get(k) for k in KEYS):
        return "skip: run `GEMINI_API_KEY=... python verify.py --live` to exercise the real model"
    from datetime import date
    from preflight import Conversation
    from preflight.extractor import make_extractor
    extractor, label = make_extractor("auto")
    print("live backend:", label)
    conv = Conversation(extractor, today=date.today())
    conv.turn("Sending 2 pallets of cotton t-shirts to a warehouse in Hamburg, ready next Friday, cheapest please")
    s = conv.shipment
    assert s.destination_country == "Germany" and s.pallets == 2 and s.priority == "Cheapest", conv.snapshot()
    conv.turn("actually make that 3 pallets")
    assert conv.shipment.pallets == 3, conv.snapshot()


fails = [r for r in results if r[0] == "FAIL"]
skips = [r for r in results if r[0] == "SKIP"]
print(f"\n{len(results) - len(fails) - len(skips)} passed, {len(fails)} failed, {len(skips)} skipped")
for _, n, d in skips:
    print(f"  skipped: {n} - {d}")
sys.exit(1 if fails else 0)
