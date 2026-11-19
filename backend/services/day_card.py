"""The day card (Home, and Team for whoever has no Home): a personal
greeting, the day's weather where the business is, one line for the day,
what the viewer's role needs today and one small spark - a birthday, a
name day, a holiday, a record.

Free by design. The forecast is MET Norway's (free, commercial use allowed
with attribution "MET Norway"), the place of the business's city comes
from OpenStreetMap's Nominatim once and is kept; everything else is the
business's own data. The only paid part, optional, is one line a day per
business written by the AI from nothing confidential (routers/day_card).

This module is pure - no database - apart from the two fetchers, which
take an HTTP client so the tests can stand in for the services."""
from __future__ import annotations

import hashlib
import logging
import statistics
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from services.business_calendar import BUSINESS_TZ

logger = logging.getLogger(__name__)

# Both services ask to be told who calls them; no person's data in it.
USER_AGENT = "FakturaPlus/1.0 (+https://fakturaplus-frontend.onrender.com)"
FORECAST_URL = "https://api.met.no/weatherapi/locationforecast/2.0/compact"
GEOCODE_URL = "https://nominatim.openstreetmap.org/search"
# How long a forecast is kept before it is asked for again.
FORECAST_TTL = timedelta(hours=2)
REQUEST_TIMEOUT = 4.0

# What the sky does, from MET Norway's symbol codes.
CLEAR, PARTLY, CLOUDY, FOG, RAIN, SLEET, SNOW, THUNDER = (
    "clear", "partly", "cloudy", "fog", "rain", "sleet", "snow", "thunder",
)
WET_KINDS = {RAIN, SLEET, SNOW, THUNDER}
# The weather's effect on revenue is told only from this many days of each
# kind, and only when it is at least this large.
EFFECT_MIN_DAYS = 8
EFFECT_MIN_PERCENT = 8


def weather_kind(symbol_code: Optional[str]) -> Optional[str]:
    """MET Norway's symbol code ("lightrainshowers_day", "partlycloudy_night"...) as one kind."""
    if not symbol_code:
        return None
    base = symbol_code.split("_")[0]
    if "thunder" in base:
        return THUNDER
    if "snow" in base:
        return SNOW
    if "sleet" in base:
        return SLEET
    if "rain" in base:
        return RAIN
    if base == "fog":
        return FOG
    if base == "cloudy":
        return CLOUDY
    if base in ("partlycloudy", "fair"):
        return PARTLY
    if base == "clearsky":
        return CLEAR
    return CLOUDY


# How much a kind weighs when the day has several: the wettest part of the
# working day is what the day is remembered for.
_KIND_WEIGHT = {CLEAR: 0, PARTLY: 1, CLOUDY: 2, FOG: 3, RAIN: 5, SLEET: 6, SNOW: 7, THUNDER: 8}


def day_weather(forecast: Dict[str, Any], day: date, now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """The business day's weather from a MET Norway compact forecast: now
    (the forecast's hour nearest to `now`), the rest of the day's lowest
    and highest, its main kind over the working hours (8-20) and the rain
    or snow expected that day."""
    steps = ((forecast or {}).get("properties") or {}).get("timeseries") or []
    temps: List[float] = []
    kinds: List[str] = []
    precipitation = 0.0
    now_temp: Optional[float] = None
    now_kind: Optional[str] = None
    nearest: Optional[float] = None
    for step in steps:
        try:
            moment = datetime.fromisoformat(str(step["time"]).replace("Z", "+00:00")).astimezone(BUSINESS_TZ)
        except (KeyError, ValueError):
            continue
        if moment.date() != day:
            continue
        data = step.get("data") or {}
        temperature = ((data.get("instant") or {}).get("details") or {}).get("air_temperature")
        hour = data.get("next_1_hours") or data.get("next_6_hours") or {}
        kind = weather_kind((hour.get("summary") or {}).get("symbol_code"))
        if isinstance(temperature, (int, float)):
            temps.append(float(temperature))
            distance = abs((moment - now).total_seconds()) if now else 0.0
            if nearest is None or distance < nearest:
                nearest, now_temp, now_kind = distance, float(temperature), kind
        if kind and 8 <= moment.hour <= 20:
            kinds.append(kind)
        one_hour = data.get("next_1_hours")
        if one_hour:
            amount = (one_hour.get("details") or {}).get("precipitation_amount")
            if isinstance(amount, (int, float)):
                precipitation += float(amount)
    if not temps:
        return None
    main = max(kinds or [now_kind or CLOUDY], key=lambda k: (_KIND_WEIGHT.get(k, 0), kinds.count(k)))
    # A passing drop does not make a rainy day.
    if main in WET_KINDS and precipitation < 0.5 and kinds.count(main) < 2:
        main = CLOUDY
    return {
        "now": round(now_temp) if now_temp is not None else None,
        "min": round(min(temps)), "max": round(max(temps)),
        "kind": main, "now_kind": now_kind or main,
        "precipitation_mm": round(precipitation, 1),
    }


async def fetch_forecast(http, lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """MET Norway's compact forecast for a place, or None when it does not answer."""
    try:
        response = await http.get(
            FORECAST_URL, params={"lat": f"{lat:.3f}", "lon": f"{lon:.3f}"},
            headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT,
        )
        if response.status_code != 200:
            logger.warning(f"Forecast service answered {response.status_code}")
            return None
        return response.json()
    except Exception as error:  # the card simply goes without the weather
        logger.warning(f"Forecast service unreachable: {error}")
        return None


async def geocode_city(http, city: str, country: str = "bg") -> Optional[Tuple[float, float, str]]:
    """(lat, lon, the place's name) of a city, from OpenStreetMap - asked once
    per business and kept."""
    try:
        response = await http.get(
            GEOCODE_URL, params={"q": city, "countrycodes": country, "format": "json", "limit": 1},
            headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT,
        )
        if response.status_code != 200:
            return None
        rows = response.json()
        if not rows:
            return None
        return float(rows[0]["lat"]), float(rows[0]["lon"]), str(rows[0].get("display_name") or city).split(",")[0]
    except Exception as error:
        logger.warning(f"Geocoding unreachable: {error}")
        return None


def part_of_day(moment: datetime) -> str:
    hour = moment.hour
    if 5 <= hour < 11:
        return "morning"
    if 11 <= hour < 18:
        return "day"
    if 18 <= hour < 23:
        return "evening"
    return "night"


def first_name(full_name: Optional[str]) -> str:
    return (full_name or "").strip().split(" ")[0] if full_name else ""


# ---- Name days (Bulgarian): the widely kept ones, fixed and around Easter.
_NAME_DAYS_FIXED: Dict[Tuple[int, int], Tuple[str, ...]] = {
    (1, 1): ("Васил", "Василка"),
    (1, 6): ("Йордан", "Йорданка"),
    (1, 7): ("Иван", "Иванка", "Ивана", "Ваня"),
    (1, 17): ("Антон", "Антония", "Антоанета"),
    (1, 18): ("Атанас", "Атанаска"),
    (2, 1): ("Трифон",),
    (3, 25): ("Благовест", "Благовеста", "Благой"),
    (5, 6): ("Георги", "Гергана"),
    (5, 11): ("Кирил", "Методий"),
    (5, 21): ("Константин", "Костадин", "Елена"),
    (6, 29): ("Петър", "Петя", "Павел", "Павлина"),
    (7, 17): ("Марина", "Марин"),
    (7, 20): ("Илия", "Илиян", "Илияна"),
    (8, 15): ("Мария", "Мариана", "Мара"),
    (9, 17): ("Вяра", "Надежда", "Любов", "София"),
    (10, 26): ("Димитър", "Димитрина", "Димо"),
    (11, 8): ("Михаил", "Михаела", "Ангел", "Ангелина"),
    (11, 25): ("Екатерина", "Катерина"),
    (11, 30): ("Андрей",),
    (12, 4): ("Варвара",),
    (12, 6): ("Никола", "Николай", "Николина"),
    (12, 20): ("Игнат",),
    (12, 25): ("Христо", "Христина"),
    (12, 27): ("Стефан", "Стефка"),
}


def orthodox_easter(year: int) -> date:
    """Orthodox Easter Sunday (Meeus' Julian algorithm, +13 days to the Gregorian)."""
    a, b, c = year % 4, year % 7, year % 19
    d = (19 * c + 15) % 30
    e = (2 * a + 4 * b - d + 34) % 7
    month = (d + e + 114) // 31
    day = (d + e + 114) % 31 + 1
    return date(year, month, day) + timedelta(days=13)


def name_days(day: date) -> List[str]:
    """Who has a name day on the day - the widely kept ones."""
    names = list(_NAME_DAYS_FIXED.get((day.month, day.day), ()))
    easter = orthodox_easter(day.year)
    if day == easter - timedelta(days=43):      # Тодоровден: Lent's first Saturday
        names += ["Тодор", "Теодора", "Тодорка"]
    if day == easter - timedelta(days=7):       # Цветница
        names += ["Цветан", "Цветана", "Цветелина", "Цветомир"]
    return names


def has_name_day(full_name: Optional[str], names: Iterable[str]) -> bool:
    given = first_name(full_name).lower()
    return bool(given) and any(given == name.lower() for name in names)


def birthday_today(birthday: Optional[str], day: date) -> bool:
    """A birthday kept as "MM-DD" falls on the day (29 February on the 28th in a common year)."""
    if not birthday or len(birthday) != 5:
        return False
    try:
        month, dom = int(birthday[:2]), int(birthday[3:])
    except ValueError:
        return False
    if (month, dom) == (2, 29) and not _is_leap(day.year):
        return (day.month, day.day) == (2, 28)
    return (day.month, day.day) == (month, dom)


def _is_leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def valid_birthday(value: str) -> bool:
    try:
        month, dom = int(value[:2]), int(value[3:])
    except (ValueError, IndexError):
        return False
    if len(value) != 5 or value[2] != "-":
        return False
    try:
        date(2024, month, dom)   # a leap year: 29 February is a birthday too
    except ValueError:
        return False
    return True


# ---- The line of the day without the AI: by the weather and the day.
_LINES_BG: Dict[str, Tuple[str, ...]] = {
    CLEAR: (
        "Слънчев ден – хората излизат повече. Нека и твоят ден е светъл!",
        "Ясно небе и добро настроение – подходящ ден за нещо ново.",
        "Слънцето е на твоя страна днес. Успешен ден!",
    ),
    PARTLY: (
        "Слънце между облаците – спокоен ден за подредена работа.",
        "Хубав ден е, когато всичко си е на мястото. Успех!",
        "Малко слънце, малко облаци – напълно достатъчно за добър ден.",
    ),
    CLOUDY: (
        "Облачно навън – добър ден да довършиш започнатото.",
        "Сив ден отвън, но работата върви по план. Успех!",
        "Без слънце, но с ясен план – стабилен ден.",
    ),
    FOG: (
        "Мъгливо е – по-внимателно по пътя и спокойно в работата.",
        "Мъглата се вдига, задачите остават – стъпка по стъпка.",
    ),
    RAIN: (
        "Дъждовен ден – по-спокоен ритъм, добър момент за подреждане.",
        "Вали – който влезе днес, търси уют. Нека го намери при вас.",
        "Дъждът е за растеж. Ползотворен ден!",
    ),
    SLEET: (
        "Киша навън – топлина вътре. Спокоен ден!",
        "Неприятно време – добре, че работата е на топло.",
    ),
    SNOW: (
        "Сняг – по-бавно навън, по-уютно вътре. Хубав ден!",
        "Зимен ден – топлият прием прави разликата.",
    ),
    THUNDER: (
        "Възможни гръмотевици – пазете се и не бързайте.",
        "Бурен ден навън, спокойствие вътре. Успех!",
    ),
}
_LINES_EN: Dict[str, Tuple[str, ...]] = {
    CLEAR: ("A sunny day – people get out more. Have a bright one!", "Clear skies – a good day to try something new."),
    PARTLY: ("Sun between the clouds – a calm day for steady work.", "A good day is one where everything's in its place."),
    CLOUDY: ("Cloudy outside – a good day to finish what you started.", "Grey outside, on plan inside. Good luck!"),
    FOG: ("Foggy out – take it easy on the road.",),
    RAIN: ("A rainy day – a calmer pace, a good moment to tidy up.", "Rain helps things grow. Have a fruitful day!"),
    SLEET: ("Sleet outside, warmth inside. Have a calm day!",),
    SNOW: ("Snow – slower outside, cosier inside. Have a good day!",),
    THUNDER: ("Storms possible – stay safe and don't rush.",),
}
_LINES_NO_WEATHER_BG = (
    "Нов ден, нов шанс – започни с най-важното.",
    "Малките неща, направени навреме, правят големия резултат.",
    "Подреденият ден започва с една ясна цел.",
)
_LINES_NO_WEATHER_EN = (
    "A new day, a new chance – start with what matters most.",
    "Small things done on time make the big result.",
)


def _pick(options: Tuple[str, ...], day: date, salt: str) -> str:
    digest = hashlib.sha1(f"{day.isoformat()}|{salt}".encode()).hexdigest()
    return options[int(digest[:8], 16) % len(options)]


def template_line(kind: Optional[str], day: date, salt: str, english: bool = False) -> str:
    """The line of the day from the weather - a different one each day, the
    same all day long for one business."""
    if kind:
        options = (_LINES_EN if english else _LINES_BG).get(kind)
        if options:
            return _pick(options, day, salt)
    return _pick(_LINES_NO_WEATHER_EN if english else _LINES_NO_WEATHER_BG, day, salt)


def weather_effect(days: List[Dict[str, Any]], revenue_by_day: Dict[str, float]) -> Optional[int]:
    """How the business's revenue moves on wet days (rain, sleet, snow,
    storms) against dry ones, in percent - from its own days only, each day
    against the usual of its weekday so a rainy Monday is not set against a
    Saturday. None until there are enough days of both, or when the
    difference is too small to tell."""
    by_weekday: Dict[int, List[float]] = {}
    for day_text, amount in revenue_by_day.items():
        by_weekday.setdefault(date.fromisoformat(day_text).weekday(), []).append(amount)
    usual = {weekday: statistics.median(values) for weekday, values in by_weekday.items() if values}
    wet: List[float] = []
    dry: List[float] = []
    for entry in days:
        day_text = str(entry.get("date"))
        revenue = revenue_by_day.get(day_text)
        if revenue is None:
            continue
        base = usual.get(date.fromisoformat(day_text).weekday())
        if not base:
            continue
        (wet if entry.get("kind") in WET_KINDS else dry).append(revenue / base)
    if len(wet) < EFFECT_MIN_DAYS or len(dry) < EFFECT_MIN_DAYS:
        return None
    dry_level = statistics.mean(dry)
    if dry_level <= 0:
        return None
    percent = round((statistics.mean(wet) / dry_level - 1) * 100)
    return percent if abs(percent) >= EFFECT_MIN_PERCENT else None


def season_of(day: date) -> str:
    return {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring",
            6: "summer", 7: "summer", 8: "summer"}.get(day.month, "autumn")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def today_year() -> int:
    return datetime.now(BUSINESS_TZ).year
