// Client-side mirror of the backend's Bulgarian ЕИК/Булстат checksum
// validator (see backend/server.py: validate_eik). Kept in sync manually -
// used where we need to flag many invoices at once (e.g. a list) without
// a round trip per item; the backend's /utils/validate-eik stays the
// source of truth for the live single-field check in the scan form.

export type EikValidation = {
  valid: boolean;
  normalized: string;
  reason: 'empty' | 'format' | 'checksum' | null;
};

function checkDigit(digits: number[], weights1: number[], weights2: number[]): number {
  const sum1 = digits.reduce((acc, d, i) => acc + d * weights1[i], 0);
  const remainder1 = sum1 % 11;
  if (remainder1 < 10) return remainder1;
  const sum2 = digits.reduce((acc, d, i) => acc + d * weights2[i], 0);
  const remainder2 = sum2 % 11;
  return remainder2 === 10 ? 0 : remainder2;
}

export function validateEikFormat(raw: string | null | undefined): EikValidation {
  if (!raw) {
    return { valid: false, normalized: '', reason: 'empty' };
  }

  let normalized = raw.trim().toUpperCase();
  if (normalized.startsWith('BG')) {
    normalized = normalized.slice(2);
  }

  if (!/^\d+$/.test(normalized) || (normalized.length !== 9 && normalized.length !== 13)) {
    return { valid: false, normalized, reason: 'format' };
  }

  const digits = normalized.split('').map(Number);

  const check9 = checkDigit(digits.slice(0, 8), [1, 2, 3, 4, 5, 6, 7, 8], [3, 4, 5, 6, 7, 8, 9, 10]);
  if (check9 !== digits[8]) {
    return { valid: false, normalized, reason: 'checksum' };
  }

  if (normalized.length === 9) {
    return { valid: true, normalized, reason: null };
  }

  const check13 = checkDigit(digits.slice(8, 12), [2, 7, 3, 5], [4, 9, 5, 7]);
  if (check13 !== digits[12]) {
    return { valid: false, normalized, reason: 'checksum' };
  }

  return { valid: true, normalized, reason: null };
}
