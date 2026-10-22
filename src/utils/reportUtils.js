// Report helpers: build a report from filters, label periods, convert saved
// reports for the detail modal, and export a PDF. Used by ReportsScreen.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const num = (v) => Number(v) || 0;
const r2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
export const peso = (v) =>
  `₱${num(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Categories offered in the report filters (the app's own list)
export const REPORT_CATEGORIES = [
  'Rent', 'Electricity', 'Water', 'Internet', 'Food', 'Grocery',
  'Transport', 'Entertainment', 'Subscription', 'Other',
];

// ───────────────────────── dates ─────────────────────────
export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const datePresets = () => {
  const now = new Date();
  return {
    thisMonth: { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) },
    lastMonth: {
      from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)),
    },
    thisYear: { from: ymd(new Date(now.getFullYear(), 0, 1)), to: ymd(now) },
  };
};

const parse = (s) => new Date(`${s}T00:00:00`);

/** "Oct 2026" for a whole month, otherwise "Oct 1 – 21, 2026" / "Sep 28 – Oct 21, 2026". */
export function periodLabel(from, to) {
  if (!from || !to) return '';
  const a = parse(from);
  const b = parse(to);
  const lastDay = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === 1 && b.getDate() === lastDay) {
    return `${MONTH_NAMES[a.getMonth()]} ${a.getFullYear()}`;
  }
  if (a.getFullYear() === b.getFullYear()) {
    if (a.getMonth() === b.getMonth()) {
      return `${MONTH_NAMES[a.getMonth()]} ${a.getDate()} – ${b.getDate()}, ${a.getFullYear()}`;
    }
    return `${MONTH_NAMES[a.getMonth()]} ${a.getDate()} – ${MONTH_NAMES[b.getMonth()]} ${b.getDate()}, ${a.getFullYear()}`;
  }
  return `${MONTH_NAMES[a.getMonth()]} ${a.getDate()}, ${a.getFullYear()} – ${MONTH_NAMES[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
}

// ───────────────────────── building a report ─────────────────────────
/** What a member has actually paid: only admin-approved money counts. */
export const paidOfSplit = (s) =>
  s.status === 'approved' ? num(s.share_amount) : Math.min(num(s.paid_amount), num(s.share_amount));

const memberStatusLabel = (status) => ({
  approved: 'paid',
  partly_paid: 'partly paid',
  pending_verification: 'verifying',
}[status] || 'pending');

/**
 * expenses   – approved, non-deleted expenses already limited to the date range
 * splitsMap  – { expenseId: [expense_splits rows] }
 * memberId   – 'all' (household total) or a user id
 * categories – null / [] = every category, otherwise only these
 * Returns { rows, total, paid, pending, count }.
 */
export function computeReport({ expenses, splitsMap, memberId, categories, includeSplits, memberNames }) {
  const catSet = categories && categories.length ? new Set(categories) : null;
  const rows = [];

  expenses.forEach((e) => {
    if (catSet && !catSet.has(e.category)) return;
    const splits = splitsMap[e.id] || [];
    const info = splits.map((s) => ({
      user_id: s.user_id,
      name: memberNames[s.user_id] || 'Member',
      share: r2(s.share_amount),
      paid: r2(paidOfSplit(s)),
      status: memberStatusLabel(s.status),
    }));

    let share;
    let paid;
    let status;
    if (memberId === 'all') {
      share = r2(e.amount);
      paid = r2(info.reduce((a, s) => a + s.paid, 0));
      status = info.length > 0 && info.every((s) => s.status === 'paid') ? 'paid' : paid > 0 ? 'partly paid' : 'pending';
    } else {
      const mine = info.find((s) => s.user_id === memberId);
      if (mine) {
        share = mine.share;
        paid = mine.paid;
        status = mine.status;
      } else if (info.length === 0 && e.members_split && !Array.isArray(e.members_split) && e.members_split[memberId] != null) {
        // no split rows at all (old data) – fall back to the saved split amounts
        share = r2(e.members_split[memberId]);
        paid = e.status === 'paid' ? share : 0;
        status = e.status === 'paid' ? 'paid' : 'pending';
      } else {
        return; // this member isn't part of the expense
      }
    }
    if (share <= 0 && memberId !== 'all') return;

    const row = {
      id: e.id,
      title: e.title,
      category: e.category,
      expense_date: e.expense_date,
      amount: r2(e.amount),
      share,
      paid: Math.min(paid, share),
      status,
    };
    if (includeSplits) row.splits = info;
    rows.push(row);
  });

  rows.sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)));
  const total = r2(rows.reduce((a, r) => a + r.share, 0));
  const paid = r2(rows.reduce((a, r) => a + r.paid, 0));
  const pending = r2(rows.reduce((a, r) => a + Math.max(r.share - r.paid, 0), 0));
  return { rows, total, paid, pending, count: rows.length };
}

// ───────────────────────── shapes for the screen ─────────────────────────
/** A saved generated_reports row -> the statement object the detail modal / PDF use. */
export function statementFromReport(rep, memberNames = {}) {
  const rows = Array.isArray(rep.rows) ? rep.rows : [];
  return {
    id: rep.id,
    kind: rep.kind,
    period: periodLabel(rep.period_from, rep.period_to),
    from: rep.period_from,
    to: rep.period_to,
    createdDate: rep.created_at,
    memberLabel: rep.member_id ? (memberNames[rep.member_id] || 'Member') : 'All Members',
    categories: rep.categories || [],
    includeSplits: !!rep.include_split_details,
    total: num(rep.total),
    paid: num(rep.paid),
    pending: num(rep.pending),
    rows,
  };
}

/** The automatic monthly statement (paid amounts only) -> same shape. */
export function statementFromMonthly(s, memberLabel) {
  return {
    id: s.id,
    kind: 'auto',
    period: s.period,
    createdDate: s.createdDate,
    memberLabel,
    categories: [],
    includeSplits: false,
    total: num(s.total),
    paid: num(s.total),
    pending: null, // the automatic statement only lists what has been paid
    rows: (s.expenses || []).map((e) => ({
      id: e.id,
      title: e.title,
      category: e.category,
      expense_date: e.expense_date,
      share: num(e.user_share),
      paid: num(e.user_share),
      status: 'paid',
    })),
  };
}

// ───────────────────────── PDF ─────────────────────────
// jsPDF's built-in font has no ₱ glyph (it prints as "±"), so the PDF uses "PHP".
const pesoPdf = (v) =>
  `PHP ${num(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function exportReportPdf({ statement, householdName, generatedBy }) {
  const doc = new jsPDF();
  const purple = [59, 42, 171];

  doc.setFontSize(20);
  doc.setTextColor(...purple);
  doc.text('HomeSync Report', 14, 20);

  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Household: ${householdName || ''}`, 14, 30);
  doc.text(`Member: ${statement.memberLabel || 'All Members'}`, 14, 37);
  doc.text(`Period: ${statement.period || ''}`, 14, 44);
  const cats = statement.categories && statement.categories.length ? statement.categories.join(', ') : 'All categories';
  doc.text(`Categories: ${cats}`, 14, 51);
  doc.text(`Generated: ${new Date().toLocaleDateString()}${generatedBy ? ` by ${generatedBy}` : ''}`, 14, 58);

  doc.setFontSize(14);
  doc.setTextColor(...purple);
  doc.text('Summary', 14, 70);

  const hasPending = statement.pending !== null && statement.pending !== undefined;
  autoTable(doc, {
    startY: 74,
    head: [hasPending ? ['Total', 'Paid', 'Pending'] : ['Total Paid']],
    body: [hasPending ? [pesoPdf(statement.total), pesoPdf(statement.paid), pesoPdf(statement.pending)] : [pesoPdf(statement.total)]],
    styles: { font: 'helvetica', fontSize: 10 },
    headStyles: { fillColor: purple },
  });

  doc.setFontSize(14);
  doc.setTextColor(...purple);
  doc.text('Expense Details', 14, doc.lastAutoTable.finalY + 14);
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 18,
    head: [['Title', 'Category', 'Date', 'Share', 'Paid', 'Status']],
    body: statement.rows.map((r) => [r.title, r.category, r.expense_date, pesoPdf(r.share), pesoPdf(r.paid), r.status]),
    styles: { font: 'helvetica', fontSize: 9 },
    headStyles: { fillColor: purple },
  });

  const splitRows = [];
  statement.rows.forEach((r) => (r.splits || []).forEach((s) => {
    splitRows.push([r.title, s.name, pesoPdf(s.share), pesoPdf(s.paid), s.status]);
  }));
  if (splitRows.length) {
    doc.setFontSize(14);
    doc.setTextColor(...purple);
    doc.text('Per-member Split Details', 14, doc.lastAutoTable.finalY + 14);
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 18,
      head: [['Expense', 'Member', 'Share', 'Paid', 'Status']],
      body: splitRows,
      styles: { font: 'helvetica', fontSize: 9 },
      headStyles: { fillColor: purple },
    });
  }

  const safe = (statement.period || 'Report').replace(/[^a-z0-9]+/gi, '-');
  doc.save(`HomeSync-Report-${safe}.pdf`);
}