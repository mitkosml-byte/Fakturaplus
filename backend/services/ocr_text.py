"""What a scan reads, set straight: letters and digits OCR mixes up, an
amount written any way (1 234,50 / 1,234.50), an invoice number, a date.
Pure functions - no database; moved out of server.py, which imports them
from here."""
import re
from datetime import datetime
from typing import Optional


def fix_ocr_letter_errors(value: str) -> str:
    """Замества букви, лесно объркваеми с цифри при OCR (без да маха
    останалите символи - ползва се и за дати, където разделителите
    -./ трябва да оцелеят)."""
    if not value:
        return value

    fixes = {
        'O': '0',
        'o': '0',
        'О': '0',  # Кирилица О
        'о': '0',  # Кирилица о
        'l': '1',
        'I': '1',
        'І': '1',  # Кирилица І
        '|': '1',
        'S': '5',
        's': '5',
        'B': '8',
        'Z': '2',
        'z': '2',
        ',': '.',  # Запетая към точка за десетични
    }

    result = value
    for wrong, correct in fixes.items():
        result = result.replace(wrong, correct)
    return result

def fix_ocr_number_errors(value: str) -> str:
    """Поправя типични OCR грешки в числа и маха всичко освен цифри и
    точка - само за суми, НЕ за дати (виж normalize_date, който ползва
    fix_ocr_letter_errors директно, за да запази разделителите -./)."""
    if not value:
        return value
    result = fix_ocr_letter_errors(value)
    # Премахване на всичко освен цифри и точка
    result = re.sub(r'[^\d.]', '', result)
    return result

def parse_amount(value) -> float:
    """Парсва сума от различни формати"""
    if value is None:
        return 0.0
    
    if isinstance(value, (int, float)):
        return float(value)
    
    if isinstance(value, str):
        # Почистване
        cleaned = fix_ocr_number_errors(value)
        
        # Обработка на европейски формат (1.234,56 -> 1234.56)
        if ',' in value and '.' in value:
            if value.rfind(',') > value.rfind('.'):
                # Европейски формат: 1.234,56
                cleaned = value.replace('.', '').replace(',', '.')
        elif ',' in value:
            # Може да е десетична запетая
            cleaned = value.replace(',', '.')
        
        cleaned = re.sub(r'[^\d.]', '', cleaned)
        
        try:
            return float(cleaned) if cleaned else 0.0
        except ValueError:
            return 0.0
    
    return 0.0

def normalize_invoice_number(invoice_number: str) -> str:
    """Нормализира номер на фактура"""
    if not invoice_number:
        return invoice_number
    
    # Почистване от OCR грешки
    cleaned = invoice_number.strip()
    
    # Поправка на типични грешки
    ocr_fixes = {
        'O': '0',
        'o': '0',
        'l': '1',
        'I': '1',
    }
    
    # За номера на фактури, само в числовите части
    parts = re.split(r'(\D+)', cleaned)
    result_parts = []
    
    for part in parts:
        if part.isdigit() or re.match(r'^[\dOoIl]+$', part):
            # Числова част - поправяме OCR грешки
            fixed = part
            for wrong, correct in ocr_fixes.items():
                fixed = fixed.replace(wrong, correct)
            result_parts.append(fixed)
        else:
            result_parts.append(part.upper())
    
    return ''.join(result_parts)

def normalize_date(date_str: str) -> Optional[str]:
    """Нормализира дата в ISO формат YYYY-MM-DD"""
    if not date_str:
        return None
    
    # Почистване
    date_str = date_str.strip()

    # Поправка на OCR грешки в числата (само буква->цифра, БЕЗ да маха
    # разделителите -./, за разлика от fix_ocr_number_errors)
    date_str = fix_ocr_letter_errors(date_str)

    # Различни формати
    patterns = [
        (r'(\d{4})-(\d{1,2})-(\d{1,2})', '%Y-%m-%d'),  # 2024-01-15
        (r'(\d{1,2})\.(\d{1,2})\.(\d{4})', '%d.%m.%Y'),  # 15.01.2024
        (r'(\d{1,2})/(\d{1,2})/(\d{4})', '%d/%m/%Y'),  # 15/01/2024
        (r'(\d{1,2})-(\d{1,2})-(\d{4})', '%d-%m-%Y'),  # 15-01-2024
    ]
    
    for pattern, fmt in patterns:
        match = re.search(pattern, date_str)
        if match:
            try:
                parsed = datetime.strptime(match.group(), fmt)
                return parsed.strftime('%Y-%m-%d')
            except ValueError:
                continue
    
    return None
