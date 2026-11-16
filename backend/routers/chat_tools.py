"""Data look-ups "Попитай числата си" can call as tools (P1 of the
intelligence analysis): instead of answering only from a fixed digest,
the model asks for exactly the item, supplier or period a question is
about - "how many pitas last month", "what did I spend at Metro in March",
"which weekday sells best". Generic for every business: nothing here knows
about any trade or item.

Every look-up is scoped to the viewer's company and applies the same
visibility rules as the rest of the app (pocket money, off-book expenses
and profit only for those allowed to see them). A day with no revenue
entered is reported as missing, never as zero revenue.

Not a router: shares server.py's helpers via `from server import *` like
the router modules, and reads `server.db` qualified (tests repoint it)."""
from collections import defaultdict
from datetime import date as date_type

from anthropic import beta_async_tool

from server import *
from server import _business_digest_period, _business_digest_top_expenses, _compare_key
import server

ALL_TIME_START = "2000-01-01"
MAX_MATCHES = 5
_WEEKDAYS_BG = ["понеделник", "вторник", "сряда", "четвъртък", "петък", "събота", "неделя"]


def _parse_day(value: Optional[str], default: str) -> date_type:
    try:
        return date_type.fromisoformat((value or default)[:10])
    except ValueError:
        raise ValueError(f"Невалидна дата '{value}' - очаква се ГГГГ-ММ-ДД")


def _resolve_range(start_date: Optional[str], end_date: Optional[str]) -> tuple:
    today = today_local()
    start = _parse_day(start_date, ALL_TIME_START)
    end = _parse_day(end_date, today.isoformat())
    if end < start:
        start, end = end, start
    return start, end


def _tokens(text: str) -> List[str]:
    return [t for t in re.findall(r"[^\W\d_]+", (text or "").lower()) if len(t) >= 3]


def _token_matches(query_token: str, name_token: str) -> bool:
    """Same word, allowing a different ending ("питки" / "питка",
    "домати" / "домат"): a shared beginning covering most of the shorter."""
    shorter = min(len(query_token), len(name_token))
    common = 0
    for a, b in zip(query_token, name_token):
        if a != b:
            break
        common += 1
    return common >= min(4, shorter) and common >= 0.7 * shorter


def name_match_score(query: str, name: str) -> float:
    """0..1 - how well a free-text query names an item or supplier."""
    q_key, n_key = _compare_key(query), _compare_key(name)
    if not q_key or not n_key:
        return 0.0
    if q_key == n_key:
        return 1.0
    if q_key in n_key or n_key in q_key:
        return 0.9
    q_tokens, n_tokens = _tokens(query), _tokens(name)
    if not q_tokens:
        return 0.0
    matched = sum(1 for qt in q_tokens if any(_token_matches(qt, nt) for nt in n_tokens))
    return 0.8 * matched / len(q_tokens)


class ChatDataTools:
    """The look-ups for one viewer. Each method returns plain JSON-able data."""

    def __init__(self, current_user: User, company_id: Optional[str], scope: dict, visibility: dict):
        self.user = current_user
        self.company_id = company_id
        self.scope = scope
        self.visibility = visibility

    async def period_totals(self, start_date: str, end_date: str) -> dict:
        start, end = _resolve_range(start_date, end_date)
        totals = await _business_digest_period(
            self.company_id, self.scope, self.user.user_id, start.isoformat(), end.isoformat(), self.visibility
        )
        logged = await server.db.daily_revenue.distinct(
            "date", {**self.scope, "date": {"$gte": start.isoformat(), "$lte": end.isoformat()}}
        )
        today = today_local()
        days = (min(end, today) - start).days + 1
        return {
            "from": start.isoformat(), "to": end.isoformat(), **totals,
            "revenue_days_entered": len(logged), "days_in_period_so_far": max(days, 0),
            "note": None if self.visibility["profit"] else "profit is not visible to this user",
        }

    async def revenue_breakdown(self, start_date: str, end_date: str, group_by: str) -> dict:
        start, end = _resolve_range(start_date, end_date)
        # The whole company's revenue - the same records Home counts.
        revenues = await server.db.daily_revenue.find(
            {**self.scope, "date": Period(start, end).text_filter()},
            {"_id": 0, "date": 1, "fiscal_revenue": 1, "pocket_money": 1},
        ).to_list(ALL_ROWS)
        by_day: Dict[str, float] = defaultdict(float)
        for r in revenues:
            if isinstance(r.get("date"), str):
                amount = r.get("fiscal_revenue", 0) + (r.get("pocket_money", 0) if self.visibility["pocket_money"] else 0)
                by_day[r["date"][:10]] += amount

        # Invoices issued to customers are revenue of their issue date - added
        # to the revenue, never counted as days of takings entered.
        issued_by_day = {day: v["total"] for day, v in (await issued_invoices_by_day(self.scope, Period(start, end))).items()}

        groups: Dict[str, Dict[str, float]] = defaultdict(lambda: {"revenue": 0.0, "days_entered": 0, "issued_invoices": 0.0})
        for day_str in set(by_day) | set(issued_by_day):
            day = date_type.fromisoformat(day_str)
            if group_by == "day":
                key = day_str
            elif group_by == "week":
                iso = day.isocalendar()
                key = f"{iso[0]}-W{iso[1]:02d}"
            elif group_by == "weekday":
                key = _WEEKDAYS_BG[day.weekday()]
            else:
                key = day_str[:7]
            if day_str in by_day:
                groups[key]["revenue"] += by_day[day_str]
                groups[key]["days_entered"] += 1
            if day_str in issued_by_day:
                groups[key]["revenue"] += issued_by_day[day_str]
                groups[key]["issued_invoices"] += issued_by_day[day_str]
        rows: List[Dict[str, Any]] = [
            {"group": key, "revenue": round(v["revenue"], 2), "days_entered": int(v["days_entered"]),
             "average_per_entered_day": (
                 round((v["revenue"] - v["issued_invoices"]) / v["days_entered"], 2) if v["days_entered"] else None
             ),
             # Said only where there are any: the takings are the rest.
             **({"of_which_issued_invoices": round(v["issued_invoices"], 2)} if v["issued_invoices"] else {})}
            for key, v in groups.items()
        ]
        if group_by == "weekday":
            rows.sort(key=lambda row: _WEEKDAYS_BG.index(str(row["group"])))
        else:
            rows.sort(key=lambda row: str(row["group"]))
        return {
            "from": start.isoformat(), "to": end.isoformat(), "group_by": group_by, "rows": rows[:400],
            "includes_pocket_money": self.visibility["pocket_money"],
            "note": "Days with no revenue entered are left out (unknown, not zero).",
        }

    async def top_expenses(self, start_date: str, end_date: str) -> dict:
        start, end = _resolve_range(start_date, end_date)
        items = await _business_digest_top_expenses(
            self.scope, start.isoformat(), end.isoformat(), self.visibility, limit=15
        )
        return {"from": start.isoformat(), "to": end.isoformat(), "top": items,
                "includes_off_book_expenses": self.visibility["off_book_expenses"]}

    async def item_purchases(self, item: str, start_date: Optional[str], end_date: Optional[str], group_by: str) -> dict:
        if not self.company_id:
            return {"matches": [], "note": "no company"}
        start, end = _resolve_range(start_date, end_date)
        mappings = await server.db.item_merge_mappings.find({"company_id": self.company_id}, {"_id": 0}).to_list(1000)
        variant_to_canonical, canonical_display = build_variant_to_canonical(mappings)
        rows = await server.db.item_price_history.find(
            {"company_id": self.company_id, "invoice_date": Period(start, end).datetime_filter()},
            {"_id": 0, "item_name": 1, "supplier": 1, "unit": 1, "quantity": 1, "unit_price": 1, "invoice_date": 1},
        ).to_list(ALL_ROWS)

        # One entry per (item, unit): pieces and kilograms are never summed together.
        stats: Dict[tuple, Dict[str, Any]] = {}
        for r in rows:
            name = (r.get("item_name") or "").lower()
            canonical = variant_to_canonical.get(name, name)
            display = canonical_display.get(canonical, r.get("item_name") or canonical)
            unit = normalize_unit(r.get("unit"))
            entry = stats.setdefault((canonical, unit), {
                "item": display, "unit": r.get("unit") or "бр.", "quantity": 0.0, "spent": 0.0,
                "purchases": 0, "prices": [], "suppliers": defaultdict(float), "by_month": defaultdict(lambda: [0.0, 0.0]),
            })
            qty = r.get("quantity") or 0
            price = r.get("unit_price") or 0
            entry["quantity"] += qty
            entry["spent"] += qty * price
            entry["purchases"] += 1
            entry["prices"].append(price)
            entry["suppliers"][r.get("supplier") or "—"] += qty
            row_day = business_day(r["invoice_date"]) if isinstance(r.get("invoice_date"), datetime) else None
            if row_day is not None:
                month = entry["by_month"][row_day.strftime("%Y-%m")]
                month[0] += qty
                month[1] += qty * price

        scored = sorted(
            ((name_match_score(item, entry["item"]), entry) for entry in stats.values()),
            key=lambda pair: (pair[0], pair[1]["spent"]), reverse=True,
        )
        matches: List[Dict[str, Any]] = []
        for score, entry in scored:
            if score < 0.4 or len(matches) >= MAX_MATCHES:
                break
            prices = entry["prices"]
            match = {
                "item": entry["item"], "unit": entry["unit"], "quantity": round(entry["quantity"], 3),
                "spent": round(entry["spent"], 2), "purchases": entry["purchases"],
                "avg_unit_price": round(entry["spent"] / entry["quantity"], 4) if entry["quantity"] else None,
                "min_unit_price": round(min(prices), 4), "max_unit_price": round(max(prices), 4),
                "match_score": round(score, 2),
            }
            if group_by in ("supplier", "month_and_supplier"):
                match["by_supplier_quantity"] = {k: round(v, 3) for k, v in entry["suppliers"].items()}
            if group_by in ("month", "month_and_supplier"):
                match["by_month"] = {
                    k: {"quantity": round(v[0], 3), "spent": round(v[1], 2)} for k, v in sorted(entry["by_month"].items())
                }
            matches.append(match)
        return {
            "from": start.isoformat(), "to": end.isoformat(), "query": item, "matches": matches,
            "note": None if matches else "No purchased item with a similar name in this period.",
        }

    async def supplier_purchases(self, supplier: str, start_date: Optional[str], end_date: Optional[str]) -> dict:
        start, end = _resolve_range(start_date, end_date)
        invoices = await server.db.invoices.find(
            {**self.scope, "date": Period(start, end).datetime_filter()},
            {"_id": 0, "supplier": 1, "total_amount": 1, "paid_amount": 1, "credited_amount": 1, "is_paid": 1, "payment_method": 1, "date": 1,
             "document_type": 1},
        ).to_list(ALL_ROWS)
        by_supplier: Dict[str, Dict[str, Any]] = {}
        for inv in invoices:
            name = inv.get("supplier") or "—"
            entry = by_supplier.setdefault(name, {"supplier": name, "invoices": 0, "credit_notes": 0, "total": 0.0,
                                                  "unpaid": 0.0, "first": None, "last": None})
            # A credit note (stored below zero) takes its amount off the total.
            entry["credit_notes" if inv.get("document_type") == CREDIT_NOTE else "invoices"] += 1
            entry["total"] += inv.get("total_amount", 0)
            if inv.get("payment_method") == "bank_transfer" and not inv.get("is_paid"):
                entry["unpaid"] += invoice_left(inv)
            day = inv["date"].date().isoformat() if isinstance(inv.get("date"), datetime) else None
            if day:
                entry["first"] = min(filter(None, [entry["first"], day]))
                entry["last"] = max(filter(None, [entry["last"], day]))

        scored = sorted(
            ((name_match_score(supplier, name), entry) for name, entry in by_supplier.items()),
            key=lambda pair: (pair[0], pair[1]["total"]), reverse=True,
        )
        matches: List[Dict[str, Any]] = []
        for score, entry in scored:
            if score < 0.4 or len(matches) >= MAX_MATCHES:
                break
            top_items = await self._top_items_for_supplier(entry["supplier"], start, end)
            matches.append({
                "supplier": entry["supplier"], "invoices": entry["invoices"], "credit_notes": entry["credit_notes"],
                "total": round(entry["total"], 2),
                "unpaid_bank_transfer": round(entry["unpaid"], 2), "first_invoice": entry["first"],
                "last_invoice": entry["last"], "top_items_by_spend": top_items, "match_score": round(score, 2),
            })
        return {"from": start.isoformat(), "to": end.isoformat(), "query": supplier, "matches": matches,
                "note": None if matches else "No supplier with a similar name has invoices in this period."}

    def sees_cash_flow(self) -> bool:
        """The money ahead: as in the app, for whoever sees the statistics
        and the profit."""
        return sees_cash_flow(self.user)

    async def cash_flow(self, days: int = 30) -> dict:
        """Will the money last: the money now as entered, the lowest point
        ahead and its day, the first day below zero, and what comes and goes
        - each payment and expected sum, without the day-by-day series."""
        flow = await cash_flow_projection(self.company_id, self.scope, self.user, days)
        weekly = [row for i, row in enumerate(flow["series"]) if i % 7 == 6 or i == len(flow["series"]) - 1]
        return {
            "from": flow["from"], "to": flow["to"], "money_now": flow["position"],
            "start_balance": flow["start_balance"], "end_balance": flow["end_balance"],
            "lowest": flow["lowest"], "first_day_below_zero": flow["first_negative"],
            "money_in": flow["total_in"], "money_out": flow["total_out"],
            "usual_till_revenue_in_it": flow["usual_revenue_total"],
            "overdue_from_customers_not_counted": flow["overdue_receivables"],
            "balance_each_week": [{"date": row["date"], "balance": row["balance"]} for row in weekly],
            "payments_and_receipts": flow["events"][:40],
            "pay_day": flow["pay_day"], "notes": flow["notes"],
        }

    def sees_customers(self) -> bool:
        """Customers and the documents to them: as in the app, for whoever
        enters revenue or issues invoices."""
        return bool({"add_revenue", "issue_invoices"} & set(self.user.permissions or []))

    async def customer_sales(self, customer: Optional[str] = None, start_date: Optional[str] = None,
                             end_date: Optional[str] = None) -> dict:
        """Per customer: invoiced in the range (less credit notes), bills,
        paid in it, owed and overdue now, to give back, and days late on
        average - one customer by a similar name, or the ones owing and
        bought the most."""
        if not self.sees_customers():
            return {"note": "customers are not visible to this user"}
        start, end = _resolve_range(start_date, end_date)
        today = today_local()
        known = await server.db.customers.find(self.scope, {"_id": 0, "id": 1, "name": 1}).to_list(ALL_ROWS)
        id_by_name = {_compare_key(c.get("name") or ""): c["id"] for c in known}
        name_by_id = {c["id"]: c.get("name") or "" for c in known}

        def key_of(doc: dict) -> str:
            return doc.get("customer_id") or id_by_name.get(_compare_key(doc.get("customer_name") or "")) \
                or "name:" + _compare_key(doc.get("customer_name") or "")

        rows: Dict[str, Dict[str, Any]] = {}

        def row(doc: dict) -> Dict[str, Any]:
            key = key_of(doc)
            if key not in rows:
                rows[key] = {"customer": name_by_id.get(key) or (doc.get("customer_name") or "—").strip(),
                             "invoiced": 0.0, "invoices": 0, "credit_notes": 0.0, "bills": 0.0, "paid_in_range": 0.0,
                             "owed_now": 0.0, "overdue_now": 0.0, "to_give_back": 0.0, "last_invoice": None,
                             "_late": []}
            return rows[key]

        documents = await server.db.billing_documents.find(
            {**self.scope, "doc_type": {"$in": ["invoice", "credit_note", "bill"]}, "cancelled": {"$ne": True}},
            {"_id": 0, "doc_type": 1, "customer_id": 1, "customer_name": 1, "issue_date": 1, "total_amount": 1},
        ).to_list(ALL_ROWS)
        for doc in documents:
            day = str(doc.get("issue_date") or "")[:10]
            entry = row(doc)
            if doc.get("doc_type") == "invoice" and day:
                entry["last_invoice"] = max(entry["last_invoice"] or day, day)
            if not (start.isoformat() <= day <= end.isoformat()):
                continue
            amount = float(doc.get("total_amount") or 0)
            if doc.get("doc_type") == "invoice":
                entry["invoiced"] += amount
                entry["invoices"] += 1
            elif doc.get("doc_type") == "credit_note":
                entry["invoiced"] += amount
                entry["credit_notes"] += amount
            else:
                entry["bills"] += amount

        for r in await server.db.receivables.find(self.scope, {"_id": 0}).to_list(ALL_ROWS):
            entry = row(r)
            left = receivable_left(r)
            entry["owed_now"] += left
            if left > 0 and r.get("due_date") and str(r["due_date"]) < today.isoformat():
                entry["overdue_now"] += left
            entry["to_give_back"] += receivable_refund_due(r)
            for payment in r.get("payments") or []:
                if start.isoformat() <= str(payment.get("date") or "") <= end.isoformat():
                    entry["paid_in_range"] += float(payment.get("amount") or 0)
            due = business_day(r.get("due_date")) if r.get("due_date") else None
            paid_days = [business_day(p.get("date")) for p in r.get("payments") or []]
            paid_on = max((d for d in paid_days if d), default=None)
            if r.get("is_paid") and not r.get("cancelled") and due and paid_on:
                entry["_late"].append(max((paid_on - due).days, 0))

        def shown(entry: Dict[str, Any]) -> Dict[str, Any]:
            late = entry.pop("_late")
            return {**{k: round(v, 2) if isinstance(v, float) else v for k, v in entry.items()},
                    "average_days_late": round(sum(late) / len(late), 1) if late else None}

        if customer:
            scored = sorted(((name_match_score(customer, e["customer"]), e) for e in rows.values()),
                            key=lambda pair: (pair[0], pair[1]["invoiced"]), reverse=True)
            matches = [shown(dict(e)) | {"match_score": round(score, 2)} for score, e in scored if score >= 0.4][:MAX_MATCHES]
            return {"from": start.isoformat(), "to": end.isoformat(), "query": customer, "matches": matches,
                    "note": None if matches else "No customer with a similar name."}
        everyone = [shown(dict(e)) for e in rows.values()]
        return {
            "from": start.isoformat(), "to": end.isoformat(),
            "owing_most_now": sorted((e for e in everyone if e["owed_now"] > 0), key=lambda e: e["owed_now"], reverse=True)[:10],
            "invoiced_most_in_range": sorted((e for e in everyone if e["invoiced"] or e["bills"]),
                                             key=lambda e: e["invoiced"] + e["bills"], reverse=True)[:10],
            "owed_now_total": round(sum(e["owed_now"] for e in everyone), 2),
            "overdue_now_total": round(sum(e["overdue_now"] for e in everyone), 2),
        }

    async def _top_items_for_supplier(self, supplier: str, start: date_type, end: date_type) -> List[dict]:
        if not self.company_id:
            return []
        rows = await server.db.item_price_history.find(
            {"company_id": self.company_id,
             "supplier": {"$regex": f"^{re.escape(supplier)}$", "$options": "i"},
             "invoice_date": Period(start, end).datetime_filter()},
            {"_id": 0, "item_name": 1, "unit": 1, "quantity": 1, "unit_price": 1},
        ).to_list(ALL_ROWS)
        spend: Dict[tuple, List[float]] = defaultdict(lambda: [0.0, 0.0])
        for r in rows:
            key = (r.get("item_name") or "—", r.get("unit") or "бр.")
            spend[key][0] += r.get("quantity") or 0
            spend[key][1] += (r.get("quantity") or 0) * (r.get("unit_price") or 0)
        top = sorted(spend.items(), key=lambda kv: kv[1][1], reverse=True)[:8]
        return [{"item": k[0], "unit": k[1], "quantity": round(v[0], 3), "spent": round(v[1], 2)} for k, v in top]


_DATE_HINT = "ГГГГ-ММ-ДД"


def build_chat_tools(data: ChatDataTools) -> list:
    """The tool definitions handed to the model, bound to one viewer."""

    def _dump(result: dict) -> str:
        return json.dumps(result, ensure_ascii=False, default=str)

    @beta_async_tool(
        name="period_totals",
        description=(
            "Revenue (оборот), expenses, profit and invoice count for ANY date range, plus how many days in "
            "it have revenue entered. Call it for a question about a specific day, week, month, quarter or "
            "year that the JSON digest does not cover, and once per period when comparing periods."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": f"First day, {_DATE_HINT}"},
                "end_date": {"type": "string", "description": f"Last day, {_DATE_HINT}"},
            },
            "required": ["start_date", "end_date"],
            "additionalProperties": False,
        },
    )
    async def period_totals(start_date: str, end_date: str) -> str:
        return _dump(await data.period_totals(start_date, end_date))

    @beta_async_tool(
        name="revenue_breakdown",
        description=(
            "Revenue for a date range split by day, ISO week, month or weekday, with the number of days that "
            "have revenue entered in each group. Call it for trends, best/worst days or weekdays, and month "
            "by month comparisons. Days without an entry are missing data, not zero revenue."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": f"First day, {_DATE_HINT}"},
                "end_date": {"type": "string", "description": f"Last day, {_DATE_HINT}"},
                "group_by": {"type": "string", "enum": ["day", "week", "month", "weekday"]},
            },
            "required": ["start_date", "end_date", "group_by"],
            "additionalProperties": False,
        },
    )
    async def revenue_breakdown(start_date: str, end_date: str, group_by: Literal["day", "week", "month", "weekday"]) -> str:
        return _dump(await data.revenue_breakdown(start_date, end_date, group_by))

    @beta_async_tool(
        name="top_expenses",
        description=(
            "The biggest expenses in a date range: total per supplier (purchase invoices) and, if this user "
            "may see them, per off-book expense description. Call it for 'where does my money go' questions "
            "about a period the JSON digest does not cover."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": f"First day, {_DATE_HINT}"},
                "end_date": {"type": "string", "description": f"Last day, {_DATE_HINT}"},
            },
            "required": ["start_date", "end_date"],
            "additionalProperties": False,
        },
    )
    async def top_expenses(start_date: str, end_date: str) -> str:
        return _dump(await data.top_expenses(start_date, end_date))

    @beta_async_tool(
        name="item_purchases",
        description=(
            "Purchases of an item found by name (spelling, case and word endings may differ): quantity per "
            "unit, money spent, number of purchases, lowest/highest/average unit price, optionally by month "
            "and/or by supplier. Call it for ANY question about how much of something was bought, how often, "
            "at what price or from whom - also when the item is not in the JSON digest. Returns up to 5 "
            "similar items; use the ones that fit the question and say which you used. Omit the dates for "
            "all of history."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "item": {"type": "string", "description": "The item as the user named it, e.g. 'питки'"},
                "start_date": {"type": "string", "description": f"First day, {_DATE_HINT} (optional)"},
                "end_date": {"type": "string", "description": f"Last day, {_DATE_HINT} (optional)"},
                "group_by": {"type": "string", "enum": ["none", "month", "supplier", "month_and_supplier"]},
            },
            "required": ["item", "group_by"],
            "additionalProperties": False,
        },
    )
    async def item_purchases(
        item: str, group_by: Literal["none", "month", "supplier", "month_and_supplier"],
        start_date: Optional[str] = None, end_date: Optional[str] = None,
    ) -> str:
        return _dump(await data.item_purchases(item, start_date, end_date, group_by))

    @beta_async_tool(
        name="supplier_purchases",
        description=(
            "Purchases from a supplier found by name: number of invoices, total, unpaid bank-transfer amount, "
            "first/last invoice date and the items bought most by money. Call it for questions about a "
            "supplier, e.g. 'how much did I spend at X in March'. Omit the dates for all of history."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "supplier": {"type": "string", "description": "The supplier as the user named it"},
                "start_date": {"type": "string", "description": f"First day, {_DATE_HINT} (optional)"},
                "end_date": {"type": "string", "description": f"Last day, {_DATE_HINT} (optional)"},
            },
            "required": ["supplier"],
            "additionalProperties": False,
        },
    )
    async def supplier_purchases(supplier: str, start_date: Optional[str] = None, end_date: Optional[str] = None) -> str:
        return _dump(await data.supplier_purchases(supplier, start_date, end_date))

    @beta_async_tool(
        name="customer_sales",
        description=(
            "Customers (the business's buyers): per customer what was invoiced in a date range (invoices less "
            "credit notes), bills, what they paid in it, what they owe now and how much of it is overdue, money "
            "to give back, the last invoice and how many days late they pay on average. With a customer name: "
            "that customer (found by a similar name). Without: the customers owing the most now and those "
            "invoiced the most in the range. Call it for 'who owes me the most', 'how much did I invoice X this "
            "year', 'does X pay on time'. Omit the dates for all of history."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "customer": {"type": "string", "description": "The customer as the user named it (optional)"},
                "start_date": {"type": "string", "description": f"First day, {_DATE_HINT} (optional)"},
                "end_date": {"type": "string", "description": f"Last day, {_DATE_HINT} (optional)"},
            },
            "required": [],
            "additionalProperties": False,
        },
    )
    async def customer_sales(customer: Optional[str] = None, start_date: Optional[str] = None, end_date: Optional[str] = None) -> str:
        return _dump(await data.customer_sales(customer, start_date, end_date))

    @beta_async_tool(
        name="cash_flow",
        description=(
            "Cash flow for the days ahead: will the money last. From the money the business has now (as the owner "
            "entered it, with its date): customer debts by due date and the usual till revenue coming in; supplier "
            "invoices by due date, recurring expenses, payroll on its pay day and VAT by the 14th going out. Gives the "
            "lowest point and its day, the first day below zero, the balance each week and every payment. Call it for "
            "'ще ми стигнат ли парите', 'колко пари ще имам в края на месеца', 'кога ще съм на минус'. days: 7-90."
        ),
        input_schema={
            "type": "object",
            "properties": {"days": {"type": "integer", "minimum": 7, "maximum": 90, "description": "How many days ahead (default 30)"}},
            "required": [],
            "additionalProperties": False,
        },
    )
    async def cash_flow(days: int = 30) -> str:
        return _dump(await data.cash_flow(days))

    tools = [period_totals, revenue_breakdown, top_expenses, item_purchases, supplier_purchases]
    # Customers: only for whoever may see them in the app.
    if data.sees_customers():
        tools.append(customer_sales)
    # The money ahead: likewise.
    if data.sees_cash_flow():
        tools.append(cash_flow)
    return tools
