"""The till's daily report from a photo (Н3): the Z report ("дневен
финансов отчет с нулиране") read by the AI - the day's turnover by VAT
group, in cash and by card - and handed to the revenue form to check and
save. Nothing is saved here: the person confirms the day, as when it is
typed. One scan, as for an invoice."""
import re

from fastapi import APIRouter
from server import *
import server
from services.document_scan import straighten_image_blocks

router = APIRouter(prefix="/api")

MAX_Z_PAGES = 3
MAX_Z_IMAGE_BASE64_CHARS = 14_000_000
# Off by more than this, the report's sums are shown as not adding up.
Z_TOLERANCE = 0.05

Z_REPORT_SYSTEM_PROMPT = """Ти разпознаваш български фискални дневни отчети (Z-отчет, "ДНЕВЕН ФИНАНСОВ ОТЧЕТ С НУЛИРАНЕ") от касов апарат.

Извлечи:
- датата на отчета (ДД-ММ-ГГГГ на бона → върни ГГГГ-ММ-ДД) и номера му, ако се виждат;
- оборота по ДДС групи: за всяка група с оборот - буквата ѝ (А, Б, В, Г, ...), ставката и оборота С ДДС. Ако ставката е отпечатана (напр. "Б 20.00%"), ползвай нея. Ако не е, стандартните групи са: А = 0%, Б = 20%, В = 20%, Г = 9%. Групи с нулев оборот пропусни;
- общия оборот за деня (ОБЩО / ОБОРОТ / СУМА) - нетно, след сторно, ако има такова;
- плащанията: в брой (В БРОЙ / ПЛАЩАНЕ В БРОЙ) и с карта (КАРТА / ДЕБИТНА / КРЕДИТНА / ПОС). Ако някое липсва на отчета, остави го празно.

Не измисляй стойности: каквото не се чете ясно, остави празно и го кажи в бележка. Сумите са в евро или лева, както са на отчета - върни числата им."""


class ZReportGroup(BaseModel):
    group: Optional[str] = Field(default=None, description="Буквата на ДДС групата (А, Б, В, Г...)")
    rate_percent: float = Field(description="ДДС ставката на групата в проценти (0, 9, 20)")
    amount: float = Field(description="Оборотът на групата с ДДС")


class ClaudeZReportExtraction(BaseModel):
    report_date: Optional[str] = Field(default=None, description="Датата на отчета, ГГГГ-ММ-ДД")
    report_number: Optional[str] = Field(default=None, description="Номерът на Z-отчета")
    total: float = Field(description="Общият оборот за деня с ДДС")
    groups: List[ZReportGroup] = Field(default_factory=list, description="Оборотът по ДДС групи")
    cash: Optional[float] = Field(default=None, description="Платено в брой")
    card: Optional[float] = Field(default=None, description="Платено с карта")
    notes: Optional[str] = Field(default=None, description="Какво не се чете ясно")


class ZReportResult(BaseModel):
    date: Optional[str] = None
    report_number: Optional[str] = None
    fiscal_revenue: float
    card_revenue: Optional[float] = None
    cash_revenue: Optional[float] = None
    vat_groups: List[VatGroupAmount] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


def read_z_report(extracted: ClaudeZReportExtraction) -> ZReportResult:
    """The report as the revenue form takes it: the day's total, the card
    part, the turnover by VAT rate (one rate - a single group - needs no
    split), and what does not add up."""
    by_rate: Dict[float, float] = {}
    for group in extracted.groups:
        if group.amount and group.amount > 0:
            rate = round(float(group.rate_percent), 2)
            by_rate[rate] = round(by_rate.get(rate, 0.0) + float(group.amount), 2)
    groups_total = round(sum(by_rate.values()), 2)
    total = round(float(extracted.total or 0), 2) or groups_total
    warnings: List[str] = []
    if by_rate and abs(groups_total - total) > Z_TOLERANCE:
        warnings.append(f"Сборът по ДДС групи ({groups_total:.2f}) не е равен на общия оборот ({total:.2f}) - проверете отчета.")
    if not by_rate and total > 0:
        # The form then keeps the rate the day already has.
        warnings.append("ДДС групите не се четат - проверете ДДС ставката на деня.")
    cash = round(float(extracted.cash), 2) if extracted.cash is not None else None
    card = round(float(extracted.card), 2) if extracted.card is not None else None
    if cash is not None and card is not None and abs(cash + card - total) > Z_TOLERANCE:
        warnings.append(f"В брой и с карта ({cash + card:.2f}) не правят общия оборот ({total:.2f}).")
    if card is None and cash is not None and cash <= total:
        card = round(total - cash, 2)
    if card is not None and card > total + Z_TOLERANCE:
        warnings.append("Платеното с карта е повече от оборота - проверете го.")
        card = None
    day = business_day(extracted.report_date) if extracted.report_date else None
    if extracted.report_date and day is None:
        warnings.append("Датата на отчета не се чете - изберете я.")
    if day and day > today_local():
        warnings.append("Датата на отчета е в бъдещето - проверете я.")
        day = None
    if extracted.notes:
        warnings.append(extracted.notes)
    # One rate: the form sets the day's rate from it; several: the day by rate.
    vat_groups = [VatGroupAmount(rate_percent=rate, amount=amount) for rate, amount in sorted(by_rate.items(), reverse=True)]
    return ZReportResult(
        date=day.isoformat() if day else None,
        report_number=(extracted.report_number or None),
        fiscal_revenue=total,
        card_revenue=card,
        cash_revenue=cash,
        vat_groups=vat_groups,
        warnings=warnings,
    )


@router.post("/daily-revenue/scan", response_model=ZReportResult)
@limiter.limit("20/minute")
async def scan_z_report(request: Request, current_user: User = Depends(get_current_user)):
    """The till's daily report from a photo - a draft for the revenue form."""
    require_permission(current_user, "add_revenue")
    if not server.AI_FEATURES_ENABLED:
        raise HTTPException(status_code=503, detail="AI разпознаването временно не е налично. Моля, въведете оборота ръчно.")
    body = await request.json()
    pages: List[str] = body.get("image_base64s") or ([body["image_base64"]] if body.get("image_base64") else [])
    if not pages:
        raise HTTPException(status_code=400, detail="Липсва изображение")
    if len(pages) > MAX_Z_PAGES:
        raise HTTPException(status_code=400, detail=f"Твърде много снимки (макс. {MAX_Z_PAGES}).")
    blocks = []
    for raw in pages:
        data, media_type = str(raw), "image/jpeg"
        if data.startswith("data:") and "," in data:
            header, data = data.split(",", 1)
            found = re.match(r"data:([^;]+);base64", header)
            if found:
                media_type = found.group(1)
        if len(data) > MAX_Z_IMAGE_BASE64_CHARS:
            raise HTTPException(status_code=413, detail="Снимката е твърде голяма (до ~10MB).")
        blocks.append({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}})

    company_id, _ = await get_company_scope(current_user)
    if SCAN_CREDITS_ENFORCED and not await scan_credit_service.has_scans_remaining(company_id, current_user.user_id):
        raise HTTPException(status_code=402, detail="Нямате оставащи сканирания. Купете пакет, за да продължите.")
    # The receipt made to look scanned before it is read (services/document_scan).
    await straighten_image_blocks(blocks)
    try:
        response = await server.anthropic_client.messages.parse(  # type: ignore[union-attr]  # guarded by AI_FEATURES_ENABLED above
            model="claude-opus-5-5",
            max_tokens=2000,
            system=Z_REPORT_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": [
                *blocks,  # type: ignore[list-item]
                {"type": "text", "text": "Извлечи данните от този дневен отчет (Z-отчет) на касовия апарат."},
            ]}],
            output_format=ClaudeZReportExtraction,
        )
        await log_ai_usage(company_id, "z_report_scan", response, {"page_count": len(blocks)})
        extracted = response.parsed_output
        if extracted is None:
            raise HTTPException(status_code=500, detail="Не можах да разчета отчета - въведете оборота ръчно")
        result = read_z_report(extracted)
        if SCAN_CREDITS_ENFORCED:
            await scan_credit_service.spend_scan(company_id, current_user.user_id, current_user.name, invoice_label="Z-отчет")
        return result
    except HTTPException:
        raise
    except (anthropic_sdk.RateLimitError, anthropic_sdk.OverloadedError):
        raise HTTPException(status_code=503, detail="AI услугата е временно претоварена. Опитайте отново след малко.")
    except anthropic_sdk.APIError:
        logger.exception("Z report scan failed")
        raise HTTPException(status_code=502, detail="Отчетът не можа да бъде разчетен - опитайте отново или го въведете ръчно.")
