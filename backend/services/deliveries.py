"""When each supplier delivers, read from the dates of its invoices - an
invoice's date is the day its goods came - and when to order for a delivery.

Nothing is entered by hand and nothing is set for any one business or
supplier: every supplier of every business is read the same way, from its
own invoices.

A supplier delivers on fixed weekdays when, over the last weeks, nearly all
of its deliveries fell on a few weekdays, each of them in at least half of
those weeks (Monday, Wednesday and Friday, say). An item's order then goes
with a delivery day - the last one before the item would run out - and is
placed before that day: by default the day before (the open day before that
when the business is closed then), or as early as the business itself
orders for that weekday, learned from its "Поръчано" marks - never on the
day of the delivery itself. A supplier without fixed days keeps the item's
own rhythm (every ~N days), and its order too is placed the day before."""
from dataclasses import dataclass
from datetime import date, timedelta
from statistics import median
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple

# The weeks a supplier's days are read from, and the recent ones that show a
# change of days first.
LONG_WEEKS = 6
RECENT_WEEKS = 3
MIN_DELIVERIES = 6
MIN_RECENT_DELIVERIES = 3
MIN_OBSERVED_DAYS = 14
# A weekday is a delivery day when a delivery came on at least half of its
# weeks, and the days are fixed when nearly every delivery fell on them.
DAY_SHARE = 0.5
ON_SCHEDULE_SHARE = 0.8
# A day it came on practically every week: an invoice missing for it is
# worth a word.
STRONG_SHARE = 0.8
STRONG_MIN_CHANCES = 4
# Ordered the day before the delivery unless the business shows otherwise;
# a "lead" longer than a week is not an order and its delivery.
DEFAULT_LEAD_DAYS = 1
MAX_LEAD_DAYS = 7
MIN_LEAD_SAMPLES = 2
# The lead learned for any weekday (a supplier without fixed days).
ANY_DAY = -1
# Upcoming deliveries looked at for an item's order.
DELIVERIES_AHEAD = 12
# "Usually on Fridays": that many purchases on the weekday, the last few.
USUAL_MIN_PURCHASES = 3
USUAL_LAST = 4
USUAL_WEEKS = 10


@dataclass(frozen=True)
class Schedule:
    # 0 = Monday ... 6 = Sunday
    weekdays: Tuple[int, ...]
    # The days it came on practically every week.
    strong: Tuple[int, ...] = ()
    # The days changed in the last weeks.
    changed: bool = False


def _days(start: date, end: date) -> Iterable[date]:
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


def _pattern(days: Set[date], start: date, end: date, quiet: Set[date],
             min_deliveries: int) -> Optional[Tuple[Tuple[int, ...], Tuple[int, ...]]]:
    """(delivery weekdays, strong ones) over [start, end], or None when the
    deliveries there do not keep to fixed days. A quiet day (a public
    holiday, a day the business was closed) is no chance missed."""
    came = [0] * 7
    chances = [0] * 7
    delivered = [day for day in days if start <= day <= end]
    if len(delivered) < min_deliveries:
        return None
    for day in delivered:
        came[day.weekday()] += 1
    for day in _days(start, end):
        if day not in quiet:
            chances[day.weekday()] += 1
    weekdays = tuple(w for w in range(7) if came[w] >= 2 and chances[w] and came[w] / chances[w] >= DAY_SHARE)
    if not weekdays or sum(came[w] for w in weekdays) / len(delivered) < ON_SCHEDULE_SHARE:
        return None
    strong = tuple(w for w in weekdays if chances[w] >= STRONG_MIN_CHANCES and came[w] / chances[w] >= STRONG_SHARE)
    return weekdays, strong


def detect_schedule(days: Iterable[date], today: date, quiet: Iterable[date] = ()) -> Optional[Schedule]:
    """A supplier's fixed delivery days from the days of its invoices, read
    up to yesterday (today's delivery may still come). The last weeks have
    the last word: a day it no longer comes on is dropped, a new one added."""
    delivered = {day for day in days if day < today}
    if not delivered:
        return None
    quiet_days = set(quiet)
    first = min(delivered)
    end = today - timedelta(days=1)
    long_start = max(first, today - timedelta(days=7 * LONG_WEEKS))
    if (end - long_start).days + 1 < MIN_OBSERVED_DAYS:
        return None
    long = _pattern(delivered, long_start, end, quiet_days, MIN_DELIVERIES)
    recent_start = max(first, today - timedelta(days=7 * RECENT_WEEKS))
    recent_delivered = [day for day in delivered if day >= recent_start]
    recent = _pattern(delivered, recent_start, end, quiet_days, MIN_RECENT_DELIVERIES)
    if long:
        weekdays, strong = long
        if len(recent_delivered) < MIN_RECENT_DELIVERIES:
            return Schedule(weekdays, strong)
        came_recently = {day.weekday() for day in recent_delivered}
        chances_recently = {day.weekday() for day in _days(recent_start, end) if day not in quiet_days}
        kept = {w for w in weekdays if w in came_recently or w not in chances_recently}
        added = set(recent[0]) - set(weekdays) if recent else set()
        now_days = tuple(sorted(kept | added))
        if not now_days:
            return None
        if set(now_days) == set(weekdays):
            return Schedule(weekdays, strong)
        return Schedule(now_days, (), changed=True)
    if recent and len(recent_delivered) >= MIN_DELIVERIES:
        return Schedule(recent[0])
    return None


def next_delivery_day(schedule: Schedule, after: date) -> date:
    """The first delivery day after a day."""
    day = after + timedelta(days=1)
    while day.weekday() not in schedule.weekdays:
        day += timedelta(days=1)
    return day


def order_day(delivery: date, learned_lead: Optional[int], closed: Callable[[date], bool]) -> date:
    """The day to order for a delivery: as early as the business orders for
    it (learned), else the day before - the open day before that when the
    business is closed then. Never the day of the delivery itself."""
    if learned_lead:
        return delivery - timedelta(days=max(DEFAULT_LEAD_DAYS, learned_lead))
    day = delivery - timedelta(days=DEFAULT_LEAD_DAYS)
    for _ in range(6):
        if not closed(day):
            break
        day -= timedelta(days=1)
    return day


def orderable_deliveries(schedule: Schedule, today: date, order_day_of: Callable[[date], date],
                         count: int = DELIVERIES_AHEAD) -> List[date]:
    """The next deliveries an order can still be placed for (its order day
    is today or later), soonest first."""
    deliveries: List[date] = []
    day = today
    while len(deliveries) < count:
        day = next_delivery_day(schedule, day)
        if order_day_of(day) >= today:
            deliveries.append(day)
    return deliveries


def slot_for(expected: date, deliveries: Sequence[date], schedule: Schedule) -> date:
    """The delivery an item's order goes with: the first one after which
    the next would come too late - the item is expected to be bought again
    before it."""
    for delivery in deliveries:
        if expected < next_delivery_day(schedule, delivery):
            return delivery
    return deliveries[-1]


def coverage_days(delivery: date, gap_days: int, schedule: Schedule) -> int:
    """How many days an order for a delivery has to last: until the delivery
    the item would be ordered for next (Friday to Monday is 3 days, Monday
    to Wednesday 2)."""
    expected = delivery + timedelta(days=gap_days)
    day = delivery
    for _ in range(60):
        day = next_delivery_day(schedule, day)
        if expected < next_delivery_day(schedule, day):
            return (day - delivery).days
    return gap_days


def usual_quantity(purchases: Sequence[Tuple[date, float]], weekday: int, today: date) -> Optional[float]:
    """What is usually bought on that weekday - the last few purchases on
    it over the last weeks - or None with too few of them."""
    since = today - timedelta(weeks=USUAL_WEEKS)
    same = [quantity for day, quantity in sorted(purchases) if day >= since and day.weekday() == weekday and quantity > 0]
    if len(same) < USUAL_MIN_PURCHASES:
        return None
    return float(median(same[-USUAL_LAST:]))


def learned_leads(samples: Iterable[Tuple[date, date]]) -> Dict[int, int]:
    """How many days before a delivery the business orders for it, by the
    delivery's weekday (and ANY_DAY over all of them), from (order day,
    delivery day) pairs - the last few, at least MIN_LEAD_SAMPLES of them."""
    by_day: Dict[int, List[int]] = {}
    for ordered, delivered in sorted(samples, key=lambda pair: pair[1]):
        lead = (delivered - ordered).days
        if not 1 <= lead <= MAX_LEAD_DAYS:
            continue
        by_day.setdefault(delivered.weekday(), []).append(lead)
        by_day.setdefault(ANY_DAY, []).append(lead)
    return {
        day: max(DEFAULT_LEAD_DAYS, round(median(leads[-USUAL_LAST:])))
        for day, leads in by_day.items()
        if len(leads) >= MIN_LEAD_SAMPLES
    }
