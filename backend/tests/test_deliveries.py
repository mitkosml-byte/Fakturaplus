"""Delivery days read from the dates of a supplier's invoices, and the day
to order for a delivery (services/deliveries). Invented dates."""
from datetime import date, timedelta

from services import deliveries as dl

FRIDAY = date(2026, 11, 20)
MONDAY = date(2026, 11, 16)


def _back(today, weekdays, weeks=6, skip=()):
    """Every day of those weekdays over the last weeks, before today."""
    days = (today - timedelta(days=n) for n in range(1, 7 * weeks + 1))
    return [day for day in days if day.weekday() in weekdays and day not in skip]


def test_fixed_days_from_the_invoice_dates():
    assert dl.detect_schedule(_back(FRIDAY, {0, 2, 4}), FRIDAY) == dl.Schedule((0, 2, 4), (0, 2, 4), False)
    # Every third day falls on every weekday in turn: no fixed days.
    assert dl.detect_schedule([FRIDAY - timedelta(days=n) for n in range(3, 43, 3)], FRIDAY) is None
    # Two weeks of one day a week: too little to tell.
    assert dl.detect_schedule(_back(FRIDAY, {1}, weeks=2), FRIDAY) is None


def test_a_holiday_is_no_missed_delivery():
    holidays = {date(2026, 11, 2), date(2026, 10, 26)}
    days = _back(FRIDAY, {0, 2, 4}, skip=holidays)
    assert 0 not in dl.detect_schedule(days, FRIDAY).strong
    assert 0 in dl.detect_schedule(days, FRIDAY, holidays).strong


def test_new_days_take_over():
    # Monday, Wednesday and Friday until three weeks ago, Tuesday and Thursday since.
    old = [day for day in _back(FRIDAY, {0, 2, 4}, weeks=7) if (FRIDAY - day).days > 21]
    schedule = dl.detect_schedule(old + _back(FRIDAY, {1, 3}, weeks=3), FRIDAY)
    assert schedule.weekdays == (1, 3) and schedule.changed


def test_the_order_day():
    never = lambda day: False  # noqa: E731
    closed_sundays = lambda day: day.weekday() == 6  # noqa: E731
    monday = MONDAY + timedelta(days=7)
    # The day before; the open day before that when the business is closed then.
    assert dl.order_day(monday, None, never) == monday - timedelta(days=1)
    assert dl.order_day(monday, None, closed_sundays) == monday - timedelta(days=2)
    # As early as the business itself orders - but never the day itself.
    assert dl.order_day(monday, 3, never) == monday - timedelta(days=3)
    assert dl.order_day(monday, 0, never) == monday - timedelta(days=1)


def test_an_items_delivery_and_how_long_it_lasts():
    mwf = dl.Schedule((0, 2, 4))
    wednesday, friday = MONDAY + timedelta(days=2), MONDAY + timedelta(days=4)
    next_monday = MONDAY + timedelta(days=7)
    deliveries = dl.orderable_deliveries(mwf, wednesday, lambda day: day - timedelta(days=1))
    assert deliveries[:3] == [friday, next_monday, next_monday + timedelta(days=2)]
    # Bought with every delivery (every 2 days), last on Wednesday: Friday's
    # order, which has to last until Monday - 3 days; Monday's, 2.
    assert dl.slot_for(wednesday + timedelta(days=2), deliveries, mwf) == friday
    assert dl.coverage_days(friday, 2, mwf) == 3 and dl.coverage_days(next_monday, 2, mwf) == 2
    # Bought every Monday: Monday's order, for a week - Wednesday and Friday leave it be.
    assert dl.slot_for(MONDAY + timedelta(days=7), deliveries, mwf) == next_monday
    assert dl.coverage_days(next_monday, 7, mwf) == 7


def test_what_is_usually_taken_on_the_day():
    purchases = []
    for week in range(6):
        monday = MONDAY - timedelta(weeks=week)
        purchases += [(monday, 20.0), (monday + timedelta(days=2), 20.0), (monday + timedelta(days=4), 35.0)]
    today = FRIDAY + timedelta(days=1)
    assert dl.usual_quantity(purchases, 4, today) == 35 and dl.usual_quantity(purchases, 0, today) == 20
    # One Friday is not "usually".
    assert dl.usual_quantity(purchases[:3], 4, today) is None


def test_how_early_the_business_orders():
    # On Saturday for Monday, the day before for Wednesday.
    samples = [
        (MONDAY - timedelta(days=2), MONDAY), (MONDAY - timedelta(days=9), MONDAY - timedelta(days=7)),
        (MONDAY + timedelta(days=1), MONDAY + timedelta(days=2)), (MONDAY - timedelta(days=6), MONDAY - timedelta(days=5)),
    ]
    leads = dl.learned_leads(samples)
    assert leads[0] == 2 and leads[2] == 1
    # One order is not a habit; a week and more is no order and its delivery.
    assert dl.learned_leads(samples[:1]) == {}
    assert dl.learned_leads([(MONDAY - timedelta(days=9), MONDAY)] * 3) == {}
