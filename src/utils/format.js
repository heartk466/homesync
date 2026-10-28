// Shared display formatters — use these instead of inline toFixed / toLocaleString.

const moneyFormatter = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** 3000 → "₱3,000.00". Accepts numbers or numeric strings; anything else → ₱0.00. */
export function formatMoney(value) {
  const n = Number(value);
  return `₱${moneyFormatter.format(Number.isFinite(n) ? n : 0)}`;
}

/** "2026-10-27" or an ISO timestamp → "Oct 27, 2026". Empty/invalid → "". */
export function formatDate(value) {
  if (!value) return '';
  // Plain dates are calendar days — parse as local midnight so they don't shift a day.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormatter.format(date);
}
