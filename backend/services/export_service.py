"""Export service for generating Excel and PDF reports"""
import io
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
import json
from xml.sax.saxutils import escape as _xml_escape

from services.revenue_vat import vat_parts
from services.money_text import fmt_amount, fmt_eur

try:
    import openpyxl
    from openpyxl.styles import Font, Alignment, Border, Side, PatternFill
    from openpyxl.utils import get_column_letter
    EXCEL_AVAILABLE = True
except ImportError:
    EXCEL_AVAILABLE = False

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    PDF_AVAILABLE = True

    # The built-in PDF fonts (Helvetica etc.) have no Cyrillic glyphs, so
    # Bulgarian text would render as boxes - register a bundled font that does.
    _FONTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "fonts")
    PDF_FONT = "Helvetica"
    PDF_FONT_BOLD = "Helvetica-Bold"
    try:
        pdfmetrics.registerFont(TTFont("DejaVuSans", os.path.join(_FONTS_DIR, "DejaVuSans.ttf")))
        pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", os.path.join(_FONTS_DIR, "DejaVuSans-Bold.ttf")))
        PDF_FONT = "DejaVuSans"
        PDF_FONT_BOLD = "DejaVuSans-Bold"
    except Exception:
        pass  # fall back to Helvetica (Cyrillic text will render as boxes)
except ImportError:
    PDF_AVAILABLE = False


# Excel/CSV formula injection (CWE-1236): a cell value starting with one of
# these characters is interpreted by Excel as a formula when the file is
# opened, which can trigger a legacy DDE command or exfiltrate data via
# =HYPERLINK(...). A leading apostrophe forces Excel to treat the cell as
# literal text instead. Applied to every free-text value that originates
# from user input (supplier names, notes, employee names, etc.) before it
# is written to a cell.
_FORMULA_TRIGGER_CHARS = ('=', '+', '-', '@', '\t', '\r')


def _document_number(inv: dict) -> str:
    """The document's number as a list shows it - a credit note marked as
    one, so its minus amounts read as what they are."""
    number = str(inv.get("invoice_number", "") or "")
    return f"КИ {number}" if inv.get("document_type") == "credit_note" else number


def _money_or_hidden(value: Any) -> str:
    """An amount as the report prints it, or "скрито" where the reader's
    access hides it (None) - never a crash on a hidden field."""
    return "скрито" if value is None else f"{fmt_eur(float(value))}"


def _excel_safe(value):
    if isinstance(value, str) and value.startswith(_FORMULA_TRIGGER_CHARS):
        return "'" + value
    return value


class ExportService:
    @staticmethod
    def generate_invoices_excel(invoices: List[dict], company_name: str = "") -> bytes:
        """Generate Excel file from invoices"""
        if not EXCEL_AVAILABLE:
            raise ImportError("openpyxl is not installed")
        
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Фактури"
        
        # Header style
        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="8B5CF6", end_color="8B5CF6", fill_type="solid")
        header_alignment = Alignment(horizontal="center", vertical="center")
        thin_border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        
        # Title
        ws.merge_cells('A1:G1')
        ws['A1'] = f"Справка за фактури - {company_name}" if company_name else "Справка за фактури"
        ws['A1'].font = Font(bold=True, size=14)
        ws['A1'].alignment = Alignment(horizontal="center")
        
        ws.merge_cells('A2:G2')
        ws['A2'] = f"Генерирано на: {datetime.now().strftime('%d.%m.%Y %H:%M')}"
        ws['A2'].alignment = Alignment(horizontal="center")
        
        # Headers
        headers = ["Дата", "Доставчик", "№ Фактура", "Сума без ДДС", "ДДС", "Обща сума", "Бележки"]
        for col, header in enumerate(headers, 1):
            cell = ws.cell(row=4, column=col, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_alignment
            cell.border = thin_border
        
        # Data
        total_without_vat = 0.0
        total_vat = 0.0
        total_amount = 0.0
        
        for row, inv in enumerate(invoices, 5):
            date_val = inv.get('date', '')
            if isinstance(date_val, datetime):
                date_str = date_val.strftime('%d.%m.%Y')
            else:
                date_str = str(date_val)[:10] if date_val else ''
            
            amount_without_vat = float(inv.get('amount_without_vat', 0))
            vat_amount = float(inv.get('vat_amount', 0))
            total = float(inv.get('total_amount', 0))
            
            total_without_vat += amount_without_vat
            total_vat += vat_amount
            total_amount += total
            
            data = [
                date_str,
                _excel_safe(inv.get('supplier', '')),
                _excel_safe(_document_number(inv)),
                amount_without_vat,
                vat_amount,
                total,
                _excel_safe(inv.get('notes', '') or '')
            ]
            
            for col, value in enumerate(data, 1):
                cell = ws.cell(row=row, column=col, value=value)
                cell.border = thin_border
                if col >= 4 and col <= 6:
                    cell.number_format = '#,##0.00 €'
                    cell.alignment = Alignment(horizontal="right")
        
        # Totals row
        total_row = len(invoices) + 5
        ws.cell(row=total_row, column=3, value="ОБЩО:").font = Font(bold=True)
        ws.cell(row=total_row, column=4, value=total_without_vat).font = Font(bold=True)
        ws.cell(row=total_row, column=4).number_format = '#,##0.00 €'
        ws.cell(row=total_row, column=5, value=total_vat).font = Font(bold=True)
        ws.cell(row=total_row, column=5).number_format = '#,##0.00 €'
        ws.cell(row=total_row, column=6, value=total_amount).font = Font(bold=True)
        ws.cell(row=total_row, column=6).number_format = '#,##0.00 €'
        
        # Column widths
        column_widths = [12, 30, 15, 15, 12, 15, 25]
        for col, width in enumerate(column_widths, 1):
            ws.column_dimensions[get_column_letter(col)].width = width
        
        # Save to bytes
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output.getvalue()

    @staticmethod
    def generate_scan_credits_excel(transactions: List[dict], company_name: str = "") -> bytes:
        """Generate Excel file from a scan-credit transaction history."""
        if not EXCEL_AVAILABLE:
            raise ImportError("openpyxl is not installed")

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Сканирания"

        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="8B5CF6", end_color="8B5CF6", fill_type="solid")
        header_alignment = Alignment(horizontal="center", vertical="center")
        thin_border = Border(
            left=Side(style='thin'), right=Side(style='thin'),
            top=Side(style='thin'), bottom=Side(style='thin')
        )

        ws.merge_cells('A1:E1')
        ws['A1'] = f"История на сканиранията - {company_name}" if company_name else "История на сканиранията"
        ws['A1'].font = Font(bold=True, size=14)
        ws['A1'].alignment = Alignment(horizontal="center")

        ws.merge_cells('A2:E2')
        ws['A2'] = f"Генерирано на: {datetime.now().strftime('%d.%m.%Y %H:%M')}"
        ws['A2'].alignment = Alignment(horizontal="center")

        headers = ["Дата", "Описание", "Тип", "Брой", "Платена сума"]
        for col, header in enumerate(headers, 1):
            cell = ws.cell(row=4, column=col, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_alignment
            cell.border = thin_border

        type_labels = {"scan_used": "Сканиране", "purchase": "Покупка"}

        for row, tx in enumerate(transactions, 5):
            created_at = tx.get('created_at', '')
            date_str = created_at.strftime('%d.%m.%Y %H:%M') if isinstance(created_at, datetime) else str(created_at)[:16]
            price_eur = tx.get('price_eur')

            data = [
                date_str,
                _excel_safe(tx.get('description', '')),
                type_labels.get(tx.get('type', ''), tx.get('type', '')),
                tx.get('delta', 0),
                f"{fmt_eur(price_eur)}" if price_eur is not None else '',
            ]

            for col, value in enumerate(data, 1):
                cell = ws.cell(row=row, column=col, value=value)
                cell.border = thin_border
                if col == 4:
                    cell.alignment = Alignment(horizontal="right")

        column_widths = [18, 36, 14, 10, 16]
        for col, width in enumerate(column_widths, 1):
            ws.column_dimensions[get_column_letter(col)].width = width

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output.getvalue()

    @staticmethod
    def generate_invoices_pdf(invoices: List[dict], company_name: str = "") -> bytes:
        """Generate PDF file from invoices"""
        if not PDF_AVAILABLE:
            raise ImportError("reportlab is not installed")
        
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=20*mm, bottomMargin=20*mm)
        
        elements = []
        styles = getSampleStyleSheet()
        
        # Title
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontName=PDF_FONT_BOLD,
            fontSize=16,
            spaceAfter=10,
            alignment=1  # Center
        )
        normal_style = ParagraphStyle('CustomNormal', parent=styles['Normal'], fontName=PDF_FONT)
        title = f"Справка за фактури - {company_name}" if company_name else "Справка за фактури"
        elements.append(Paragraph(title, title_style))
        elements.append(Paragraph(f"Генерирано: {datetime.now().strftime('%d.%m.%Y %H:%M')}", normal_style))
        elements.append(Spacer(1, 10*mm))
        
        # Table data
        data = [["Дата", "Доставчик", "No Фактура", "Без ДДС", "ДДС", "Общо"]]
        
        total_without_vat = 0.0
        total_vat = 0.0
        total_amount = 0.0
        
        for inv in invoices:
            date_val = inv.get('date', '')
            if isinstance(date_val, datetime):
                date_str = date_val.strftime('%d.%m.%Y')
            else:
                date_str = str(date_val)[:10] if date_val else ''
            
            amount_without_vat = float(inv.get('amount_without_vat', 0))
            vat_amount = float(inv.get('vat_amount', 0))
            total = float(inv.get('total_amount', 0))
            
            total_without_vat += amount_without_vat
            total_vat += vat_amount
            total_amount += total
            
            supplier = inv.get('supplier', '')[:20]  # Truncate long names
            
            data.append([
                date_str,
                supplier,
                _document_number(inv),
                f"{amount_without_vat:.2f}",
                f"{vat_amount:.2f}",
                f"{total:.2f}"
            ])
        
        # Totals
        data.append(["", "", "ОБЩО:", f"{total_without_vat:.2f}", f"{total_vat:.2f}", f"{total_amount:.2f}"])
        
        # Create table
        table = Table(data, colWidths=[55, 100, 70, 55, 45, 55])
        table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), PDF_FONT),
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#8B5CF6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), PDF_FONT_BOLD),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -2), colors.HexColor('#F8FAFC')),
            ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#E2E8F0')),
            ('FONTNAME', (0, -1), (-1, -1), PDF_FONT_BOLD),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#CBD5E1')),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
            ('ALIGN', (3, 1), (-1, -1), 'RIGHT'),
        ]))
        
        elements.append(table)
        
        doc.build(elements)
        buffer.seek(0)
        return buffer.getvalue()
    
    @staticmethod
    def generate_billing_document_pdf(document: dict, company_name: str = "") -> bytes:
        """Generate a non-fiscal "bill"/quote PDF - Module 7 audit
        decision: a simple document a craftsman or service business can
        hand a customer for a job, explicitly NOT a sequentially-numbered
        VAT invoice (no fiscal metadata, no NAP-declaration implications -
        see the Master Direction boundary this was built against). The
        disclaimer line is deliberate and must stay, so this is never
        mistaken for a real tax invoice."""
        if not PDF_AVAILABLE:
            raise ImportError("reportlab is not installed")

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=20 * mm, bottomMargin=20 * mm)

        elements = []
        styles = getSampleStyleSheet()

        title_style = ParagraphStyle(
            'CustomTitle', parent=styles['Heading1'], fontName=PDF_FONT_BOLD, fontSize=18, spaceAfter=6, alignment=1,
        )
        subtitle_style = ParagraphStyle(
            'CustomSubtitle', parent=styles['Normal'], fontName=PDF_FONT, fontSize=9,
            textColor=colors.HexColor('#64748B'), alignment=1, spaceAfter=10,
        )
        normal_style = ParagraphStyle('CustomNormal', parent=styles['Normal'], fontName=PDF_FONT, fontSize=10, spaceAfter=4)
        bold_style = ParagraphStyle('CustomBold', parent=styles['Normal'], fontName=PDF_FONT_BOLD, fontSize=10, spaceAfter=4)

        doc_type = document.get('doc_type', 'bill')
        doc_label = "ОФЕРТА" if doc_type == "quote" else "СМЕТКА ЗА ДЪЛЖИМА СУМА"
        title = f"{doc_label} - {company_name}" if company_name else doc_label
        elements.append(Paragraph(title, title_style))
        elements.append(Paragraph(
            "Този документ е неформален и не представлява данъчна фактура по смисъла на ЗДДС.",
            subtitle_style,
        ))

        issue_date = document.get('issue_date', '')
        elements.append(Paragraph(f"<b>Клиент:</b> {_xml_escape(str(document.get('customer_name', '')))}", bold_style))
        elements.append(Paragraph(f"<b>Дата:</b> {issue_date}", normal_style))
        if doc_type == "quote" and document.get("valid_until"):
            elements.append(Paragraph(f"<b>Валидна до:</b> {_xml_escape(str(document['valid_until']))}", normal_style))
        elements.append(Spacer(1, 6 * mm))

        data = [["Артикул/услуга", "Кол-во", "Ед.", "Ед. цена", "Общо"]]
        total_amount = 0.0
        for item in document.get('items', []):
            quantity = float(item.get('quantity', 1))
            unit_price = float(item.get('unit_price', 0))
            line_total = quantity * unit_price
            total_amount += line_total
            data.append([
                str(item.get('name', ''))[:40],
                f"{quantity:g}",
                str(item.get('unit', 'бр.')),
                f"{unit_price:.2f}",
                f"{line_total:.2f}",
            ])
        data.append(["", "", "", "ОБЩО:", f"{fmt_eur(total_amount)}"])

        table = Table(data, colWidths=[180, 45, 35, 60, 60])
        table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), PDF_FONT),
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#8B5CF6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('FONTNAME', (0, 0), (-1, 0), PDF_FONT_BOLD),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
            ('BACKGROUND', (0, 1), (-1, -2), colors.HexColor('#F8FAFC')),
            ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#E2E8F0')),
            ('FONTNAME', (0, -1), (-1, -1), PDF_FONT_BOLD),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#CBD5E1')),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
            ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
            ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ]))
        elements.append(table)

        if document.get('notes'):
            elements.append(Spacer(1, 6 * mm))
            elements.append(Paragraph(f"<b>Бележки:</b> {_xml_escape(str(document['notes']))}", normal_style))

        doc.build(elements)
        buffer.seek(0)
        return buffer.getvalue()

    @staticmethod
    def generate_issued_invoice_pdf(document: dict, company: dict) -> bytes:
        """An invoice issued to a customer, laid out as a Bulgarian invoice
        is: number and date (the date of the tax event), the supplier - the
        company, from its profile - and the recipient, the lines, the base
        and the VAT of each rate, the amount due, how and by when it is paid.
        A cancelled invoice says so across its title."""
        if not PDF_AVAILABLE:
            raise ImportError("reportlab is not installed")

        def text(value: Any) -> str:
            return _xml_escape(str(value or ""))

        def day_text(value: Any) -> str:
            try:
                return datetime.strptime(str(value)[:10], "%Y-%m-%d").strftime("%d.%m.%Y")
            except ValueError:
                return text(value)

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=16 * mm, bottomMargin=16 * mm)
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle('InvTitle', parent=styles['Heading1'], fontName=PDF_FONT_BOLD, fontSize=20, alignment=1, spaceAfter=2)
        center_style = ParagraphStyle('InvCenter', parent=styles['Normal'], fontName=PDF_FONT, fontSize=10, alignment=1, spaceAfter=2)
        warn_style = ParagraphStyle('InvWarn', parent=styles['Normal'], fontName=PDF_FONT_BOLD, fontSize=12, alignment=1,
                                    textColor=colors.HexColor('#DC2626'), spaceAfter=4)
        cell_style = ParagraphStyle('InvCell', parent=styles['Normal'], fontName=PDF_FONT, fontSize=9, leading=12)
        normal_style = ParagraphStyle('InvNormal', parent=styles['Normal'], fontName=PDF_FONT, fontSize=10, spaceAfter=3)

        credit_note = document.get("doc_type") == "credit_note"
        elements: List[Any] = [
            Paragraph("КРЕДИТНО ИЗВЕСТИЕ" if credit_note else "ФАКТУРА", title_style),
            Paragraph(f"№ {text(document.get('invoice_number'))} / {day_text(document.get('issue_date'))}", center_style),
        ]
        if credit_note:
            # The invoice it changes, as the law asks a credit note to name it.
            elements.append(Paragraph(
                f"към фактура № {text(document.get('credited_invoice_number'))} / {day_text(document.get('credited_issue_date'))}",
                center_style,
            ))
        elements.append(Paragraph("ОРИГИНАЛ", center_style))
        if document.get("cancelled"):
            elements.append(Paragraph("АНУЛИРАНО" if credit_note else "АНУЛИРАНА", warn_style))
        elements.append(Spacer(1, 5 * mm))

        city_address = ", ".join(part for part in (company.get("city"), company.get("address")) if part)
        supplier_lines = [
            f"<b>Доставчик</b>", f"<b>{text(company.get('name'))}</b>",
            f"ЕИК: {text(company.get('eik'))}",
        ]
        if company.get("vat_number"):
            supplier_lines.append(f"ДДС №: {text(company.get('vat_number'))}")
        if city_address:
            supplier_lines.append(f"Адрес: {text(city_address)}")
        if company.get("mol"):
            supplier_lines.append(f"МОЛ: {text(company.get('mol'))}")
        recipient_lines = [f"<b>Получател</b>", f"<b>{text(document.get('customer_name'))}</b>"]
        if document.get("customer_eik"):
            recipient_lines.append(f"ЕИК: {text(document.get('customer_eik'))}")
        if document.get("customer_address"):
            recipient_lines.append(f"Адрес: {text(document.get('customer_address'))}")
        parties = Table(
            [[Paragraph("<br/>".join(supplier_lines), cell_style), Paragraph("<br/>".join(recipient_lines), cell_style)]],
            colWidths=[90 * mm, 90 * mm],
        )
        parties.setStyle(TableStyle([
            ('BOX', (0, 0), (0, 0), 0.8, colors.HexColor('#CBD5E1')),
            ('BOX', (1, 0), (1, 0), 0.8, colors.HexColor('#CBD5E1')),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 6), ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        elements += [parties, Spacer(1, 5 * mm)]

        data: List[List[Any]] = [["№", "Артикул/услуга", "Кол-во", "Мярка", "Ед. цена", "ДДС", "Стойност"]]
        for index, item in enumerate(document.get("items") or [], 1):
            quantity = float(item.get("quantity", 1))
            unit_price = float(item.get("unit_price", 0))
            data.append([
                str(index), Paragraph(text(item.get("name")), cell_style), f"{quantity:g}", text(item.get("unit", "бр.")),
                f"{unit_price:.2f}", f"{float(item.get('vat_rate', 20)):g}%", f"{quantity * unit_price:.2f}",
            ])
        lines = Table(data, colWidths=[9 * mm, 71 * mm, 18 * mm, 16 * mm, 22 * mm, 14 * mm, 25 * mm], repeatRows=1)
        lines.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), PDF_FONT),
            ('FONTNAME', (0, 0), (-1, 0), PDF_FONT_BOLD),
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#8B5CF6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
            ('ALIGN', (2, 1), (-1, -1), 'RIGHT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        elements += [lines, Spacer(1, 4 * mm)]

        # A credit note's amounts are kept below zero; the document states
        # them as the amounts it credits.
        totals: List[List[str]] = []
        for row in document.get("vat_by_rate") or []:
            rate = f"{float(row.get('rate', 0)):g}%"
            totals.append([f"Данъчна основа {rate}:", f"{fmt_eur(abs(float(row.get('base', 0))))}"])
            totals.append([f"ДДС {rate}:", f"{fmt_eur(abs(float(row.get('vat', 0))))}"])
        totals.append(["Сума на известието:" if credit_note else "Сума за плащане:",
                       f"{fmt_eur(abs(float(document.get('total_amount', 0))))}"])
        totals_table = Table(totals, colWidths=[50 * mm, 30 * mm], hAlign='RIGHT')
        totals_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), PDF_FONT),
            ('FONTNAME', (0, -1), (-1, -1), PDF_FONT_BOLD),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('ALIGN', (0, 0), (-1, -1), 'RIGHT'),
            ('LINEABOVE', (0, -1), (-1, -1), 0.8, colors.HexColor('#334155')),
        ]))
        elements += [totals_table, Spacer(1, 5 * mm)]

        method = document.get("payment_method")
        method_text = {"cash": "В брой", "card": "С карта", "bank_transfer": "По банков път"}.get(method or "", "По банков път")
        elements.append(Paragraph(f"Дата на данъчното събитие: {day_text(document.get('issue_date'))}", normal_style))
        if document.get("vat_exempt_basis"):
            elements.append(Paragraph(f"Основание за неначисляване на ДДС: {text(document.get('vat_exempt_basis'))}", normal_style))
        if credit_note:
            elements.append(Paragraph(f"Основание за издаване: {text(document.get('notes'))}", normal_style))
        else:
            elements.append(Paragraph(f"Начин на плащане: {method_text}", normal_style))
        if method not in ("cash", "card") and not credit_note:
            if company.get("bank_iban"):
                bank = f" ({text(company.get('bank_name'))})" if company.get("bank_name") else ""
                elements.append(Paragraph(f"IBAN: {text(company.get('bank_iban'))}{bank}", normal_style))
            if document.get("due_date"):
                elements.append(Paragraph(f"Срок за плащане: {day_text(document.get('due_date'))}", normal_style))
        if document.get("notes") and not credit_note:
            elements.append(Paragraph(f"Бележки: {text(document.get('notes'))}", normal_style))
        elements.append(Spacer(1, 14 * mm))
        signatures = Table([["Съставил: ..............................", "Получил: .............................."]], colWidths=[90 * mm, 90 * mm])
        signatures.setStyle(TableStyle([('FONTNAME', (0, 0), (-1, -1), PDF_FONT), ('FONTSIZE', (0, 0), (-1, -1), 10)]))
        elements.append(signatures)

        doc.build(elements)
        buffer.seek(0)
        return buffer.getvalue()

    @staticmethod
    def generate_payroll_excel(entries: List[dict], company_name: str = "", period_label: str = "") -> bytes:
        """The month's payroll for the accountant: each person's gross, the
        contributions on both sides, the tax, the net and the whole cost."""
        if not EXCEL_AVAILABLE:
            raise ImportError("openpyxl is not installed")
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Заплати"
        ws["A1"] = f"Заплати - {company_name}" if company_name else "Заплати"
        ws["A1"].font = Font(bold=True, size=14)
        ws["A2"] = period_label
        headers = ["Служител", "Бруто", "Осигуровки служител", "Данък", "Нето", "Осигуровки работодател",
                   "Ваучери", "ДДЗО", "Общо разход"]
        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="10B981", end_color="10B981", fill_type="solid")
        for col, title in enumerate(headers, 1):
            cell = ws.cell(row=4, column=col, value=title)
            cell.font = header_font
            cell.fill = header_fill
        keys = ["gross_amount", "employee_contributions", "income_tax", "net_amount", "employer_contributions",
                "food_vouchers", "additional_insurance", "total_employer_cost"]
        row = 5
        for entry in entries:
            ws.cell(row=row, column=1, value=_excel_safe(entry.get("employee_name") or ""))
            for col, key in enumerate(keys, 2):
                cell = ws.cell(row=row, column=col, value=round(float(entry.get(key) or 0), 2))
                cell.number_format = '#,##0.00'
            row += 1
        ws.cell(row=row, column=1, value="Общо").font = Font(bold=True)
        for col, key in enumerate(keys, 2):
            cell = ws.cell(row=row, column=col, value=round(sum(float(e.get(key) or 0) for e in entries), 2))
            cell.number_format = '#,##0.00'
            cell.font = Font(bold=True)
        ws.column_dimensions["A"].width = 28
        for col in range(2, len(headers) + 1):
            ws.column_dimensions[get_column_letter(col)].width = 16
        output = io.BytesIO()
        wb.save(output)
        return output.getvalue()

    @staticmethod
    def generate_statistics_excel(stats: dict, company_name: str = "") -> bytes:
        """Generate Excel statistics report"""
        if not EXCEL_AVAILABLE:
            raise ImportError("openpyxl is not installed")
        
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Статистика"
        
        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="10B981", end_color="10B981", fill_type="solid")
        
        # Title
        ws.merge_cells('A1:D1')
        ws['A1'] = f"Финансова статистика - {company_name}" if company_name else "Финансова статистика"
        ws['A1'].font = Font(bold=True, size=14)
        
        ws['A2'] = f"Генерирано: {datetime.now().strftime('%d.%m.%Y %H:%M')}"
        
        # Summary section
        row = 4
        ws.cell(row=row, column=1, value="Показател").font = header_font
        ws.cell(row=row, column=1).fill = header_fill
        ws.cell(row=row, column=2, value="Стойност").font = header_font
        ws.cell(row=row, column=2).fill = header_fill
        
        summary_data = [
            ("Общо приходи", stats.get('total_income', 0)),
            ("Общо разходи", stats.get('total_expense', 0)),
            ("Печалба", stats.get('profit', 0)),
            # A business outside VAT registration has no VAT to pay.
            *([] if stats.get('vat_registered') is False else [("ДДС за плащане", stats.get('vat_to_pay', 0))]),
            ("Брой фактури", stats.get('invoice_count', 0)),
        ]
        
        for i, (label, value) in enumerate(summary_data, row + 1):
            ws.cell(row=i, column=1, value=label)
            cell = ws.cell(row=i, column=2, value=value)
            if isinstance(value, (int, float)) and label != "Брой фактури":
                cell.number_format = '#,##0.00 €'
        
        ws.column_dimensions['A'].width = 25
        ws.column_dimensions['B'].width = 20

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output.getvalue()

    @staticmethod
    def generate_vat_ledger_excel(
        purchases: List[dict],
        sales: List[dict],
        company_name: str = "",
        period_label: str = "",
        issued_invoices: Optional[List[dict]] = None,
    ) -> bytes:
        """Generate a working ДДС purchases/sales ledger (Дневник на
        покупки/продажби), grouped by the same VAT-rate categories NRA's
        registers use. This mirrors the standard column groupings an
        accountant works with, so it can be reviewed and re-keyed (or
        imported) into whatever software actually files the Справка-
        декларация - it is not a byte-exact reproduction of the official
        Приложение № 10/11 file layout, which this app doesn't submit
        directly.
        """
        if not EXCEL_AVAILABLE:
            raise ImportError("openpyxl is not installed")

        wb = openpyxl.Workbook()

        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="8B5CF6", end_color="8B5CF6", fill_type="solid")
        total_font = Font(bold=True)
        total_fill = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")
        money_format = '#,##0.00 €'

        def write_title(ws, title):
            ws.merge_cells('A1:D1')
            ws['A1'] = f"{title} - {company_name}" if company_name else title
            ws['A1'].font = Font(bold=True, size=14)
            ws['A2'] = period_label or f"Генерирано: {datetime.now().strftime('%d.%m.%Y %H:%M')}"

        # ===== Дневник на покупките =====
        ws = wb.active
        ws.title = "Дневник покупки"
        write_title(ws, "Дневник на покупките")

        purchase_headers = [
            "№", "Дата", "Доставчик", "ЕИК/Булстат", "№ документ", "Вид документ",
            "№ протокол чл.117", "Краен срок протокол",
            "ДО 20%", "ДДС 20%", "ДО 9%", "ДДС 9%", "ДО нулева ставка",
            "ДО освободени", "ДО извън обхвата", "ДО обратно начисляване",
            "ДДС самоначислен", "Общо с ДДС"
        ]
        AMOUNT_COL_START = 9  # 1-indexed column where the amount columns begin
        header_row = 4
        for col, header in enumerate(purchase_headers, 1):
            cell = ws.cell(row=header_row, column=col, value=header)
            cell.font = header_font
            cell.fill = header_fill

        overdue_fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
        today = datetime.now()
        totals = [0.0] * (len(purchase_headers) - (AMOUNT_COL_START - 1))
        row = header_row
        for idx, inv in enumerate(purchases, 1):
            row = header_row + idx
            treatment = inv.get("vat_treatment") or "standard_20"
            base = inv.get("amount_without_vat", 0) or 0
            vat = inv.get("vat_amount", 0) or 0

            values = [0.0] * 10  # ДО20,ДДС20,ДО9,ДДС9,ДОнулева,ДОосвоб,ДОизвън,ДОобратно,ДДСсамонач,Общо
            if treatment == "standard_20":
                values[0], values[1] = base, vat
            elif treatment == "reduced_9":
                values[2], values[3] = base, vat
            elif treatment == "zero_rate":
                values[4] = base
            elif treatment == "exempt":
                values[5] = base
            elif treatment == "outside_scope":
                values[6] = base
            elif treatment == "reverse_charge":
                values[7], values[8] = base, vat
            values[9] = inv.get("total_amount", base + vat)

            date_val = inv.get("date")
            date_str = date_val.strftime("%d.%m.%Y") if isinstance(date_val, datetime) else str(date_val)[:10]
            if inv.get("document_type") == "credit_note":
                doc_type = "Кредитно известие"
            else:
                doc_type = "Протокол чл.117" if treatment == "reverse_charge" else "Фактура"

            protocol_number = ""
            deadline_str = ""
            deadline_overdue = False
            if treatment == "reverse_charge":
                protocol_number = inv.get("protocol_number") or ""
                if isinstance(date_val, datetime):
                    deadline = date_val + timedelta(days=15)
                    deadline_str = deadline.strftime("%d.%m.%Y")
                    deadline_overdue = deadline < today

            row_values = [
                idx, date_str, _excel_safe(inv.get("supplier", "")), _excel_safe(inv.get("supplier_eik") or ""),
                _excel_safe(inv.get("invoice_number", "")), doc_type, _excel_safe(protocol_number), deadline_str, *values
            ]
            for col, value in enumerate(row_values, 1):
                cell = ws.cell(row=row, column=col, value=value)
                if col >= AMOUNT_COL_START:
                    cell.number_format = money_format
                    totals[col - AMOUNT_COL_START] += value
                if col == 8 and deadline_overdue:
                    cell.fill = overdue_fill
                    cell.font = Font(color="991B1B", bold=True)

        total_row = row + 1
        ws.cell(row=total_row, column=6, value="ОБЩО:").font = total_font
        for i, t in enumerate(totals):
            cell = ws.cell(row=total_row, column=AMOUNT_COL_START + i, value=round(t, 2))
            cell.font = total_font
            cell.fill = total_fill
            cell.number_format = money_format

        col_widths = [5, 12, 26, 14, 14, 14, 16, 16, 11, 10, 11, 10, 13, 12, 12, 14, 13, 13]
        for col, width in zip(range(1, len(purchase_headers) + 1), col_widths):
            ws.column_dimensions[get_column_letter(col)].width = width

        # ===== Дневник на продажбите =====
        ws2 = wb.create_sheet("Дневник продажби")
        write_title(ws2, "Дневник на продажбите")

        # Split by the actual VAT rate of each entry (20%/9%/0%), not a
        # blanket 20% assumption - matters for restaurants/hotels/bakeries
        # and anyone else on the reduced or zero rate.
        # The till's daily reports and the invoices issued to customers, day
        # by day: each invoice its own row with its number, customer and the
        # base and VAT of each of its rates; a cancelled one keeps its number
        # in the list at zero.
        sales_headers = [
            "№", "Дата", "Вид документ", "№ документ", "Клиент", "ЕИК",
            "ДО 20%", "ДДС 20%", "ДО 9%", "ДДС 9%", "ДО нулева ставка", "Необлагаема част (джобни)", "Общо",
        ]
        first_amount_col = 7
        for col, header in enumerate(sales_headers, 1):
            cell = ws2.cell(row=header_row, column=col, value=header)
            cell.font = header_font
            cell.fill = header_fill

        def _rate_parts(doc: dict) -> tuple:
            """(base 20%, VAT 20%, base 9%, VAT 9%, base 0%) of an issued invoice."""
            base_20 = vat_20 = base_9 = vat_9 = base_0 = 0.0
            for part in doc.get("vat_by_rate") or []:
                rate = float(part.get("rate", 0) or 0)
                base, vat = float(part.get("base", 0) or 0), float(part.get("vat", 0) or 0)
                if abs(rate - 20.0) < 0.01:
                    base_20, vat_20 = base_20 + base, vat_20 + vat
                elif abs(rate - 9.0) < 0.01:
                    base_9, vat_9 = base_9 + base, vat_9 + vat
                else:
                    base_0 += base
            return base_20, vat_20, base_9, vat_9, base_0

        # Invoices issued for sales rung up at the till (fiscal receipts): the
        # day's till report holds them already, so its row is the till's
        # sales less those invoices - each sale and its VAT listed once.
        invoiced_at_till: Dict[str, List[float]] = {}
        for doc in issued_invoices or []:
            if doc.get("in_till") and not doc.get("cancelled"):
                day_parts = invoiced_at_till.setdefault(str(doc.get("issue_date", ""))[:10], [0.0] * 6)
                for i, value in enumerate(_rate_parts(doc)):
                    day_parts[i] += value
                day_parts[5] += float(doc.get("total_amount", 0) or 0)

        def _till_row(rev: dict) -> tuple:
            fiscal_revenue = rev.get("fiscal_revenue", 0) or 0
            pocket_money = rev.get("pocket_money", 0) or 0
            # Each VAT group of the day's till report at its own rate (or
            # the whole day at its one rate).
            base_20 = vat_20 = base_9 = vat_9 = base_0 = 0.0
            for rate, amount in vat_parts(rev):
                base = round(amount * 100 / (100 + rate), 2)
                if rate and abs(rate - 20.0) < 0.01:
                    base_20, vat_20 = base_20 + base, vat_20 + round(amount - base, 2)
                elif rate and abs(rate - 9.0) < 0.01:
                    base_9, vat_9 = base_9 + base, vat_9 + round(amount - base, 2)
                else:
                    base_0 += amount
            day = str(rev.get("date", ""))[:10]
            kind = "Отчет за извършени продажби (81)"
            invoiced = invoiced_at_till.pop(day, None)
            if invoiced:
                base_20, vat_20, base_9, vat_9, base_0 = (
                    round(value - invoiced[i], 2) for i, value in enumerate((base_20, vat_20, base_9, vat_9, base_0))
                )
                fiscal_revenue = round(fiscal_revenue - invoiced[5], 2)
                kind += " - без фактурираното"
            return (
                day, 0, kind, "", "", "",
                [base_20, vat_20, base_9, vat_9, base_0, pocket_money, fiscal_revenue + pocket_money],
            )

        def _invoice_row(doc: dict) -> tuple:
            base_20 = vat_20 = base_9 = vat_9 = base_0 = 0.0
            cancelled = bool(doc.get("cancelled"))
            if not cancelled:
                base_20, vat_20, base_9, vat_9, base_0 = _rate_parts(doc)
            total = 0.0 if cancelled else float(doc.get("total_amount", 0) or 0)
            # A credit note (its amounts below zero) is code 03 of the ledger.
            kind = "Кредитно известие (03)" if doc.get("doc_type") == "credit_note" else "Фактура (01)"
            if cancelled:
                kind += " - анулирано" if doc.get("doc_type") == "credit_note" else " - анулирана"
            return (
                str(doc.get("issue_date", ""))[:10], 1, kind, _excel_safe(doc.get("invoice_number") or ""),
                _excel_safe(doc.get("customer_name") or ""), _excel_safe(doc.get("customer_eik") or ""),
                [round(base_20, 2), round(vat_20, 2), round(base_9, 2), round(vat_9, 2), round(base_0, 2), 0.0, round(total, 2)],
            )

        sale_rows = [_till_row(rev) for rev in sales] + [_invoice_row(doc) for doc in (issued_invoices or [])]
        sale_rows.sort(key=lambda r: (r[0], r[1], r[3]))
        sales_totals = [0.0] * 7
        row2 = header_row
        for idx, (day, _order, kind, number, customer, eik, values) in enumerate(sale_rows, 1):
            row2 = header_row + idx
            row_values = [idx, day, kind, number, customer, eik, *values]
            for col, value in enumerate(row_values, 1):
                cell = ws2.cell(row=row2, column=col, value=value)
                if col >= first_amount_col:
                    cell.number_format = money_format
            for i, v in enumerate(values):
                sales_totals[i] += v

        total_row2 = row2 + 1
        ws2.cell(row=total_row2, column=first_amount_col - 1, value="ОБЩО:").font = total_font
        for i, t in enumerate(sales_totals):
            cell = ws2.cell(row=total_row2, column=first_amount_col + i, value=round(t, 2))
            cell.font = total_font
            cell.fill = total_fill
            cell.number_format = money_format

        for col, width in zip(range(1, len(sales_headers) + 1), [5, 12, 28, 13, 24, 13, 11, 10, 11, 10, 13, 22, 13]):
            ws2.column_dimensions[get_column_letter(col)].width = width

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output.getvalue()

    @staticmethod
    def generate_employee_compliance_excel(
        holiday_work: List[dict],
        leave: List[dict],
        company_name: str = "",
        period_label: str = ""
    ) -> bytes:
        """A list of which employees worked on an official holiday (extra-
        pay entitlement under Чл. 262 КТ), which took leave and which were
        on sick leave, for an accountant to attach to the required
        company/personnel documents."""
        if not EXCEL_AVAILABLE:
            raise ImportError("openpyxl is not installed")

        wb = openpyxl.Workbook()

        header_font = Font(bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="8B5CF6", end_color="8B5CF6", fill_type="solid")
        header_row = 4

        def write_title(ws, title):
            ws.merge_cells('A1:D1')
            ws['A1'] = f"{title} - {company_name}" if company_name else title
            ws['A1'].font = Font(bold=True, size=14)
            ws['A2'] = period_label or f"Генерирано: {datetime.now().strftime('%d.%m.%Y %H:%M')}"

        LEAVE_TYPE_LABELS = {"paid": "Платена", "unpaid": "Неплатена", "sick": "Болнична"}
        SICK_REASON_LABELS = {
            "illness": "Общо заболяване", "work_accident": "Трудова злополука",
            "occupational": "Професионална болест", "family_care": "Гледане на болен член от семейството",
            "maternity": "Бременност и раждане", "other": "Друго",
        }

        def leave_days(entry: dict) -> Tuple[str, str, Any]:
            """The period as written in Bulgaria and its calendar days."""
            start_str = str(entry.get("start_date", ""))[:10]
            end_str = str(entry.get("end_date", ""))[:10]
            try:
                start_d = datetime.strptime(start_str, "%Y-%m-%d")
                end_d = datetime.strptime(end_str, "%Y-%m-%d")
            except ValueError:
                return start_str, end_str, ""
            return start_d.strftime("%d.%m.%Y"), end_d.strftime("%d.%m.%Y"), (end_d - start_d).days + 1

        def write_sheet(sheet, headers: List[str], rows: List[list], widths: List[int]) -> None:
            for col, header in enumerate(headers, 1):
                cell = sheet.cell(row=header_row, column=col, value=header)
                cell.font = header_font
                cell.fill = header_fill
            for idx, row_values in enumerate(rows, 1):
                for col, value in enumerate(row_values, 1):
                    sheet.cell(row=header_row + idx, column=col, value=value)
            for col, width in zip(range(1, len(headers) + 1), widths):
                sheet.column_dimensions[get_column_letter(col)].width = width

        # ===== Работа на официални празници =====
        ws = wb.active
        ws.title = "Работа на празници"
        write_title(ws, "Работа на официални празници")

        holiday_headers = ["№", "Служител", "Дата", "Празник", "Бележка"]
        for col, header in enumerate(holiday_headers, 1):
            cell = ws.cell(row=header_row, column=col, value=header)
            cell.font = header_font
            cell.fill = header_fill

        for idx, entry in enumerate(holiday_work, 1):
            row = header_row + idx
            date_str = str(entry.get("date", ""))[:10]
            try:
                date_str = datetime.strptime(date_str, "%Y-%m-%d").strftime("%d.%m.%Y")
            except ValueError:
                pass
            row_values = [idx, _excel_safe(entry.get("employee_name", "")), date_str, entry.get("holiday_name", ""), _excel_safe(entry.get("note") or "")]
            for col, value in enumerate(row_values, 1):
                ws.cell(row=row, column=col, value=value)

        for col, width in zip(range(1, len(holiday_headers) + 1), [5, 26, 13, 40, 30]):
            ws.column_dimensions[get_column_letter(col)].width = width

        # ===== Отпуски (платени и неплатени) =====
        ws2 = wb.create_sheet("Отпуски")
        write_title(ws2, "Отпуски")
        leave_rows: List[list] = []
        for entry in (e for e in leave if e.get("leave_type") != "sick"):
            start_str, end_str, calendar_days = leave_days(entry)
            leave_type_label = LEAVE_TYPE_LABELS.get(entry.get("leave_type") or "", entry.get("leave_type", ""))
            leave_rows.append([
                len(leave_rows) + 1, _excel_safe(entry.get("employee_name", "")), leave_type_label, start_str, end_str,
                calendar_days, entry.get("working_days") if entry.get("working_days") is not None else "",
                _excel_safe(entry.get("note") or ""),
            ])
        write_sheet(
            ws2, ["№", "Служител", "Вид отпуск", "От дата", "До дата", "Календарни дни", "Работни дни", "Бележка"],
            leave_rows, [5, 26, 14, 13, 13, 15, 13, 30],
        )

        # ===== Болнични =====
        # The sheet's own details, as the employer gets them - no diagnosis.
        ws3 = wb.create_sheet("Болнични")
        write_title(ws3, "Болнични")
        sick_rows: List[list] = []
        for entry in (e for e in leave if e.get("leave_type") == "sick"):
            start_str, end_str, calendar_days = leave_days(entry)
            sick_rows.append([
                len(sick_rows) + 1, _excel_safe(entry.get("employee_name", "")), _excel_safe(entry.get("sheet_number") or ""),
                "Продължение" if entry.get("is_continuation") else "Първичен",
                SICK_REASON_LABELS.get(entry.get("sick_reason") or "", ""), start_str, end_str,
                calendar_days, entry.get("working_days") if entry.get("working_days") is not None else "",
                _excel_safe(entry.get("note") or ""),
            ])
        write_sheet(
            ws3, ["№", "Служител", "№ на болничния лист", "Първичен / продължение", "Причина", "От дата", "До дата",
                  "Календарни дни", "Работни дни", "Бележка"],
            sick_rows, [5, 26, 22, 22, 30, 13, 13, 15, 13, 30],
        )

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output.getvalue()

    @staticmethod
    def generate_statistics_pdf(
        stats: dict,
        top_suppliers: Optional[List[dict]] = None,
        top_items: Optional[List[dict]] = None,
        company_name: str = "",
        period_label: str = "",
        visibility_note: Optional[str] = None,
    ) -> bytes:
        """Generate a one-page PDF financial report - summary + top suppliers/items"""
        if not PDF_AVAILABLE:
            raise ImportError("reportlab is not installed")

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=20*mm, bottomMargin=20*mm)
        elements = []
        styles = getSampleStyleSheet()

        title_style = ParagraphStyle('CustomTitle', parent=styles['Heading1'], fontName=PDF_FONT_BOLD, fontSize=16, spaceAfter=6, alignment=1)
        subtitle_style = ParagraphStyle('CustomSubtitle', parent=styles['Normal'], fontName=PDF_FONT, alignment=1, textColor=colors.HexColor('#64748B'))
        section_style = ParagraphStyle('SectionTitle', parent=styles['Heading2'], fontName=PDF_FONT_BOLD, fontSize=13, spaceBefore=14, spaceAfter=6)

        title = f"Финансов отчет - {company_name}" if company_name else "Финансов отчет"
        elements.append(Paragraph(title, title_style))
        if period_label:
            elements.append(Paragraph(period_label, subtitle_style))
        elements.append(Paragraph(f"Генерирано: {datetime.now().strftime('%d.%m.%Y %H:%M')}", subtitle_style))
        elements.append(Spacer(1, 8*mm))

        elements.append(Paragraph("Обобщение", section_style))
        summary_rows = [
            ["Показател", "Стойност"],
            ["Общо приходи", _money_or_hidden(stats.get('total_income'))],
            ["Общо разходи", _money_or_hidden(stats.get('total_expense'))],
            ["Печалба", _money_or_hidden(stats.get('profit'))],
            # A business outside VAT registration has no VAT to pay.
            *([] if stats.get('vat_registered') is False else [["ДДС за плащане", _money_or_hidden(stats.get('vat_to_pay'))]]),
            ["Брой фактури", "скрито" if stats.get('invoice_count') is None else str(stats.get('invoice_count'))],
        ]
        summary_table = Table(summary_rows, colWidths=[90*mm, 60*mm])
        summary_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), PDF_FONT),
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#8B5CF6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('FONTNAME', (0, 0), (-1, 0), PDF_FONT_BOLD),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#CBD5E1')),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#F8FAFC')),
        ]))
        elements.append(summary_table)
        if visibility_note:
            # The same note as on screen: which totals - and so which profit
            # - this reader's access leaves out.
            elements.append(Spacer(1, 3*mm))
            elements.append(Paragraph(_xml_escape(visibility_note), subtitle_style))

        if top_suppliers:
            elements.append(Paragraph("Топ доставчици", section_style))
            rows = [["Доставчик", "Сума", "Фактури"]]
            for s in top_suppliers[:10]:
                rows.append([
                    str(s.get('supplier', ''))[:30],
                    f"{fmt_eur(s.get('total_amount', 0))}",
                    str(s.get('invoice_count', 0)),
                ])
            supplier_table = Table(rows, colWidths=[90*mm, 40*mm, 25*mm])
            supplier_table.setStyle(TableStyle([
                ('FONTNAME', (0, 0), (-1, -1), PDF_FONT),
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#10B981')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                ('FONTNAME', (0, 0), (-1, 0), PDF_FONT_BOLD),
                ('FONTSIZE', (0, 0), (-1, -1), 9),
                ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#CBD5E1')),
                ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
                ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#F8FAFC')),
            ]))
            elements.append(supplier_table)

        if top_items:
            elements.append(Paragraph("Топ артикули", section_style))
            rows = [["Артикул", "Стойност", "Брой"]]
            for i in top_items[:10]:
                rows.append([
                    str(i.get('item_name', ''))[:30],
                    f"{fmt_eur(i.get('total_value', 0))}",
                    str(i.get('frequency', 0)),
                ])
            items_table = Table(rows, colWidths=[90*mm, 40*mm, 25*mm])
            items_table.setStyle(TableStyle([
                ('FONTNAME', (0, 0), (-1, -1), PDF_FONT),
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F59E0B')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                ('FONTNAME', (0, 0), (-1, 0), PDF_FONT_BOLD),
                ('FONTSIZE', (0, 0), (-1, -1), 9),
                ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#CBD5E1')),
                ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
                ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#F8FAFC')),
            ]))
            elements.append(items_table)

        doc.build(elements)
        buffer.seek(0)
        return buffer.getvalue()
