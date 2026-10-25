"""Extractor, sheet and CLI tests. The LLM is replaced by a fake client: these prove our request shape,
parsing, fallback and error handling, NOT the model's extraction quality (that needs a live key)."""
import json
import subprocess
import sys
from datetime import date
from pathlib import Path
from types import SimpleNamespace

from preflight import Conversation
from preflight.conversation import ExtractorError
from preflight.extractor import (GeminiExtractor, LLMExtractor, OPS_SCHEMA, RuleBasedExtractor, make_extractor, sanitize_ops)

TODAY = date(2026, 10, 25)
HERE = Path(__file__).parent
SAMPLES = HERE / "samples"


class FakeClient:
    """Mimics anthropic.Anthropic().messages.create; records calls; replays scripted responses/exceptions."""
    def __init__(self, *script):
        self.script, self.calls = list(script), []
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kw):
        self.calls.append(kw)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def reply(text, stop="end_turn"):
    return SimpleNamespace(content=[SimpleNamespace(type="thinking", thinking=""),
                                    SimpleNamespace(type="text", text=text)], stop_reason=stop, usage=None)


class HTTPErr(Exception):
    def __init__(self, code): super().__init__(code); self.status_code = code


# ----------------------------------------------------------------------------- LLM extractor
def test_llm_happy_path_and_request_shape():
    ops = {"ops": [{"op": "set", "field": "pallets", "value": "3"}]}
    c = FakeClient(reply(json.dumps(ops)))
    out = LLMExtractor(client=c, model="m")("3 pallets", {"phase": "collecting"}, TODAY)
    assert out == [{"op": "set", "field": "pallets", "value": "3"}]
    kw = c.calls[0]
    assert kw["model"] == "m" and "temperature" not in kw and "prefill" not in str(kw["messages"])
    assert kw["extra_body"]["output_config"]["format"]["schema"] == OPS_SCHEMA
    body = json.loads(kw["messages"][0]["content"])
    assert body["today"] == "2026-10-25" and body["seller_message"] == "3 pallets"


def test_llm_tolerates_fences_prose_and_bare_list():
    for raw in ('```json\n{"ops":[{"op":"confirm"}]}\n```', 'Sure! {"ops":[{"op":"confirm"}]} done', '[{"op":"confirm"}]'):
        assert LLMExtractor(client=FakeClient(reply(raw)))("x", {}, TODAY) == [{"op": "confirm"}], raw


def test_llm_schema_rejected_retries_unconstrained():
    c = FakeClient(HTTPErr(400), reply('{"ops":[]}'))
    assert LLMExtractor(client=c)("x", {}, TODAY) == []
    assert "format" not in c.calls[1]["extra_body"]["output_config"]


def test_llm_failures_become_extractor_error():
    for script in ([HTTPErr(500)], [HTTPErr(400), HTTPErr(500)], [reply("no json here")], [reply("{}", stop="refusal")]):
        try:
            LLMExtractor(client=FakeClient(*script))("x", {}, TODAY)
        except ExtractorError:
            continue
        raise AssertionError(f"no ExtractorError for {script}")


def test_conversation_survives_extractor_failure():
    conv = Conversation(LLMExtractor(client=FakeClient(HTTPErr(500))), today=TODAY)
    assert "Nothing was changed" in conv.turn("hello") and conv.shipment.pallets is None


def test_sanitize_drops_garbage_and_injection():
    raw = {"ops": [
        {"op": "set", "field": "pallets", "value": "2"},
        {"op": "drop_database"}, {"op": "set"}, {"op": "set", "field": "pallets", "value": None},
        "string", {"op": "upsert_item", "fields": {}},
        {"op": "upsert_item", "sku": "A", "fields": {"hs_code": "610910", "evil": "x", "cartons": None}},
    ]}
    assert sanitize_ops(raw) == [{"op": "set", "field": "pallets", "value": "2"},
                                 {"op": "upsert_item", "sku": "A", "fields": {"hs_code": "610910"}}]
    assert sanitize_ops("nope") == [] and sanitize_ops(None) == []


def test_llm_ops_still_validated_by_state_machine():
    bad = {"ops": [{"op": "set", "field": "destination_country", "value": "Spain"},
                   {"op": "set", "field": "pallets", "value": "-2"}]}
    conv = Conversation(LLMExtractor(client=FakeClient(reply(json.dumps(bad)))), today=TODAY)
    r = conv.turn("ship to Spain")
    assert conv.shipment.destination_country is None and conv.shipment.pallets is None and "Couldn't use" in r


def test_make_extractor_modes(monkeypatch=None):
    import os
    keys = ("ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY")
    saved = {k: os.environ.pop(k) for k in keys if k in os.environ}
    try:
        ex, label = make_extractor("auto")
        assert isinstance(ex, RuleBasedExtractor) and "Offline" in label
        assert isinstance(make_extractor("claude", api_key="sk-test")[0], LLMExtractor)
        assert isinstance(make_extractor("auto", api_key="sk-ant-xyz")[0], LLMExtractor)
        os.environ["GEMINI_API_KEY"] = "g-test"
        assert isinstance(make_extractor("auto")[0], GeminiExtractor)      # Gemini wins when its key is set
        os.environ["ANTHROPIC_API_KEY"] = "sk-ant-test"
        assert isinstance(make_extractor("auto")[0], GeminiExtractor)
        assert isinstance(make_extractor("offline")[0], RuleBasedExtractor)
    finally:
        for k in keys: os.environ.pop(k, None)
        os.environ.update(saved)


# ----------------------------------------------------------------------------- Gemini extractor
class FakeGemini:
    def __init__(self, *script):
        self.script, self.calls = list(script), []
        self.models = SimpleNamespace(generate_content=self._gen)

    def _gen(self, **kw):
        self.calls.append(kw)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def gem(text, feedback=None):
    return SimpleNamespace(text=text, prompt_feedback=feedback)


def test_gemini_happy_path_and_request_shape():
    c = FakeGemini(gem('{"ops":[{"op":"set","field":"pallets","value":"3"}]}'))
    out = GeminiExtractor(client=c, model="g")("3 pallets", {"phase": "collecting"}, TODAY)
    assert out == [{"op": "set", "field": "pallets", "value": "3"}]
    kw = c.calls[0]
    assert kw["model"] == "g" and kw["config"]["response_mime_type"] == "application/json"
    assert "JSON patch ops" in kw["config"]["system_instruction"] and kw["config"]["response_json_schema"] == OPS_SCHEMA
    assert json.loads(kw["contents"])["today"] == "2026-10-25"


def test_gemini_model_env_precedence():
    import os
    saved = {k: os.environ.pop(k, None) for k in ("GEMINI_MODEL", "PREFLIGHT_MODEL")}
    try:
        c = FakeGemini()
        assert GeminiExtractor(client=c).model == "gemini-2.5-flash"
        os.environ["PREFLIGHT_MODEL"] = "claude-opus-5-5"          # a Claude id must not leak into Gemini calls
        assert GeminiExtractor(client=c).model == "gemini-2.5-flash"
        os.environ["PREFLIGHT_MODEL"] = "gemini-2.5-pro"
        assert GeminiExtractor(client=c).model == "gemini-2.5-pro"
        os.environ["GEMINI_MODEL"] = "gemini-x"
        assert GeminiExtractor(client=c).model == "gemini-x"
    finally:
        for k in ("GEMINI_MODEL", "PREFLIGHT_MODEL"): os.environ.pop(k, None)
        os.environ.update({k: v for k, v in saved.items() if v})


def test_gemini_fences_and_schema_fallback():
    assert GeminiExtractor(client=FakeGemini(gem('```json\n{"ops":[{"op":"confirm"}]}\n```')))("x", {}, TODAY) == [{"op": "confirm"}]
    c = FakeGemini(RuntimeError("schema not supported"), gem('{"ops":[]}'))
    assert GeminiExtractor(client=c)("x", {}, TODAY) == []
    assert "response_json_schema" not in c.calls[1]["config"]


def test_gemini_failures_become_extractor_error():
    for script in ([RuntimeError("a"), RuntimeError("b")], [gem(None, feedback="blocked")], [gem("not json")]):
        try:
            GeminiExtractor(client=FakeGemini(*script))("x", {}, TODAY)
        except ExtractorError:
            continue
        raise AssertionError(script)
    conv = Conversation(GeminiExtractor(client=FakeGemini(RuntimeError("a"), RuntimeError("b"))), today=TODAY)
    assert "Nothing was changed" in conv.turn("hi")


# ----------------------------------------------------------------------------- offline extractor
def test_offline_full_flow_with_edits():
    conv = Conversation(RuleBasedExtractor(), today=TODAY)
    conv.turn((SAMPLES / "demo_chat.txt").read_text())
    assert conv.phase.value == "confirming" and conv.last_report.status == "REVIEW"
    r = conv.turn("add a pallet")
    assert conv.shipment.pallets == 3 and "still right" in r
    conv.turn("unchanged")
    assert conv.phase.value == "confirming"
    conv.turn("appointment: yes")
    assert conv.last_report.status == "READY"
    conv.turn("confirm")
    assert conv.phase.value == "booked"


def test_offline_bare_answers_follow_the_question():
    conv = Conversation(RuleBasedExtractor(), today=TODAY)
    conv.turn("country: France")
    conv.turn("Business")
    conv.turn("2026-11-02")
    assert (conv.shipment.destination_country, conv.shipment.destination_type) == ("France", "Business address")
    assert conv.shipment.ready_date == date(2026, 11, 2)
    conv.turn("4")                       # answers "How many pallets?"
    assert conv.shipment.pallets == 4


def test_offline_json_paste_and_description_with_commas():
    ex = RuleBasedExtractor()
    ops = ex("item X: desc=Mugs, ceramic, large, hs=691200, qty=10", {}, TODAY)
    assert ops[0]["fields"]["description"] == "Mugs, ceramic, large" and ops[0]["fields"]["hs_code"] == "691200"
    paste = json.dumps({"destination_country": "Germany", "destination_type": "Warehouse", "delivery_appointment_booked": "Yes",
                        "ready_date": "01-12-2026", "pallets": 2, "total_cartons": 30, "total_gross_weight_kg": 520,
                        "total_declared_value_gbp": 6000, "priority": "Balanced",
                        "items": [{"sku": "A", "description": "Cotton t-shirts", "hs_code": "610910", "quantity": 1000,
                                   "unit_price_gbp": 3, "units_per_carton": 50, "cartons": 20, "unit_weight_kg": 0.2,
                                   "country_of_origin": "India"},
                                  {"sku": "B", "description": "Mugs", "hs_code": "691200", "quantity": 500,
                                   "unit_price_gbp": 6, "units_per_carton": 50, "cartons": 10, "unit_weight_kg": 0.4,
                                   "country_of_origin": "China"}]})
    conv = Conversation(ex, today=TODAY)
    conv.turn(paste)
    assert conv.last_report.status == "READY"


def test_offline_unknown_declines_only_what_was_asked():
    ex = RuleBasedExtractor()
    ops = ex("unknown", {"asking": ["What's the HS (customs) code for 'mugs'?"]}, TODAY)
    assert ops == [{"op": "decline", "field": "hs_code"}]
    ops = ex("skip", {"asking": ["What's the country of origin for 'mugs'?"]}, TODAY)
    assert ops == [{"op": "decline", "field": "country_of_origin"}]


def test_gemini_missing_key_is_a_clear_error():
    import os
    saved = {k: os.environ.pop(k, None) for k in ("GEMINI_API_KEY", "GOOGLE_API_KEY")}
    try:
        try:
            GeminiExtractor()
        except ExtractorError as e:
            assert "GEMINI_API_KEY" in str(e) or "google-genai" in str(e)
        else:
            raise AssertionError("expected ExtractorError")
    finally:
        os.environ.update({k: v for k, v in saved.items() if v})


# ----------------------------------------------------------------------------- CLI
def run_cli(*args, stdin=None):
    import os
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}   # CLI tests must stay offline
    return subprocess.run([sys.executable, str(HERE / "app.py"), *args], input=stdin, capture_output=True,
                          text=True, cwd=HERE, env=env)


def test_cli_check_workbook_and_csv_pair():
    p = run_cli("--check", str(SAMPLES / "test_bookings_items.xlsx"), "--today", "2026-10-25", "--json")
    assert p.returncode == 3, p.stderr
    out = json.loads(p.stdout)
    assert len(out["bookings"]) == 10 and out["bookings"][0]["status"] == "READY"
    assert any(f["rule_id"] == "R-06" for b in out["bookings"] for f in b["red"])
    q = run_cli("--check", str(SAMPLES / "bookings.csv"), str(SAMPLES / "items.csv"), "--today", "2026-10-25", "--json")
    assert [b["status"] for b in json.loads(q.stdout)["bookings"]] == [b["status"] for b in out["bookings"]]
    assert run_cli("--check", "nope.xlsx").returncode == 2


def test_cli_chat_offline():
    p = run_cli("--cli", "--offline", "--today", "2026-10-25", stdin="country: Germany\npallets: 2\nquit\n")
    assert p.returncode == 0 and "Offline parser" in p.stdout and "ready for collection" in p.stdout, p.stdout + p.stderr
