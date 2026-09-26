"""Export service for generating Excel and PDF reports"""
import io
import os
from datetime import datetime, timedelta
from typing import List, Optional
import json

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
        total_without_vat = 0
        total_vat = 0
        total_amount = 0
        
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
                inv.get('supplier', ''),
                inv.get('invoice_number', ''),
                amount_without_vat,
                vat_amount,
                total,
                inv.get('notes', '') or ''
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
        
        total_without_vat = 0
        total_vat = 0
        total_amount = 0
        
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
                inv.get('invoice_number', ''),
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
            ("ДДС за плащане", stats.get('vat_to_pay', 0)),
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
        period_label: str = ""
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
            is_datetime = isinstance(date_val, datetime)
            date_str = date_val.strftime("%d.%m.%Y") if is_datetime else str(date_val)[:10]
            doc_type = "Протокол чл.117" if treatment == "reverse_charge" else "Фактура"

            protocol_number = ""
            deadline_str = ""
            deadline_overdue = False
            if treatment == "reverse_charge":
                protocol_number = inv.get("protocol_number") or ""
                if is_datetime:
                    deadline = date_val + timedelta(days=15)
                    deadline_str = deadline.strftime("%d.%m.%Y")
                    deadline_overdue = deadline < today

            row_values = [
                idx, date_str, inv.get("supplier", ""), inv.get("supplier_eik") or "",
                inv.get("invoice_number", ""), doc_type, protocol_number, deadline_str, *values
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
        sales_headers = ["№", "Дата", "Вид документ", "ДО 20%", "ДДС 20%", "ДО 9%", "ДДС 9%", "ДО нулева ставка", "Необлагаема част (джобни)", "Общо"]
        for col, header in enumerate(sales_headers, 1):
            cell = ws2.cell(row=header_row, column=col, value=header)
            cell.font = header_font
            cell.fill = header_fill

        sales_totals = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
        row2 = header_row
        for idx, rev in enumerate(sales, 1):
            row2 = header_row + idx
            fiscal_revenue = rev.get("fiscal_revenue", 0) or 0
            pocket_money = rev.get("pocket_money", 0) or 0
            rate = rev.get("vat_rate_percent", 20.0) or 0.0
            total = fiscal_revenue + pocket_money

            base_20 = vat_20 = base_9 = vat_9 = base_0 = 0.0
            if rate and abs(rate - 20.0) < 0.01:
                base_20 = round(fiscal_revenue * 100 / (100 + rate), 2)
                vat_20 = round(fiscal_revenue - base_20, 2)
            elif rate and abs(rate - 9.0) < 0.01:
                base_9 = round(fiscal_revenue * 100 / (100 + rate), 2)
                vat_9 = round(fiscal_revenue - base_9, 2)
            else:
                base_0 = fiscal_revenue

            values = [base_20, vat_20, base_9, vat_9, base_0]
            row_values = [idx, rev.get("date", ""), "Отчет за извършени продажби (81)", *values, pocket_money, total]
            for col, value in enumerate(row_values, 1):
                cell = ws2.cell(row=row2, column=col, value=value)
                if col >= 4:
                    cell.number_format = money_format
            for i, v in enumerate(values + [pocket_money, total]):
                sales_totals[i] += v

        total_row2 = row2 + 1
        ws2.cell(row=total_row2, column=3, value="ОБЩО:").font = total_font
        for i, t in enumerate(sales_totals):
            cell = ws2.cell(row=total_row2, column=4 + i, value=round(t, 2))
            cell.font = total_font
            cell.fill = total_fill
            cell.number_format = money_format

        for col, width in zip(range(1, len(sales_headers) + 1), [5, 12, 28, 11, 10, 11, 10, 13, 22, 13]):
            ws2.column_dimensions[get_column_letter(col)].width = width

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
        period_label: str = ""
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
            ["Общо приходи", f"{stats.get('total_income', 0):.2f} €"],
            ["Общо разходи", f"{stats.get('total_expense', 0):.2f} €"],
            ["Печалба", f"{stats.get('profit', 0):.2f} €"],
            ["ДДС за плащане", f"{stats.get('vat_to_pay', 0):.2f} €"],
            ["Брой фактури", str(stats.get('invoice_count', 0))],
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

        if top_suppliers:
            elements.append(Paragraph("Топ доставчици", section_style))
            rows = [["Доставчик", "Сума", "Фактури"]]
            for s in top_suppliers[:10]:
                rows.append([
                    str(s.get('supplier', ''))[:30],
                    f"{s.get('total_amount', 0):.2f} €",
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
                    f"{i.get('total_value', 0):.2f} €",
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
