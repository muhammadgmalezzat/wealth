// Parses a user-typed amount. Accepts Western and Arabic-Indic digits (٠-٩ and ۰-۹),
// thousands separators (`,` `٬` `،` and spaces) and decimal points (`.` `٫`).
// Commas are always thousands separators, so "12,5" is 125.
// Returns null for empty, non-numeric, negative or zero input — amounts are always positive;
// the transaction type carries the sign. `allowZero` accepts 0 (e.g. a fund's cash allocation).
export function parseAmount(input: string, { allowZero = false } = {}): number | null {
  const normalized = input
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/[,٬،\s]/g, '');

  if (!/^\d*\.?\d+$|^\d+\.$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) && (value > 0 || (allowZero && value === 0)) ? value : null;
}
