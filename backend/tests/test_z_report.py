"""The till's daily report from a photo (Н3): the Z report read - the day's
turnover by VAT group, cash and card - and handed to the revenue form; what
does not add up is said, nothing is saved until the person confirms, and
the scan counts as one."""
from types import SimpleNamespace

import server
from routers import z_report
from routers.z_report import ClaudeZReportExtraction, ZReportGroup, read_z_report
from tests.test_whole_program_fixes import _company, _user


def test_n3_a_report_read_into_the_day():
    report = read_z_report(ClaudeZReportExtraction(
        report_date="2026-11-14", report_number="0000412", total=1300,
        groups=[ZReportGroup(group="Б", rate_percent=20, amount=1000), ZReportGroup(group="Г", rate_percent=9, amount=300),
                ZReportGroup(group="А", rate_percent=0, amount=0)],
        cash=850, card=450,
    ))
    assert (report.date, report.report_number, report.fiscal_revenue, report.card_revenue) == ("2026-11-14", "0000412", 1300, 450)
    assert [(g.rate_percent, g.amount) for g in report.vat_groups] == [(20, 1000), (9, 300)]
    assert report.warnings == []

    # What does not add up is said; card left out is what cash is not.
    odd = read_z_report(ClaudeZReportExtraction(total=1000, groups=[ZReportGroup(rate_percent=20, amount=900)], cash=700))
    assert odd.card_revenue == 300 and any("не е равен" in w for w in odd.warnings)
    future = read_z_report(ClaudeZReportExtraction(report_date="2099-01-01", total=10))
    assert future.date is None and any("бъдещето" in w for w in future.warnings)
    # No groups read: no rate is guessed - the form keeps the day's, and says so.
    assert future.vat_groups == [] and any("ДДС групите не се четат" in w for w in future.warnings)
    # One rate on the whole report: that rate, no split to fill in.
    single = read_z_report(ClaudeZReportExtraction(total=240, groups=[ZReportGroup(group="Г", rate_percent=9, amount=240)]))
    assert [(g.rate_percent, g.amount) for g in single.vat_groups] == [(9, 240)] and single.warnings == []


def test_n3_through_the_api(client, monkeypatch):
    company_id, _, owner = _company()
    _, analyst = _user(company_id, "staff", ["view_statistics"], "Анализатор")
    extraction = ClaudeZReportExtraction(report_date="2026-11-14", total=500, groups=[ZReportGroup(rate_percent=20, amount=500)], cash=500, card=0)

    class FakeMessages:
        async def parse(self, **kwargs):
            assert kwargs["system"] == z_report.Z_REPORT_SYSTEM_PROMPT and kwargs["messages"][0]["content"][0]["type"] == "image"
            return SimpleNamespace(parsed_output=extraction, usage=SimpleNamespace(input_tokens=1, output_tokens=1))

    monkeypatch.setattr(server, "AI_FEATURES_ENABLED", False)
    assert client.post("/api/daily-revenue/scan", headers=owner, json={"image_base64": "abc"}).status_code == 503
    monkeypatch.setattr(server, "AI_FEATURES_ENABLED", True)
    monkeypatch.setattr(server, "anthropic_client", SimpleNamespace(messages=FakeMessages()))
    monkeypatch.setattr(z_report, "log_ai_usage", lambda *a, **k: _none())
    assert client.post("/api/daily-revenue/scan", headers=analyst, json={"image_base64": "abc"}).status_code == 403
    assert client.post("/api/daily-revenue/scan", headers=owner, json={}).status_code == 400

    result = client.post("/api/daily-revenue/scan", headers=owner, json={"image_base64s": ["data:image/jpeg;base64,abc"]})
    assert result.status_code == 200, result.text
    assert result.json()["fiscal_revenue"] == 500 and result.json()["date"] == "2026-11-14"
    # Nothing saved: the person confirms the day in the form.
    assert client.get("/api/daily-revenue/by-date/2026-11-14", headers=owner).json().get("fiscal_revenue", 0) == 0


async def _none():
    return None
