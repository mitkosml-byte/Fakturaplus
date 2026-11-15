"""The one calendar every module counts by.

A business day is a calendar day on the business's own clock (Bulgaria by
default) - from 00:00 to 23:59 local time, never the server's UTC clock and
never the moment a record happened to be typed in. Daily revenue and
off-book expenses already keep their day as "YYYY-MM-DD" text. An invoice's
date is a datetime field, so it is kept at 00:00 UTC of its business day
(day_start_utc): one canonical value per day, which every range below
selects the same way whichever module asks.

A period is a run of whole business days with both ends included: a day, a
week (Monday to Sunday), a month (the 1st to its last day), a year or a
chosen range. Every module turns its dates into a Period here and reads its
records through the period's filters, so the same period means the same
days - and the same records - everywhere."""
import calendar
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterator, Optional, Tuple
from zoneinfo import ZoneInfo

BUSINESS_TZ = ZoneInfo(os.environ.get("BUSINESS_TIMEZONE") or "Europe/Sofia")

# Open ends of a range given with only one bound. The far end stays a day
# short of date.max so "the day after" still exists.
OPEN_START = date(2000, 1, 1)
OPEN_END = date(9999, 12, 30)


def now_local() -> datetime:
    return datetime.now(BUSINESS_TZ)


def today_local() -> date:
    return now_local().date()


def business_day(value: Any) -> Optional[date]:
    """The business day a stored or submitted date stands for.

    "YYYY-MM-DD" text is that day as written. A moment - a datetime, or
    ISO text with a time - is read on the business's clock, which is what
    the person saw when they picked it: a date picked on the web arrives as
    local midnight in UTC (the evening before), one picked on a phone
    carries the time of day it was picked at. A datetime without a zone is
    UTC, which is how MongoDB hands stored datetimes back. None and "" are
    no day."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return moment.astimezone(BUSINESS_TZ).date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if len(text) == 10:
        return date.fromisoformat(text)
    return business_day(datetime.fromisoformat(text.replace("Z", "+00:00")))


def day_start_utc(day: date) -> datetime:
    """How a business day is kept in a datetime field: 00:00 UTC of it."""
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc)


def stored_day(value: Any) -> Optional[datetime]:
    """A submitted or stored date, as its business day is kept in a
    datetime field (day_start_utc) - None for no date."""
    day = business_day(value)
    return day_start_utc(day) if day else None


def is_stored_day(value: Any) -> bool:
    """True when a datetime field already holds day_start_utc of the day
    it stands for - 00:00:00 UTC exactly, of the same business day."""
    if not isinstance(value, datetime):
        return False
    moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    moment = moment.astimezone(timezone.utc)
    return (moment.hour, moment.minute, moment.second, moment.microsecond) == (0, 0, 0, 0) \
        and business_day(moment) == moment.date()


def days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def month_key(day: date) -> str:
    return f"{day.year}-{day.month:02d}"


def add_months(year: int, month: int, delta: int) -> Tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


@dataclass(frozen=True)
class Period:
    """Whole business days from start to end, both included."""
    start: date
    end: date

    def __post_init__(self) -> None:
        if self.end < self.start:
            raise ValueError("Крайната дата е преди началната")

    @classmethod
    def day(cls, day: date) -> "Period":
        return cls(day, day)

    @classmethod
    def week_of(cls, day: date) -> "Period":
        start = day - timedelta(days=day.weekday())
        return cls(start, start + timedelta(days=6))

    @classmethod
    def month(cls, year: int, month: int) -> "Period":
        return cls(date(year, month, 1), date(year, month, days_in_month(year, month)))

    @classmethod
    def month_of(cls, day: date) -> "Period":
        return cls.month(day.year, day.month)

    @classmethod
    def year(cls, year: int) -> "Period":
        return cls(date(year, 1, 1), date(year, 12, 31))

    @classmethod
    def current_month(cls) -> "Period":
        return cls.month_of(today_local())

    @classmethod
    def parse(cls, start: Any = None, end: Any = None, default: Optional["Period"] = None) -> "Period":
        """A period from whatever a caller sent: "YYYY-MM-DD", an ISO
        moment (read as its business day) or nothing. Nothing at all is
        `default`, or the current month; one missing end is open."""
        first = business_day(start)
        last = business_day(end)
        if first is None and last is None:
            return default or cls.current_month()
        return cls(first or OPEN_START, last or OPEN_END)

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    @property
    def start_text(self) -> str:
        return self.start.isoformat()

    @property
    def end_text(self) -> str:
        return self.end.isoformat()

    def text_filter(self) -> Dict[str, str]:
        """For a "YYYY-MM-DD" text field (revenue, expenses...)."""
        return {"$gte": self.start_text, "$lte": self.end_text}

    def datetime_filter(self) -> Dict[str, datetime]:
        """For a datetime field kept as day_start_utc (invoice dates...):
        from 00:00 UTC of the first day up to, not including, 00:00 UTC of
        the day after the last."""
        return {"$gte": day_start_utc(self.start), "$lt": day_start_utc(self.end + timedelta(days=1))}

    def contains(self, day: Optional[date]) -> bool:
        return day is not None and self.start <= day <= self.end

    def overlap_days(self, other: "Period") -> int:
        first, last = max(self.start, other.start), min(self.end, other.end)
        return (last - first).days + 1 if first <= last else 0

    def month_share(self, year: int, month: int) -> float:
        """How much of the month (year, month) lies in this period, by
        days: 1 for the whole month, 15/30 for half of November, 0 for
        none. Monthly costs - payroll, depreciation - count this share of
        their amount in any period."""
        whole = Period.month(year, month)
        return self.overlap_days(whole) / whole.days

    def months(self) -> Iterator[Tuple[int, int]]:
        """(year, month) of every month the period touches, in order."""
        year, month = self.start.year, self.start.month
        while (year, month) <= (self.end.year, self.end.month):
            yield year, month
            year, month = add_months(year, month, 1)

    def iter_days(self) -> Iterator[date]:
        day = self.start
        while day <= self.end:
            yield day
            day += timedelta(days=1)

    def through(self, last: date) -> Optional["Period"]:
        """The part of the period up to and including `last` - None when
        the period starts after it."""
        if last < self.start:
            return None
        return Period(self.start, min(self.end, last))
