// How a write-up spec correction reads on a page: a short field name and, for
// sizes, fractions instead of decimals. Display-only — nothing here changes what
// is stored, so write-ups saved before this existed read the same as new ones.

const MEASURE_LABEL = /width|height|depth|size/i;

/** "Sales Width" → "Width", "Sales Height" → "Height". Any other label is left as typed. */
export function specLabel(label: string): string {
  const s = (label || "").trim();
  const m = s.match(/^sales\s+(width|height)$/i);
  if (!m) return s;
  return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
}

/** 37.5625 → `37 9/16"` (nearest 1/16). Returns null when it isn't a plain decimal measurement. */
function decimalToFraction(value: string): string | null {
  const m = (value || "").trim().match(/^(\d+\.\d+)\s*(?:"|”|″|in\.?|inches)?$/i);
  if (!m) return null;
  const total = Math.round(parseFloat(m[1]) * 16);
  const whole = Math.floor(total / 16);
  let num = total % 16;
  let den = 16;
  while (num > 0 && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  return num === 0 ? `${whole}"` : `${whole} ${num}/${den}"`;
}

/** A spec value as shown on a page: a decimal size (37.5625") becomes a fraction (37 9/16"). */
export function specValue(field: string, value: string): string {
  const v = value || "";
  if (!MEASURE_LABEL.test(field || "")) return v;
  return decimalToFraction(v) ?? v;
}
