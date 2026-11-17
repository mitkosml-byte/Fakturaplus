"""A bank statement file (Н2): read whatever bank it comes from, its
movements matched to the supplier invoices they pay and the customer debts
they settle, the payments recorded once - never a second time when the
statement is read again, never over a payment someone entered by hand, and
never as new revenue."""
import asyncio
import io

import openpyxl
import pytest

import server
from services import bank_statement as bs
from tests.test_customers import _issue
from tests.test_whole_program_fixes import _company, _user


@pytest.fixture
def free_client(client):
    """These tests read and apply statements more often than the per-minute limit."""
    server.limiter.reset()
    server.limiter.enabled = False
    yield client
    server.limiter.enabled = True


# ===================== reading =====================

BG_CSV = (
    "Извлечение по сметка;BG11AAAA11111111111111;;;;;\r\n"
    "Период;01.11.2026 - 06.11.2026;;;;;\r\n"
    "Начално салдо;10 000,00;;;;;\r\n"
    ";;;;;;\r\n"
    "Дата;Вальор;Сума;Дт/Кт;Наредител/Получател;Основание;Референция\r\n"
    "03.11.2026;03.11.2026;1 200,00;Дт;STROY DEPO EOOD;Плащане по ф-ра 4512;FT26307001\r\n"
    "04.11.2026;04.11.2026;120,00;Кт;GAMA TREYD OOD;фактура 0000000001;FT26308002\r\n"
    "05.11.2026;05.11.2026;2,50;Дт;;Такса превод;FT26309003\r\n"
    "06.11.2026;06.11.2026;300,00;Дт;МЕБЕЛИ ЯВОР ООД;частично плащане;FT26310004\r\n"
    "Крайно салдо;8 617,50;;;;;\r\n"
)


def test_n2_a_bulgarian_csv_with_a_preamble_and_a_debit_credit_column():
    statement = bs.read_statement(BG_CSV.encode("cp1251"), "izvlechenie.csv")
    assert statement.format == "csv" and statement.skipped_rows == 0
    assert [(t.date, t.amount, t.counterparty) for t in statement.transactions] == [
        ("2026-11-03", -1200.0, "STROY DEPO EOOD"), ("2026-11-04", 120.0, "GAMA TREYD OOD"),
        ("2026-11-05", -2.5, ""), ("2026-11-06", -300.0, "МЕБЕЛИ ЯВОР ООД"),
    ]
    assert statement.transactions[0].description == "Плащане по ф-ра 4512"
    assert statement.transactions[0].reference == "FT26307001"
    assert (statement.closing_balance, statement.closing_date) == (8617.5, "2026-11-06")
    # The same file again - or the same movement in another statement - has the same ids.
    again = bs.read_statement(BG_CSV.encode("utf-8"), "drugo.csv")
    assert [t.id for t in again.transactions] == [t.id for t in statement.transactions]
    assert len({t.id for t in statement.transactions}) == 4


def test_n2_debit_and_credit_columns_newest_first_and_two_equal_movements():
    text = (
        "Date,Description,Debit,Credit,Balance,Beneficiary/Remitter name\n"
        "05/11/2026,Card payment,25.00,,\"1,950.00\",FUEL STATION 12\n"
        "05/11/2026,Card payment,25.00,,\"1,975.00\",FUEL STATION 12\n"
        "04/11/2026,Invoice 77 payment,,\"1,500.00\",\"2,000.00\",Delta Ltd\n"
        "Total,,50.00,\"1,500.00\",,\n"
    )
    statement = bs.read_statement(text.encode("utf-8"), "export.csv")
    assert [(t.date, t.amount, t.counterparty) for t in statement.transactions] == [
        ("2026-11-05", -25.0, "FUEL STATION 12"), ("2026-11-05", -25.0, "FUEL STATION 12"), ("2026-11-04", 1500.0, "Delta Ltd"),
    ]
    # Two movements alike in everything are still two; the balance is the newest one's.
    assert statement.transactions[0].id != statement.transactions[1].id
    assert statement.closing_balance == 1950.0 and statement.skipped_rows == 0


def test_n2_sums_and_days_as_banks_write_them():
    assert [bs.parse_amount(v) for v in ("1 234,56", "1,234.56", "-12.50", "12,50-", "(12.50)", "150.00 DR", "1 200,00 лв.", "1.234", "0.125")] == [
        1234.56, 1234.56, -12.5, -12.5, -12.5, -150.0, 1200.0, 1234.0, 0.125,
    ]
    assert bs.parse_amount("") is None and bs.parse_amount("няма") is None
    assert [bs.parse_date(v) for v in ("05.11.2026", "2026-11-05 10:22", "05/11/26", "20261105", "31.02.2026", "")] == [
        "2026-11-05", "2026-11-05", "2026-11-05", "2026-11-05", None, None,
    ]


MT940 = (
    ":20:STMT261106\n:25:BG11AAAA11111111111111\n:28C:00045/001\n:60F:C261101EUR10000,00\n"
    ":61:2611031103D1200,00NTRFNONREF//FT26307001\n:86:?20Plashtane po f-ra 4512?32STROY DEPO EOOD\n"
    ":61:2611041104C120,00NTRFREF123//FT26308002\n:86:?20faktura 0000000001?21ot klient?32GAMA TREYD OOD\n"
    ":62F:C261106EUR8920,00\n-\n"
)

CAMT = """<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">10000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-11-01</Dt></Dt></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">8920.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-11-06</Dt></Dt></Bal>
<Ntry><Amt Ccy="EUR">1200.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-11-03</Dt></BookgDt>
 <NtryDtls><TxDtls><Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
  <RltdPties><Cdtr><Nm>STROY DEPO EOOD</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Plashtane po f-ra 4512</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">120.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-11-04</Dt></BookgDt>
 <NtryDtls><TxDtls><Refs><EndToEndId>E2E-77</EndToEndId></Refs>
  <RltdPties><Dbtr><Nm>GAMA TREYD OOD</Nm></Dbtr></RltdPties><RmtInf><Ustrd>faktura 0000000001</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="USD">50.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-11-05</Dt></BookgDt></Ntry>
</Stmt></BkToCstmrStmt></Document>"""


def test_n2_the_two_bank_standards_mt940_and_camt():
    mt = bs.read_statement(MT940.encode("utf-8"), "statement.sta")
    assert mt.format == "mt940" and (mt.closing_balance, mt.closing_date, mt.currency) == (8920.0, "2026-11-06", "EUR")
    assert [(t.date, t.amount, t.counterparty, t.description, t.reference) for t in mt.transactions] == [
        ("2026-11-03", -1200.0, "STROY DEPO EOOD", "Plashtane po f-ra 4512", ""),
        ("2026-11-04", 120.0, "GAMA TREYD OOD", "faktura 0000000001 ot klient", "REF123"),
    ]
    camt = bs.read_statement(CAMT.encode("utf-8"), "statement.xml")
    assert camt.format == "camt" and (camt.closing_balance, camt.closing_date, camt.currency) == (8920.0, "2026-11-06", "EUR")
    assert [(t.date, t.amount, t.counterparty, t.description, t.reference) for t in camt.transactions] == [
        ("2026-11-03", -1200.0, "STROY DEPO EOOD", "Plashtane po f-ra 4512", ""),
        ("2026-11-04", 120.0, "GAMA TREYD OOD", "faktura 0000000001", "E2E-77"),
    ]
    assert camt.other_currency_rows == 1     # the movement in dollars is left out, and said


def _xlsx(rows):
    workbook = openpyxl.Workbook()
    for row in rows:
        workbook.active.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_n2_an_excel_statement():
    from datetime import datetime
    statement = bs.read_statement(_xlsx([
        ["Банка Пример", None, None, None, None],
        ["Дата", "Контрагент", "Основание", "Дебит", "Кредит", "Салдо"],
        [datetime(2026, 11, 3), "Строй Депо ЕООД", "ф-ра 4512", 1200, None, 8800],
        [datetime(2026, 11, 4), "Гама Трейд ООД", "фактура 1", None, 120.0, 8920],
    ]), "statement.xlsx")
    assert statement.format == "xlsx" and statement.closing_balance == 8920.0
    assert [(t.date, t.amount, t.counterparty) for t in statement.transactions] == [
        ("2026-11-03", -1200.0, "Строй Депо ЕООД"), ("2026-11-04", 120.0, "Гама Трейд ООД"),
    ]


def test_n2_what_is_no_statement_is_said_plainly():
    for content, name, said in (
        (b"", "a.csv", "празен"),
        (b"%PDF-1.7 ...", "a.pdf", "PDF"),
        (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1....", "a.xls", ".xls"),
        ("Име;Телефон\nИван;0888\n".encode("utf-8"), "a.csv", "дата и сума"),
        ("Дата;Сума;Основание\nняма;няма;нищо\n".encode("utf-8"), "a.csv", "няма движения"),
        (b"<?xml version='1.0'?><!DOCTYPE x [<!ENTITY a 'b'>]><Document/>", "a.xml", "не е банково"),
        (b"<Document><Other/></Document>", "a.xml", "CAMT"),
        # In leva or dollars: its sums cannot be set against documents in euro.
        ("Дата;Сума;Валута;Основание\n03.11.2026;-100,00;BGN;наем\n".encode("utf-8"), "a.csv", "BGN"),
        ("Дата;Сума;Основание\n03.11.2026;-100,00 лв.;наем\n".encode("utf-8"), "a.csv", "BGN"),
        (MT940.replace("EUR", "USD").encode("utf-8"), "a.sta", "USD"),
    ):
        with pytest.raises(bs.StatementError) as error:
            bs.read_statement(content, name)
        assert said in str(error.value), (name, str(error.value))
    # A file in euro with one movement in another currency: that one is left out.
    mixed = bs.read_statement(
        "Дата;Сума;Валута;Основание\n03.11.2026;-100,00;EUR;наем\n04.11.2026;-50,00;USD;софтуер\n".encode("utf-8"), "a.csv")
    assert (len(mixed.transactions), mixed.other_currency_rows, mixed.currency) == (1, 1, "EUR")


# ===================== matching =====================

def _doc(kind, id, name, left, number="", eik="", date="2026-10-20", hand=(), from_statements=()):
    """`hand`: payments typed in, (day, amount); `from_statements`: recorded
    from a statement, (day, amount, the movement's id)."""
    return bs.OpenDocument(kind=kind, id=id, name=name, left=left, number=number, eik=eik, date=date,
                           label=f"{name} № {number}", recorded_payments=[(d, a, "") for d, a in hand] + list(from_statements))


def _move(day, amount, party="", reason="", reference=""):
    return bs.BankTransaction(date=day, amount=amount, counterparty=party, description=reason, reference=reference)


def _match(moves, documents, applied=None):
    bs.fingerprint_all(moves)
    return bs.match_statement(moves, documents, applied)


def test_n2_names_and_numbers_as_a_bank_writes_them():
    assert bs.name_key("Строй Депо ЕООД") == bs.name_key("STROY DEPO EOOD") == "stroydepo"
    assert bs.same_party(_doc("invoice", "a", "Мебели Явор ООД", 10), _move("2026-11-03", -10, "MEBELI YAVOR"))
    assert bs.same_party(_doc("invoice", "a", "Енерго Про Продажби АД", 10), _move("2026-11-03", -10, "ENERGO PRO PRODAZHBI"))
    assert not bs.same_party(_doc("invoice", "a", "Мебели Явор ООД", 10), _move("2026-11-03", -10, "MEBELI BOR OOD"))
    # By the EIK in the reason, whatever the name says.
    assert bs.same_party(_doc("invoice", "a", "Алфа", 10, eik="131071587"), _move("2026-11-03", -10, "ДРУГО ИМЕ", "ЕИК 131071587"))
    for text, number, mentioned in (
        ("ф-ра 12", "12", True), ("сума 12.50", "12", False), ("INV-2026-001 плащане", "INV-2026-001", True),
        ("4512001", "4512", False), ("плащане по фактура 0000004512", "4512", True), ("faktura 0000000001", "0000000001", True),
        ("превод 2026", "1", False), ("", "4512", False), ("ф-ра 4512", "", False),
    ):
        assert bs.mentions_number(text, number) is mentioned, (text, number)


def test_n2_what_is_sure_what_is_asked_and_what_is_left_alone():
    documents = [
        _doc("invoice", "depo", "Строй Депо ЕООД", 1200, "4512"),
        _doc("invoice", "yavor", "Мебели Явор ООД", 900, "77"),
        _doc("invoice", "el1", "Електро ООД", 250, "1001", date="2026-10-01"),
        _doc("invoice", "el2", "Електро ООД", 250, "1002", date="2026-10-15"),
        _doc("invoice", "vod1", "Водоснабдяване АД", 40, "9001", date="2026-10-01"),
        _doc("invoice", "vod2", "Водоснабдяване АД", 60, "9002", date="2026-10-15"),
        _doc("receivable", "gama", "Гама Трейд ООД", 120, "0000000001"),
        _doc("receivable", "odd", "Случаен Клиент", 333.33),
    ]
    rows = _match([
        _move("2026-11-03", -1200, "STROY DEPO EOOD", "Плащане по ф-ра 4512"),      # number + amount
        _move("2026-11-04", 120, "GAMA TREYD OOD", "благодарим"),                    # name + amount
        _move("2026-11-05", -2.5, "", "Такса превод"),                               # a bank fee
        _move("2026-11-06", -300, "МЕБЕЛИ ЯВОР ООД", "частично"),                    # part of what is owed
        _move("2026-11-06", -250, "ELEKTRO OOD", "плащане"),                         # two invoices of 250
        _move("2026-11-07", -100, "VODOSNABDYAVANE AD", "за октомври"),              # both of its invoices together
        _move("2026-11-07", 333.33, "IVAN IVANOV", "превод"),                        # only the amount fits
    ], documents)
    seen = [(row["status"], row["reason"], [(t["id"], t["amount"]) for t in row["targets"]]) for row in rows]
    assert seen == [
        ("sure", "number_amount", [("depo", 1200)]),
        ("sure", "name_amount", [("gama", 120)]),
        ("none", "no_match", []),
        ("ask", "name_partial", [("yavor", 300)]),
        ("ask", "name_amount_several", [("el1", 250)]),
        ("sure", "name_all", [("vod1", 40), ("vod2", 60)]),
        ("ask", "amount_only", [("odd", 333.33)]),
    ]
    assert [a["id"] for a in rows[4]["alternatives"]] == ["el2"]
    # Money in is never set against a supplier invoice, nor money out against a customer.
    [wrong_way] = _match([_move("2026-11-03", 1200, "STROY DEPO EOOD", "ф-ра 4512")], documents)
    assert wrong_way["status"] == "none"


def test_n2_one_document_is_never_offered_as_sure_twice():
    documents = [_doc("invoice", "depo", "Строй Депо ЕООД", 1200, "4512")]
    first, second = _match([
        _move("2026-11-03", -1200, "STROY DEPO EOOD", "без номер"),
        _move("2026-11-05", -1200, "STROY DEPO EOOD", "ф-ра 4512"),
    ], documents)
    # The one that names the invoice takes it, wherever it stands in the file.
    assert (second["status"], second["reason"]) == ("sure", "number_amount")
    assert first["status"] == "none" and first["targets"] == []


def test_n2_a_payment_entered_by_hand_is_not_a_new_payment():
    # 600 of 1 200 paid and entered by hand on the 10th; the bank took it on the 3rd.
    half_paid = _doc("invoice", "depo", "Строй Депо ЕООД", 600, "4512", hand=[("2026-11-10", 600.0)])
    [row] = _match([_move("2026-11-03", -600, "STROY DEPO EOOD", "ф-ра 4512")], [half_paid])
    assert (row["status"], row["reason"]) == ("entered", "by_hand")
    assert row["entered"] == {"kind": "invoice", "id": "depo", "label": "Строй Депо ЕООД № 4512", "date": "2026-11-10", "amount": 600}
    # Should it be the second half after all, the person can say so.
    assert [(t["id"], t["amount"]) for t in row["targets"]] == [("depo", 600)]

    # Two halves in the statement, one entered: the closer one is it (the
    # 12th, two days from the 10th - the 3rd is seven), the other is new.
    first, second = _match([
        _move("2026-11-03", -600, "STROY DEPO EOOD", "ф-ра 4512"),
        _move("2026-11-12", -600, "STROY DEPO EOOD", "ф-ра 4512"),
    ], [half_paid])
    assert (first["status"], first["reason"], second["status"]) == ("sure", "number_amount", "entered")

    # Settled by hand: its movement is explained, with nothing left to record.
    settled = _doc("receivable", "gama", "Гама Трейд ООД", 0, "0000000001", hand=[("2026-11-04", 120.0)])
    [paid] = _match([_move("2026-11-04", 120, "GAMA TREYD OOD", "фактура 0000000001")], [settled])
    assert paid["status"] == "entered" and paid["targets"] == []
    # Weeks apart, or another sum: not that payment.
    [later] = _match([_move("2026-11-20", 120, "GAMA TREYD OOD", "фактура 0000000001")], [settled])
    assert later["status"] == "none"
    # The next month's instalment of the same sum is a new payment, not the one entered.
    monthly = _doc("invoice", "lease", "Лизинг АД", 1500, "LZ-2026-77", hand=[("2026-10-05", 500.0)])
    [november] = _match([_move("2026-11-05", -500, "LIZING AD", "вноска LZ-2026-77")], [monthly])
    assert (november["status"], november["reason"]) == ("ask", "number_partial")
    old = _doc("invoice", "depo", "Строй Депо ЕООД", 600, "4512", hand=[("2026-09-01", 600.0)])
    [new] = _match([_move("2026-11-03", -600, "STROY DEPO EOOD", "ф-ра 4512")], [old])
    assert (new["status"], new["reason"]) == ("sure", "number_amount")


def test_n2_the_same_movement_from_another_file_is_not_paid_again():
    # Recorded from the CSV; the same day's MT940 has it under another id.
    paid = _doc("invoice", "yavor", "Мебели Явор ООД", 600, "77", from_statements=[("2026-11-06", 300.0, "csv-id")])
    [again] = _match([_move("2026-11-06", -300, "MEBELI YAVOR OOD", "chastichno plashtane")], [paid])
    assert (again["status"], again["reason"], again["targets"]) == ("entered", "other_statement", [])
    # Another day's 300 is another payment.
    [next_one] = _match([_move("2026-11-20", -300, "MEBELI YAVOR OOD", "vtora vnoska")], [paid])
    assert (next_one["status"], next_one["reason"]) == ("ask", "name_partial")


# ===================== through the program =====================

def _statement_file(text=BG_CSV, name="izvlechenie.csv"):
    return {"file": (name, text.encode("cp1251"), "text/csv")}


def _business(client):
    """A supplier invoice by bank of 1 200 €, another of 900 €, and an
    invoice issued to a customer for 120 € - all three still owed."""
    company_id, owner_id, owner = _company()
    depo = client.post("/api/invoices", headers=owner, json={
        "supplier": "Строй Депо ЕООД", "invoice_number": "4512", "date": "2026-10-20", "amount_without_vat": 1000,
        "vat_amount": 200, "total_amount": 1200, "payment_method": "bank_transfer",
    }).json()
    yavor = client.post("/api/invoices", headers=owner, json={
        "supplier": "Мебели Явор ООД", "invoice_number": "77", "date": "2026-10-25", "amount_without_vat": 750,
        "vat_amount": 150, "total_amount": 900, "payment_method": "bank_transfer",
    }).json()
    issued = _issue(client, owner)
    assert issued["invoice_number"] == "0000000001" and issued["total_amount"] == 120
    return company_id, owner_id, owner, depo, yavor, issued


def _income_and_expense(client, owner):
    summary = client.get("/api/statistics/summary?start_date=2026-10-01&end_date=2026-11-30", headers=owner).json()
    return summary["total_income"], summary["total_expense"]


def test_n2_the_statement_pays_what_it_names_once(free_client):
    client = free_client
    company_id, _, owner, depo, yavor, issued = _business(client)
    before = _income_and_expense(client, owner)

    preview = client.post("/api/bank-statement/preview", headers=owner, files=_statement_file())
    assert preview.status_code == 200, preview.text
    seen = preview.json()
    assert (seen["format"], seen["count"], seen["from"], seen["to"]) == ("csv", 4, "2026-11-03", "2026-11-06")
    assert (seen["money_in"], seen["money_out"], seen["closing_balance"]) == (120, 1502.5, 8617.5)
    assert seen["counts"] == {"sure": 2, "ask": 1, "entered": 0, "none": 1, "applied": 0}
    rows = seen["transactions"]
    assert [(r["status"], r["reason"]) for r in rows] == [
        ("sure", "number_amount"), ("sure", "number_amount"), ("none", "no_match"), ("ask", "name_partial"),
    ]
    assert rows[0]["targets"] == [{"kind": "invoice", "id": depo["id"], "label": "Строй Депо ЕООД № 4512", "name": "Строй Депо ЕООД",
                                   "number": "4512", "left": 1200, "amount": 1200}]
    assert rows[1]["targets"][0]["id"] == issued["receivable_id"] and rows[1]["targets"][0]["label"] == "Гама Трейд ООД - фактура № 0000000001"
    # Looking is not recording.
    assert client.get(f"/api/invoices/{depo['id']}", headers=owner).json()["is_paid"] is False

    def chosen(row):
        return {"transaction_id": row["id"], "date": row["date"], "amount": row["amount"],
                "targets": [{"kind": t["kind"], "id": t["id"], "amount": t["amount"]} for t in row["targets"]]}

    done = client.post("/api/bank-statement/apply", headers=owner, json={"payments": [chosen(rows[0]), chosen(rows[1]), chosen(rows[3])]})
    assert done.status_code == 200, done.text
    assert done.json() == {"applied": 3, "already_recorded": 0, "failed": [], "balance_set": False,
                           "paid_to_suppliers": 1500, "received_from_customers": 120}

    paid = client.get(f"/api/invoices/{depo['id']}", headers=owner).json()
    assert (paid["is_paid"], paid["paid_amount"]) == (True, 1200)
    [payment] = paid["payments"]
    assert (payment["amount"], payment["date"], payment["method"], payment["bank_transaction"]) == (1200, "2026-11-03", "bank_transfer", rows[0]["id"])
    part = client.get(f"/api/invoices/{yavor['id']}", headers=owner).json()
    assert (part["is_paid"], part["paid_amount"], part["payments"][0]["date"]) == (False, 300, "2026-11-06")
    [receivable] = [r for r in client.get("/api/receivables", headers=owner).json() if r["id"] == issued["receivable_id"]]
    assert (receivable["is_paid"], receivable["paid_amount"], receivable["left_amount"]) == (True, 120, 0)
    assert (receivable["payments"][0]["date"], receivable["payments"][0]["method"]) == ("2026-11-04", "bank_transfer")
    # Money coming in on an invoice is not revenue a second time, and paying
    # an invoice is not an expense a second time: no day's revenue is made,
    # the period's income and expenses are what they were.
    assert asyncio.run(server.db.daily_revenue.count_documents({"company_id": company_id})) == 0
    assert _income_and_expense(client, owner) == before

    # The same statement again: what was recorded is shown as done, nothing is offered twice.
    again = client.post("/api/bank-statement/preview", headers=owner, files=_statement_file()).json()
    assert again["counts"] == {"sure": 0, "ask": 0, "entered": 0, "none": 1, "applied": 3}
    assert again["transactions"][0]["targets"][0]["amount"] == 1200
    # The same days downloaded as MT940 (other ids): already on record, not offered.
    mt940 = client.post("/api/bank-statement/preview", headers=owner,
                        files={"file": ("statement.sta", MT940.encode("utf-8"), "application/octet-stream")}).json()
    assert [(r["status"], r["reason"]) for r in mt940["transactions"]] == [("entered", "other_statement"), ("entered", "other_statement")]
    # ...and sent again all the same (two taps, an old screen): nothing is paid twice.
    repeat = client.post("/api/bank-statement/apply", headers=owner, json={"payments": [chosen(rows[0]), chosen(rows[1]), chosen(rows[3])]}).json()
    assert (repeat["applied"], repeat["already_recorded"], repeat["failed"]) == (0, 3, [])
    assert client.get(f"/api/invoices/{yavor['id']}", headers=owner).json()["paid_amount"] == 300
    # Even past the check: the payment code itself refuses the same movement on the same document.
    direct = client.post(f"/api/invoices/{yavor['id']}/payments", headers=owner,
                         json={"amount": 300, "date": "2026-11-06", "bank_transaction": rows[3]["id"]})
    assert direct.status_code == 409
    assert client.get(f"/api/invoices/{yavor['id']}", headers=owner).json()["paid_amount"] == 300


def test_n2_a_payment_entered_by_hand_is_not_recorded_again(free_client):
    client = free_client
    _, _, owner, depo, yavor, issued = _business(client)
    # The owner entered both by hand already: 1 200 € to the supplier, 120 € from the customer.
    assert client.post(f"/api/invoices/{depo['id']}/payments", headers=owner, json={"amount": 1200, "date": "2026-11-04"}).status_code == 200
    assert client.post(f"/api/receivables/{issued['receivable_id']}/payments", headers=owner,
                       json={"amount": 120, "date": "2026-11-04", "method": "bank_transfer"}).status_code == 200
    # ...and 300 € of the 900 €, a week after the bank took it.
    assert client.post(f"/api/invoices/{yavor['id']}/payments", headers=owner, json={"amount": 300, "date": "2026-11-13"}).status_code == 200

    seen = client.post("/api/bank-statement/preview", headers=owner, files=_statement_file()).json()
    assert seen["counts"] == {"sure": 0, "ask": 0, "entered": 3, "none": 1, "applied": 0}
    assert {row["reason"] for row in seen["transactions"] if row["status"] == "entered"} == {"by_hand"}
    first, second, _, fourth = seen["transactions"]
    assert first["entered"] == {"kind": "invoice", "id": depo["id"], "label": "Строй Депо ЕООД № 4512", "date": "2026-11-04", "amount": 1200}
    assert first["targets"] == [] and second["targets"] == []          # settled: nothing left to record
    assert second["entered"]["date"] == "2026-11-04"
    # The part payment: shown as entered, with what recording it anew would do.
    assert fourth["entered"]["date"] == "2026-11-13" and fourth["targets"][0]["amount"] == 300
    # A payment in cash is not in the bank: it explains no movement.
    _, _, other, _, _, other_issued = _business(client)
    client.post(f"/api/receivables/{other_issued['receivable_id']}/payments", headers=other, json={"amount": 120, "date": "2026-11-04", "method": "cash"})
    cash = client.post("/api/bank-statement/preview", headers=other, files=_statement_file()).json()
    assert cash["transactions"][1]["status"] == "none" and cash["counts"]["entered"] == 0


def test_n2_the_closing_balance_becomes_the_money_in_the_bank(free_client):
    client = free_client
    company_id, _, owner, *_ = _business(client)
    # Entered before the statement's last day: 500 € in hand, 9 000 € in the bank.
    client.post("/api/cash-flow/position", headers=owner, json={"cash": 500, "bank": 9000, "date": "2026-11-01"})
    seen = client.post("/api/bank-statement/preview", headers=owner, files=_statement_file()).json()
    assert (seen["can_set_balance"], seen["current_bank_balance"], seen["current_balance_date"], seen["balance_is_newer"]) == (
        True, 9000, "2026-11-01", False)
    done = client.post("/api/bank-statement/apply", headers=owner, json={
        "payments": [], "closing_balance": seen["closing_balance"], "closing_date": seen["closing_date"]}).json()
    assert done["balance_set"] is True and done["applied"] == 0
    position = asyncio.run(server.latest_cash_position(company_id))
    assert (position["cash"], position["bank"], position["date"]) == (500, 8617.5, "2026-11-06")   # the cash in hand stays

    # The person said how much there is after the statement's last day: that stays.
    client.post("/api/cash-flow/position", headers=owner, json={"cash": 400, "bank": 7000, "date": "2026-11-10"})
    later = client.post("/api/bank-statement/preview", headers=owner, files=_statement_file()).json()
    assert (later["can_set_balance"], later["balance_is_newer"], later["current_bank_balance"]) == (False, True, 7000)
    kept = client.post("/api/bank-statement/apply", headers=owner, json={"payments": [], "closing_balance": 8617.5, "closing_date": "2026-11-06"}).json()
    assert kept["balance_set"] is False
    assert asyncio.run(server.latest_cash_position(company_id))["bank"] == 7000


def test_n2_each_records_only_what_they_may(free_client):
    client = free_client
    company_id, _, owner, depo, yavor, issued = _business(client)
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Касиер")
    _, viewer = _user(company_id, "staff", ["view_statistics"], "Зрител")
    assert client.post("/api/bank-statement/preview", headers=viewer, files=_statement_file()).status_code == 403
    assert client.post("/api/bank-statement/apply", headers=viewer, json={"payments": []}).status_code == 403

    # Whoever enters revenue sees what customers owe - not the supplier invoices, not the balance.
    seen = client.post("/api/bank-statement/preview", headers=cashier, files=_statement_file()).json()
    assert (seen["can_pay_invoices"], seen["can_receive"], seen["can_set_balance"], seen["current_bank_balance"]) == (False, True, False, None)
    assert [r["status"] for r in seen["transactions"]] == ["none", "sure", "none", "none"]
    rows = client.post("/api/bank-statement/preview", headers=owner, files=_statement_file()).json()["transactions"]
    forced = client.post("/api/bank-statement/apply", headers=cashier, json={"closing_balance": 1, "payments": [
        {"transaction_id": rows[0]["id"], "date": rows[0]["date"], "amount": rows[0]["amount"],
         "targets": [{"kind": "invoice", "id": depo["id"], "amount": 1200}]},
        {"transaction_id": rows[1]["id"], "date": rows[1]["date"], "amount": rows[1]["amount"],
         "targets": [{"kind": "receivable", "id": issued["receivable_id"], "amount": 120}]},
    ]}).json()
    assert (forced["applied"], forced["balance_set"], forced["received_from_customers"], forced["paid_to_suppliers"]) == (1, False, 120, 0)
    assert [f["target_id"] for f in forced["failed"]] == [depo["id"]]
    assert client.get(f"/api/invoices/{depo['id']}", headers=owner).json()["is_paid"] is False

    # Another company's statement finds nothing of this one's, and cannot pay into it.
    _, _, stranger = _company()
    theirs = client.post("/api/bank-statement/preview", headers=stranger, files=_statement_file()).json()
    assert theirs["counts"]["none"] == 4
    crossed = client.post("/api/bank-statement/apply", headers=stranger, json={"payments": [
        {"transaction_id": rows[3]["id"], "date": rows[3]["date"], "amount": rows[3]["amount"],
         "targets": [{"kind": "invoice", "id": yavor["id"], "amount": 300}]}]}).json()
    assert crossed["applied"] == 0 and len(crossed["failed"]) == 1
    assert client.get(f"/api/invoices/{yavor['id']}", headers=owner).json()["paid_amount"] == 0


def test_n2_what_does_not_add_up_is_refused(free_client):
    client = free_client
    _, _, owner, depo, yavor, issued = _business(client)
    rows = client.post("/api/bank-statement/preview", headers=owner, files=_statement_file()).json()["transactions"]

    def send(row, targets, **changes):
        body = {"transaction_id": row["id"], "date": row["date"], "amount": row["amount"], "targets": targets, **changes}
        return client.post("/api/bank-statement/apply", headers=owner, json={"payments": [body]}).json()

    # Money out set against a customer's debt; more than the movement; one document twice; more than is owed.
    assert send(rows[0], [{"kind": "receivable", "id": issued["receivable_id"], "amount": 120}])["failed"][0]["target_id"] is None
    assert send(rows[3], [{"kind": "invoice", "id": yavor["id"], "amount": 900}])["applied"] == 0
    assert send(rows[3], [{"kind": "invoice", "id": yavor["id"], "amount": 100}, {"kind": "invoice", "id": yavor["id"], "amount": 100}])["applied"] == 0
    over = send(rows[0], [{"kind": "invoice", "id": yavor["id"], "amount": 1200}])
    assert over["applied"] == 0 and "Остават 900.00" in over["failed"][0]["message"]
    assert send(rows[0], [{"kind": "invoice", "id": depo["id"], "amount": 1200}], date="не е дата")["applied"] == 0
    for invoice in (depo, yavor):
        assert client.get(f"/api/invoices/{invoice['id']}", headers=owner).json()["paid_amount"] == 0

    # A file that is no statement, and one too big, are said - nothing is guessed.
    bad = client.post("/api/bank-statement/preview", headers=owner, files={"file": ("a.pdf", b"%PDF-1.7 ...", "application/pdf")})
    assert bad.status_code == 400 and "PDF" in bad.json()["detail"]
    big = client.post("/api/bank-statement/preview", headers=owner, files={"file": ("a.csv", b"x" * (5 * 1024 * 1024 + 1), "text/csv")})
    assert big.status_code == 413
