"""The day card and the team's moments: a greeting by the time of day, the
weather where the business is (a forecast drawn by the test, the services
never reached), one line for the day, what the viewer's role needs today
and one spark - each number only for whoever may see it. Birthdays (day
and month, set by the person) greeted by the owner and the managers, and
the team reminded the day before an official holiday - once each.

Invented people and numbers."""
import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest

import server
from routers import day_card as card_router
from routers import team_moments
from services import day_card as dc
from services.business_calendar import BUSINESS_TZ
from tests.test_whole_program_fixes import _company, _user


def _forecast(day: date, kind_symbol: str = "rain", temps=(8, 14)):
    """A MET Norway compact forecast for the day: hourly steps 06-22."""
    steps = []
    for hour in range(6, 23):
        moment = datetime(day.year, day.month, day.day, hour, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
        temperature = temps[0] + (temps[1] - temps[0]) * (1 - abs(hour - 14) / 8)
        steps.append({
            "time": moment.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "data": {
                "instant": {"details": {"air_temperature": round(temperature, 1)}},
                "next_1_hours": {"summary": {"symbol_code": kind_symbol}, "details": {"precipitation_amount": 0.6}},
            },
        })
    return {"properties": {"timeseries": steps}}


# Places the stand-in geocoder knows; anything else it does not find.
TOWNS = {"софия": (42.6977, 23.3219), "пловдив": (42.1354, 24.7453), "варна": (43.2141, 27.9147),
         "бургас": (42.5048, 27.4626)}


@pytest.fixture
def weather(monkeypatch):
    calls = {"geocode": 0, "forecast": 0, "asked": []}

    async def geocode(_http, city, country="bg"):
        calls["geocode"] += 1
        calls["asked"].append(city)
        town = city.strip().lower()
        return (*TOWNS[town], city.strip()) if town in TOWNS else None

    async def reverse(_http, lat, lon):
        return "Пловдив"

    async def forecast(_http, lat, lon):
        calls["forecast"] += 1
        return _forecast(server.today_local())

    monkeypatch.setattr(dc, "geocode_city", geocode)
    monkeypatch.setattr(dc, "reverse_geocode", reverse)
    monkeypatch.setattr(dc, "fetch_forecast", forecast)
    # Places and forecasts are kept for every business: each test starts clean.
    asyncio.run(server.db.geocode_cache.delete_many({}))
    asyncio.run(server.db.weather_cache.delete_many({}))
    return calls


def test_the_pure_parts():
    assert dc.weather_kind("lightrainshowersandthunder_day") == dc.THUNDER
    assert dc.weather_kind("partlycloudy_night") == dc.PARTLY
    assert dc.weather_kind("heavysleet") == dc.SLEET
    assert dc.weather_kind("clearsky_day") == dc.CLEAR
    day = date(2026, 11, 19)
    summary = dc.day_weather(_forecast(day), day, datetime(2026, 11, 19, 9, tzinfo=BUSINESS_TZ))
    assert summary["kind"] == dc.RAIN and (summary["min"], summary["max"]) == (8, 14) and summary["now"] == 10
    assert dc.day_weather(_forecast(day), day + timedelta(days=5)) is None
    # Name days: fixed and around Easter (Orthodox Easter 2027 is 2 May).
    assert dc.orthodox_easter(2027) == date(2027, 5, 2)
    assert dc.name_days(date(2026, 5, 6)) == ["Георги", "Гергана"]
    assert "Цветан" in dc.name_days(date(2027, 4, 25)) and "Тодор" in dc.name_days(date(2027, 3, 20))
    assert dc.has_name_day("Георги Петров", dc.name_days(date(2026, 5, 6)))
    # Birthdays: day and month only; 29 February on the 28th in a common year.
    assert dc.valid_birthday("02-29") and not dc.valid_birthday("13-01") and not dc.valid_birthday("2-3")
    assert dc.birthday_today("02-29", date(2027, 2, 28)) and not dc.birthday_today("02-29", date(2028, 2, 28))
    # The line: one per day and business, the same all day.
    assert dc.template_line(dc.RAIN, day, "c1") == dc.template_line(dc.RAIN, day, "c1")
    assert dc.template_line(None, day, "c1")


def test_the_weather_effect_is_learned_from_the_business_own_days():
    start = date(2026, 1, 5)   # a Monday
    revenue, log = {}, []
    for n in range(84):        # twelve weeks, every third day wet
        day = start + timedelta(days=n)
        wet = n % 3 == 0
        log.append({"date": day.isoformat(), "kind": dc.RAIN if wet else dc.CLEAR})
        revenue[day.isoformat()] = (850.0 if wet else 1000.0) * (1.4 if day.weekday() == 5 else 1.0)
    assert dc.weather_effect(log, revenue) == -15
    # Too few wet days: nothing is claimed.
    assert dc.weather_effect(log[:12], revenue) is None


def test_the_card_by_role(client, weather, monkeypatch):
    company_id, owner_id, owner = _company()
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"city": "София"}}))
    today = server.today_local()
    yesterday = today - timedelta(days=1)
    client.post("/api/daily-revenue", headers=owner, json={"date": yesterday.isoformat(), "fiscal_revenue": 1000, "pocket_money": 200})
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Ивана Касиерова")

    card = client.get("/api/day-card", headers=owner).json()
    assert card["greeting"]["name"] == "Собственик" and card["greeting"]["part"] in ("morning", "day", "evening", "night")
    assert card["weather"]["kind"] == dc.RAIN and card["weather"]["place"] == "София"
    assert card["attribution"] == "MET Norway" and card["line"]["source"] == "template" and card["line"]["text"]
    texts = " ".join(item["text"] for item in card["focus"])
    assert "1\u00a0200,00" in texts     # the owner sees yesterday with pocket money

    # Kept: the place found once, the forecast asked once for both cards.
    seen = client.get("/api/day-card", headers=cashier).json()
    assert (weather["geocode"], weather["forecast"]) == (1, 1)
    # The cashier sees no amount anywhere on it.
    assert "€" not in str(seen) and "1\u00a0000" not in str(seen) and "1\u00a0200" not in str(seen)
    assert seen["weather"]["effect_percent"] is None

    # Home carries the same card in its one request.
    home = client.get("/api/home", headers=owner).json()
    assert home["day_card"]["greeting"]["name"] == "Собственик"

    # Without the forecast the card still comes, without the weather.
    async def no_forecast(_http, lat, lon):
        return None
    monkeypatch.setattr(dc, "fetch_forecast", no_forecast)
    asyncio.run(server.db.weather_cache.delete_many({}))
    assert client.get("/api/day-card", headers=owner).json()["weather"] is None


def test_birthdays_on_the_card_and_greeted_once(client, weather):
    company_id, owner_id, owner = _company()
    _, manager = _user(company_id, "manager", sorted(server.ROLE_PERMISSIONS["manager"]), "Петър Управителев")
    worker_id, worker = _user(company_id, "staff", ["team_collaboration"], "Мария Пробна")
    today = server.today_local()
    mm_dd = f"{today.month:02d}-{today.day:02d}"

    assert client.put("/api/auth/me/birthday", headers=worker, json={"birthday": "13-40"}).status_code == 400
    assert client.put("/api/auth/me/birthday", headers=worker, json={"birthday": mm_dd}).json() == {"birthday": mm_dd}
    assert client.get("/api/auth/me/birthday", headers=worker).json() == {"birthday": mm_dd}

    # The colleagues see it on the day card; the person is greeted.
    assert client.get("/api/day-card", headers=owner).json()["spark"]["text"] == "Днес е рожденият ден на Мария"
    assert client.get("/api/day-card", headers=worker).json()["spark"]["key"] == "birthday_mine"

    morning = datetime(today.year, today.month, today.day, 9, tzinfo=BUSINESS_TZ)
    assert asyncio.run(team_moments.team_moments_tick(morning))["birthdays"] == 1
    assert asyncio.run(team_moments.team_moments_tick(morning))["birthdays"] == 0    # once
    [greeting] = asyncio.run(server.db.messages.find({"company_id": company_id, "kind": "birthday"}, {"_id": 0}).to_list(None))
    assert greeting["sender_id"] == owner_id and greeting["automatic"] is True
    assert greeting["text"] == "Честит рожден ден, Мария! 🎉 Много здраве, усмивки и успехи – от Собственик и Петър."
    # The person reads it in their messages.
    conversations = client.get("/api/messages/conversations", headers=worker).json()
    assert any(c["last_message"] == greeting["text"] for c in conversations)

    # Taken away: no longer on the card.
    client.put("/api/auth/me/birthday", headers=worker, json={"birthday": None})
    assert (client.get("/api/day-card", headers=owner).json()["spark"] or {}).get("key") != "birthday"


def test_the_team_is_reminded_of_a_holiday_the_day_before(client, weather):
    company_id, _, owner = _company()
    _user(company_id, "staff", ["team_collaboration"], "Мария Пробна")
    eve = date(2027, 3, 2)          # the day before 3 March
    at_ten = datetime(2027, 3, 2, 10, 30, tzinfo=BUSINESS_TZ)
    assert asyncio.run(team_moments.team_moments_tick(datetime(2027, 3, 2, 9, tzinfo=BUSINESS_TZ)))["holidays"] == 0
    assert asyncio.run(team_moments.team_moments_tick(at_ten))["holidays"] >= 1
    [reminder] = asyncio.run(server.db.messages.find({"company_id": company_id, "kind": "holiday"}, {"_id": 0}).to_list(None))
    assert reminder["conversation_id"] == f"team:{company_id}" and reminder["sender_name"] == "Фактура+"
    assert reminder["text"].startswith("Утре (3 март) е ") and "Работим по график" in reminder["text"]
    assert asyncio.run(team_moments.team_moments_tick(at_ten))["holidays"] == 0      # once

    # A business that turned it off is not written to.
    other_id, _, other_owner = _company()
    assert client.put("/api/company/team-moments", headers=other_owner, json={"holidays": False}).json() == {
        "birthdays": True, "holidays": False}
    asyncio.run(server.db.team_moments.delete_many({}))
    asyncio.run(team_moments.team_moments_tick(at_ten))
    assert asyncio.run(server.db.messages.count_documents({"company_id": other_id})) == 0
    assert eve.isoformat() == "2027-03-02"


def test_the_ai_line_is_written_once_a_day_from_nothing_confidential(client, weather, monkeypatch):
    import json
    from types import SimpleNamespace
    company_id, _, owner = _company()
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"city": "София"}}))
    seen = []

    class FakeMessages:
        async def create(self, **kwargs):
            seen.append(kwargs)
            return SimpleNamespace(
                stop_reason="end_turn", usage=SimpleNamespace(input_tokens=1, output_tokens=1),
                content=[SimpleNamespace(type="text", text=json.dumps({"line": "Дъждовен ден – спокоен ритъм и топъл прием."}))],
            )

    async def no_log(*_args, **_kwargs):
        return None
    monkeypatch.setattr(server, "anthropic_client", SimpleNamespace(beta=SimpleNamespace(messages=FakeMessages())))
    monkeypatch.setattr(card_router, "log_ai_usage", no_log)
    today = server.today_local()
    weather_today = dc.day_weather(_forecast(today), today)
    facts = card_router._line_facts(today, weather_today, False)
    asyncio.run(card_router._write_line(company_id, today, "bg", facts))

    [call] = seen
    assert call["model"] == "claude-opus-5-5" and call["output_config"]["effort"] == "low"
    sent = json.loads(call["messages"][0]["content"])
    # Only the day, the season, the weather, holidays and name days - nothing of the business.
    assert set(sent) == {"language", "day", "season", "weather", "holiday_today", "holiday_tomorrow", "name_days"}
    assert "Собственик" not in str(sent) and "€" not in str(sent)
    line = client.get("/api/day-card", headers=owner).json()["line"]
    assert line == {"text": "Дъждовен ден – спокоен ритъм и топъл прием.", "source": "ai"}


def test_every_tap_opens_what_the_viewer_may_open(client, weather):
    """Yesterday's revenue not entered: the line opens the revenue form on
    that day - on Home for the owner, on Team for a cashier without Home (no
    statistics). A birthday opens the messages only for whoever uses the
    team chat."""
    company_id, _, owner = _company()
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Ивана Касиерова")
    worker_id, _ = _user(company_id, "staff", ["team_collaboration"], "Мария Пробна")
    today = server.today_local()
    yesterday = (today - timedelta(days=1)).isoformat()
    asyncio.run(server.db.users.update_one(
        {"user_id": worker_id}, {"$set": {"birthday": f"{today.month:02d}-{today.day:02d}"}}))

    mine = client.get("/api/day-card", headers=owner).json()
    [missing] = [item for item in mine["focus"] if item["key"] == "missing_revenue"]
    assert missing["route"] == f"/?revenueDate={yesterday}"
    assert mine["spark"]["key"] == "birthday" and mine["spark"]["route"] == "/messages"

    theirs = client.get("/api/day-card", headers=cashier).json()
    [cashier_missing] = [item for item in theirs["focus"] if item["key"] == "missing_revenue"]
    assert cashier_missing["route"] == f"/team?revenueDate={yesterday}"
    # Still no amount anywhere on the cashier's card.
    assert "€" not in str(theirs)
    assert theirs["spark"]["key"] == "birthday" and theirs["spark"]["route"] is None



def test_the_town_is_read_from_an_address_as_people_write_it():
    assert dc.place_queries("гр. Пловдив, ул. Иван Вазов 12")[0] == "Пловдив"
    assert dc.place_queries("ул. Витоша 15, 1000 София")[0] == "София"
    assert dc.place_queries("с. Лозен, общ. Столична, обл. София")[0] == "Лозен"
    assert dc.place_queries("к.к. Слънчев бряг, хотел Изгрев")[0] == "Слънчев бряг"
    assert dc.place_queries("бул. България 1, Бургас")[0] == "Бургас"
    assert dc.place_queries("ПЛОВДИВ 4000 бул. Руски 15")[0] == "ПЛОВДИВ"
    assert dc.place_queries("Банско, ул. Пирин 2, България")[0] == "Банско"
    # Nothing that names a town: the whole address is asked, as it is.
    assert dc.place_queries("ж.к. Младост 1, бл. 12, вх. А") == ["ж.к. Младост 1, бл. 12, вх. А"]
    assert dc.place_queries("") == [] and dc.place_queries(None) == []


def test_the_place_comes_from_what_the_business_already_has(client, weather):
    # Its address - the town in it is looked up, nothing typed for it.
    company_id, _, owner = _company()
    asyncio.run(server.db.companies.update_one(
        {"id": company_id}, {"$set": {"address": "гр. Пловдив, ул. Иван Вазов 12"}}))
    card = client.get("/api/day-card", headers=owner).json()
    assert card["weather"]["place"] == "Пловдив" and card["place_missing"] is False
    assert weather["asked"] == ["Пловдив"]

    # Another business in the same town: the town is not asked about again.
    other_id, _, other = _company()
    asyncio.run(server.db.companies.update_one(
        {"id": other_id}, {"$set": {"address": "ул. Главна 1, 4000 Пловдив"}}))
    assert client.get("/api/day-card", headers=other).json()["weather"]["place"] == "Пловдив"
    assert weather["asked"] == ["Пловдив"]

    # No address, but a site with one.
    site_id, _, site_owner = _company()
    asyncio.run(server.db.locations.insert_one({
        "id": "loc_" + site_id, "company_id": site_id, "name": "Център", "address": "бул. България 1, Бургас",
        "created_at": datetime.now(timezone.utc)}))
    assert client.get("/api/day-card", headers=site_owner).json()["weather"]["place"] == "Бургас"

    # An address that names no town the map knows: the whole of it is asked
    # once, then nothing more for a while - and the card says the place is
    # still missing.
    unknown_id, _, unknown = _company()
    asyncio.run(server.db.companies.update_one(
        {"id": unknown_id}, {"$set": {"address": "ж.к. Нищо 1, бл. 12"}}))
    first = client.get("/api/day-card", headers=unknown).json()
    assert first["weather"] is None and first["place_missing"] is True
    asked = len(weather["asked"])
    client.get("/api/day-card", headers=unknown)
    assert len(weather["asked"]) == asked


def test_a_manager_shows_the_weather_here_when_nothing_tells(client, weather):
    company_id, _, owner = _company()
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Ивана Касиерова")
    card = client.get("/api/day-card", headers=owner).json()
    assert card["weather"] is None and card["place_missing"] is True

    point = {"lat": 42.145678, "lon": 24.749912}
    assert client.put("/api/company/weather-place", headers=cashier, json=point).status_code == 403
    saved = client.put("/api/company/weather-place", headers=owner, json=point).json()
    # About a kilometre, no closer - and for the business, not the person.
    assert saved == {"lat": 42.15, "lon": 24.75, "name": "Пловдив"}
    kept = asyncio.run(server.db.companies.find_one({"id": company_id}, {"_id": 0, "weather_point": 1}))["weather_point"]
    assert set(kept) == {"lat", "lon", "name", "at"}

    card = client.get("/api/day-card", headers=cashier).json()
    assert card["weather"]["place"] == "Пловдив" and card["place_missing"] is False


def test_the_town_on_a_scanned_invoice_to_the_business(client, weather, monkeypatch):
    from types import SimpleNamespace
    import base64
    from routers import scan_credits
    from tests.test_document_scan import _photo
    company_id, _, owner = _company()
    asyncio.run(server.db.companies.update_one(
        {"id": company_id}, {"$set": {"eik": "131071587", "vat_number": "BG131071587"}}))
    buyers = [("BG131071587", "Варна"), ("204000000", "Русе")]

    class FakeMessages:
        async def parse(self, **_kwargs):
            buyer_eik, buyer_city = buyers.pop(0)
            extraction = server.ClaudeInvoiceExtraction(
                supplier="Доставчик Проба ЕООД", invoice_number="0000000124", invoice_date="2026-11-10",
                buyer="Проба ООД", buyer_eik=buyer_eik, buyer_city=buyer_city,
                amount_without_vat=100, vat_amount=20, total_amount=120,
            )
            return SimpleNamespace(parsed_output=extraction, usage=SimpleNamespace(input_tokens=1, output_tokens=1))

    async def no_log(*_args, **_kwargs):
        return None

    monkeypatch.setattr(server, "AI_FEATURES_ENABLED", True)
    monkeypatch.setattr(server, "anthropic_client", SimpleNamespace(messages=FakeMessages()))
    monkeypatch.setattr(scan_credits, "anthropic_client", server.anthropic_client, raising=False)
    monkeypatch.setattr(scan_credits, "log_ai_usage", no_log)
    photo = "data:image/jpeg;base64," + base64.b64encode(_photo()).decode()

    # An invoice to this business: its town is kept.
    assert client.post("/api/ocr/scan", headers=owner, json={"image_base64s": [photo]}).status_code == 200
    # An invoice to someone else (another EIK): not.
    assert client.post("/api/ocr/scan", headers=owner, json={"image_base64s": [photo]}).status_code == 200
    company = asyncio.run(server.db.companies.find_one({"id": company_id}, {"_id": 0, "weather_hint": 1}))
    assert company["weather_hint"]["city"] == "Варна"
    assert client.get("/api/day-card", headers=owner).json()["weather"]["place"] == "Варна"


def test_to_order_today_for_whoever_orders(client, weather):
    from tests.test_reorder_plan import ALPHA, BETA, _bought
    company_id, _, owner = _company()
    _, manager = _user(company_id, "manager", sorted(server.ROLE_PERMISSIONS["manager"]), "Петър Управителев")
    _, accountant = _user(company_id, "accountant", sorted(server.ROLE_PERMISSIONS["accountant"]), "Анна Счетоводителева")
    yesterday = (server.today_local() - timedelta(days=1)).isoformat()
    client.post("/api/daily-revenue", headers=owner, json={"date": yesterday, "fiscal_revenue": 500})
    asyncio.run(server.db.item_price_history.insert_many(
        _bought(company_id, ALPHA, "ръкавици L", [58, 44, 30, 16], quantity=3)
        + _bought(company_id, BETA, "пилешко филе", [11, 9, 7, 5], quantity=2)
    ))

    def to_order(headers):
        return next((item for item in client.get("/api/day-card", headers=headers).json()["focus"]
                     if item["key"] == "to_order"), None)

    line = to_order(owner)
    assert line["text"] == "За поръчка днес: Доставчик Алфа, Доставчик Бета" and line["route"] == "/stats?tab=items"
    assert to_order(manager) is not None
    # The accountant keeps the books, not the orders.
    assert to_order(accountant) is None

    # Ordered: off the line at once, for everyone.
    client.post("/api/items/reorder-plan/ordered", headers=manager, json={"item_keys": ["ръкавици l"]})
    assert to_order(owner)["text"] == "За поръчка днес: Доставчик Бета"
    client.post("/api/items/reorder-plan/ordered", headers=owner, json={"item_keys": ["пилешко филе"]})
    assert to_order(owner) is None
