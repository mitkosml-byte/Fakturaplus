"""Module 1 audit finding - extracted from the former monolithic server.py.
Shares server.py's db/models/helpers/services via `from server import *`;
`db` and `AI_FEATURES_ENABLED` are the two globals tests/startup reassign
after module load, so this file always accesses them as `server.db` /
`server.AI_FEATURES_ENABLED` (qualified), never via the star-import, to
stay correct when server.py's test fixture monkeypatches them."""
from fastapi import APIRouter
from server import *
from server import (
    _eik_check_digit,
    _compare_key,
    _similarity,
    _scan_packages_catalogue,
    _require_billing_enabled,
    _month_bounds,
    _compute_month_profit,
    _business_digest_period,
    _business_digest_top_expenses,
    _signal_unpaid_invoices,
    _signal_receivables,
    _signal_scan_credits,
    _signal_budget,
    _signal_price_alerts,
    _signal_reorder,
    _signal_forecast,
    _orthodox_easter,
    _holiday_name_for_date,
    _get_employee_for_company,
    _ym_add,
    _ym_diff,
    _team_channel_id,
)
import server

# Cross-domain reuse: export_statistics_pdf below calls these other
# domains' route handlers directly as internal helpers (the same
# already-existing reuse pattern as /import/{entity}/commit), rather than
# re-deriving the same aggregates a second way.
from routers.statistics import get_summary, get_supplier_statistics
from routers.price_tracking import get_item_statistics

router = APIRouter(prefix="/api")

@router.get("/export/statistics/pdf")
@limiter.limit("20/minute")
async def export_statistics_pdf(
    request: Request,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Export a one-page financial report (summary + top suppliers/items) as PDF"""
    require_permission(current_user, "export_data")
    # One period for every part of the sheet - the one chosen on screen, or
    # this month - and it is printed on it. Before, the summary was this
    # month, the top lists were for all time, and nothing said which.
    try:
        period = Period.parse(start_date, end_date) if (start_date or end_date) else Period.current_month()
    except ValueError:
        raise HTTPException(status_code=400, detail="Невалиден период")
    start_text, end_text = period.start_text, period.end_text
    stats = await get_summary(start_date=start_text, end_date=end_text, current_user=current_user)
    suppliers_data = await get_supplier_statistics(start_date=start_text, end_date=end_text, current_user=current_user)
    items_data = await get_item_statistics(start_date=start_text, end_date=end_text, top_n=10, current_user=current_user)

    company_id, _ = await get_company_scope(current_user)
    company_name = ""
    if company_id:
        company = await server.db.companies.find_one({"id": company_id})
        company_name = company.get("name", "") if company else ""

    counted = counted_period(period)
    period_label = f"Период: {period.start:%d.%m.%Y} – {period.end:%d.%m.%Y}"
    if counted.end < period.end:
        period_label += f" (до {counted.end:%d.%m.%Y} включително)"

    try:
        pdf_data = await asyncio.to_thread(
            ExportService.generate_statistics_pdf,
            stats=stats,
            top_suppliers=suppliers_data.get("top_by_amount", []),
            top_items=items_data.get("top_by_value", []),
            company_name=company_name,
            period_label=period_label
        )

        await audit_service.log_action(
            user_id=current_user.user_id,
            user_name=current_user.name,
            action="export",
            entity_type="statistics",
            company_id=company_id,
            details={"format": "pdf"}
        )

        filename = f"statistics_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
        return Response(
            content=pdf_data,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except ImportError:
        raise HTTPException(status_code=500, detail="PDF export not available")

@router.get("/export/vat-ledger/excel")
@limiter.limit("20/minute")
async def export_vat_ledger_excel(
    request: Request,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Export a working ДДС purchases/sales ledger (Дневник на покупки и
    продажби) for the given period, grouped by VAT-rate category - meant
    as the accountant's source data for filing, not a byte-exact copy of
    NRA's own file layout."""
    require_permission(current_user, "export_data")
    # end_date must be the LAST day of the month, not the 1st of the next
    # one - both queries below treat it as an inclusive boundary (through
    # 23:59:59 / plain $lte), so a tax ledger meant for "this month" would
    # otherwise also pull in the 1st of next month's purchases and sales,
    # double-counting that day across two consecutive VAT filings.
    if not start_date and not end_date:
        current_month = Period.current_month()
        start_date, end_date = current_month.start_text, current_month.end_text
    elif not start_date or not end_date:
        raise HTTPException(status_code=400, detail="Трябва да зададете и start_date, и end_date (или нито едно от двете за текущия месец)")

    company_id, scope = await get_company_scope(current_user)

    # The period's business days - the same invoices Home and every other
    # module count for it (services/business_calendar), all of them.
    try:
        period = Period.parse(start_date, end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Невалиден период")
    inv_query = dict(scope)
    inv_query["date"] = period.datetime_filter()
    purchases = await server.db.invoices.find(inv_query, {"_id": 0, "image_base64": 0, "image_base64s": 0}).sort("date", 1).to_list(ALL_ROWS)

    rev_query = dict(scope)
    rev_query["date"] = period.text_filter()
    sales = await server.db.daily_revenue.find(rev_query, {"_id": 0}).sort("date", 1).to_list(ALL_ROWS)

    # Same redaction get_summary/get_chart_data apply to pocket_money - a
    # raw export must never show a viewer a field the aggregated views
    # already hide from them (e.g. an accountant with export_data but
    # without view_pocket_money).
    if not get_financial_visibility(current_user)["pocket_money"]:
        for rev in sales:
            rev["pocket_money"] = 0

    company_name = ""
    if company_id:
        company = await server.db.companies.find_one({"id": company_id})
        company_name = company.get("name", "") if company else ""

    period_label = f"Период: {start_date} - {end_date}"

    try:
        excel_data = await asyncio.to_thread(
            ExportService.generate_vat_ledger_excel,
            purchases=purchases,
            sales=sales,
            company_name=company_name,
            period_label=period_label
        )

        await audit_service.log_action(
            user_id=current_user.user_id,
            user_name=current_user.name,
            action="export",
            entity_type="vat_ledger",
            company_id=company_id,
            details={"format": "excel", "start_date": start_date, "end_date": end_date}
        )

        filename = f"dnevnik_pokupki_prodajbi_{start_date}_{end_date}.xlsx"
        return Response(
            content=excel_data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except ImportError:
        raise HTTPException(status_code=500, detail="Excel export not available")

@router.get("/export/employee-compliance/excel")
@limiter.limit("20/minute")
async def export_employee_compliance_excel(
    request: Request,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Export the list of employees who worked on an official holiday
    (Чл. 262 КТ extra-pay entitlement) and employee leave for a period, so
    the accountant can attach it to the required company/personnel documents."""
    require_permission(current_user, "export_data")
    if not start_date and not end_date:
        today = today_local()
        start_date = today.replace(month=1, day=1).isoformat()
        end_date = today.isoformat()

    company_id, scope = await get_company_scope(current_user)

    hw_query = dict(scope)
    hw_query["date"] = {"$gte": start_date, "$lte": end_date}
    holiday_work = await server.db.employee_holiday_work.find(hw_query, {"_id": 0}).sort("date", 1).to_list(10000)

    leave_query = dict(scope)
    leave_query["end_date"] = {"$gte": start_date}
    leave_query["start_date"] = {"$lte": end_date}
    leave = await server.db.employee_leave.find(leave_query, {"_id": 0}).sort("start_date", 1).to_list(10000)

    company_name = ""
    if company_id:
        company = await server.db.companies.find_one({"id": company_id})
        company_name = company.get("name", "") if company else ""

    period_label = f"Период: {start_date} - {end_date}"

    try:
        excel_data = await asyncio.to_thread(
            ExportService.generate_employee_compliance_excel,
            holiday_work=holiday_work,
            leave=leave,
            company_name=company_name,
            period_label=period_label
        )

        await audit_service.log_action(
            user_id=current_user.user_id,
            user_name=current_user.name,
            action="export",
            entity_type="employee_compliance",
            company_id=company_id,
            details={"format": "excel", "start_date": start_date, "end_date": end_date}
        )

        filename = f"praznici_otpuski_{start_date}_{end_date}.xlsx"
        return Response(
            content=excel_data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except ImportError:
        raise HTTPException(status_code=500, detail="Excel export not available")

@router.get("/export/invoices/excel")
@limiter.limit("20/minute")
async def export_invoices_excel(
    request: Request,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Export invoices to Excel"""
    require_permission(current_user, "export_data")
    company_id, query = await get_company_scope(current_user)

    if start_date or end_date:
        try:
            query["date"] = Period.parse(start_date, end_date).datetime_filter()
        except ValueError:
            raise HTTPException(status_code=400, detail="Невалиден период")
    
    invoices = await server.db.invoices.find(query, {"_id": 0, "image_base64": 0, "image_base64s": 0}).sort("date", -1).to_list(ALL_ROWS)
    
    # Get company name
    company_name = ""
    if company_id:
        company = await server.db.companies.find_one({"id": company_id})
        company_name = company.get("name", "") if company else ""
    
    try:
        excel_data = await asyncio.to_thread(ExportService.generate_invoices_excel, invoices, company_name)
        
        # Log export
        await audit_service.log_action(
            user_id=current_user.user_id,
            user_name=current_user.name,
            action="export",
            entity_type="invoices",
            company_id=company_id,
            details={"format": "excel", "count": len(invoices)}
        )
        
        filename = f"invoices_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
        return Response(
            content=excel_data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except ImportError:
        raise HTTPException(status_code=500, detail="Excel export not available")

@router.get("/export/invoices/pdf")
@limiter.limit("20/minute")
async def export_invoices_pdf(
    request: Request,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Export invoices to PDF"""
    require_permission(current_user, "export_data")
    company_id, query = await get_company_scope(current_user)

    if start_date or end_date:
        try:
            query["date"] = Period.parse(start_date, end_date).datetime_filter()
        except ValueError:
            raise HTTPException(status_code=400, detail="Невалиден период")
    
    invoices = await server.db.invoices.find(query, {"_id": 0, "image_base64": 0, "image_base64s": 0}).sort("date", -1).to_list(ALL_ROWS)
    
    company_name = ""
    if company_id:
        company = await server.db.companies.find_one({"id": company_id})
        company_name = company.get("name", "") if company else ""
    
    try:
        pdf_data = await asyncio.to_thread(ExportService.generate_invoices_pdf, invoices, company_name)
        
        await audit_service.log_action(
            user_id=current_user.user_id,
            user_name=current_user.name,
            action="export",
            entity_type="invoices",
            company_id=company_id,
            details={"format": "pdf", "count": len(invoices)}
        )
        
        filename = f"invoices_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
        return Response(
            content=pdf_data,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except ImportError:
        raise HTTPException(status_code=500, detail="PDF export not available")
