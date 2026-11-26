"""The server's refusals in the app's language (English everywhere): every
message the code can send has its English, and the app in English gets it.

The coverage check walks the code itself: a new refusal written without its
English fails here, not in front of someone using the app in English."""
import ast
import os
import re

import pytest

import server
from services import error_text
from tests.test_whole_program_fixes import _company

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CYRILLIC = re.compile(r"[Ѐ-ӿ]")


def _sources():
    for base in ("", "routers", "services"):
        folder = os.path.join(ROOT, base)
        for name in sorted(os.listdir(folder)):
            if name.endswith(".py"):
                yield os.path.join(base, name), ast.parse(open(os.path.join(folder, name), encoding="utf-8").read())


def _refusals():
    """Every Bulgarian refusal the code can send: as it is written, or the
    fixed parts of one with a number or a name in it."""
    fixed, templates = set(), []
    for path, tree in _sources():
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "id", getattr(node.func, "attr", ""))
            values = []
            if name == "HTTPException":
                for keyword in node.keywords:
                    if keyword.arg != "detail":
                        continue
                    values.append(keyword.value)
                    if isinstance(keyword.value, ast.Dict):
                        values += [v for k, v in zip(keyword.value.keys, keyword.value.values)
                                   if isinstance(k, ast.Constant) and k.value == "message"]
            elif name.endswith("Error"):
                values = list(node.args)
            for value in values:
                if isinstance(value, ast.Constant) and isinstance(value.value, str) and CYRILLIC.search(value.value):
                    fixed.add(value.value)
                elif isinstance(value, ast.JoinedStr):
                    parts = [v.value for v in value.values if isinstance(v, ast.Constant) and CYRILLIC.search(v.value)]
                    if parts:
                        templates.append((f"{path}:{node.lineno}", parts))
    return fixed, templates


def test_every_refusal_has_its_english():
    fixed, templates = _refusals()
    missing = sorted(text for text in fixed if error_text.to_english(text) == text)
    assert missing == [], "No English for: " + " | ".join(missing)

    pattern_text = re.sub(r"\\(.)", r"\1", " ".join(p for p, _ in error_text.PATTERNS))
    uncovered = []
    for where, parts in templates:
        for part in parts:
            words = part.strip(" .-!:„“()")
            if words and words not in pattern_text:
                uncovered.append(f"{where}: {part!r}")
    assert uncovered == [], "No English pattern for: " + " | ".join(uncovered)


@pytest.mark.parametrize("bulgarian, english", [
    ("Фактурата не е намерена", "Invoice not found"),
    ("Невалидна дата на падеж", "Invalid due date"),
    ("Фактура с номер 12 от Доставчик Проба вече е добавена от Мария!",
     "Invoice number 12 from Доставчик Проба has already been added by Мария!"),
    ("Попълнете ЕИК и адрес на фирмата, преди да издадете фактура",
     "Fill in the business's EIK and address before issuing an invoice"),
    ("Фактурата за ноември 2026 вече е издадена - № 0000000007",
     "The invoice for November 2026 is already issued - No. 0000000007"),
    ("Остават 12,30 € - плащането е по-голямо", "12,30 € remains - the payment is larger"),
    ("Нещо непознато", "Нещо непознато"),
])
def test_messages_in_english(bulgarian, english):
    assert error_text.to_english(bulgarian) == english


def test_the_app_in_english_gets_refusals_in_english(client):
    _, _, owner = _company()
    missing = "/api/invoices/no-such-invoice"
    assert client.get(missing, headers=owner).json()["detail"] == "Фактурата не е намерена"
    assert client.get(missing, headers={**owner, "X-App-Language": "en"}).json()["detail"] == "Invoice not found"
    # A refusal that carries a code for the app keeps it; its words change.
    signed_out = client.get("/api/invoices", headers={"X-App-Language": "en"})
    assert signed_out.status_code == 401 and signed_out.json()["detail"] == "You are not signed in"
