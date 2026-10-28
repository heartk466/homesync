// Report helpers: build a report from filters, label periods, convert saved
// reports for the detail modal, and export a PDF. Used by ReportsScreen.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { owedRefundOf, deletionStateOf } from './refundsOwed';

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

/**
 * Overpayment refunds still owed on one expense, as report rows keep them:
 * [{ user_id, name, amount }]. A report for the whole household or for the
 * owner lists every overpaid member ("Needs refund"); a member's report only
 * their own ("Refund still needed"). The owner's own share never needs one.
 */
export function refundsForExpense(splits, scopeId, ownerId, memberNames = {}, refunds = []) {
  const everyone = scopeId === 'all' || scopeId === ownerId;
  return (splits || [])
    .filter((s) => s.user_id !== ownerId && (everyone || s.user_id === scopeId))
    .map((s) => ({ user_id: s.user_id, name: memberNames[s.user_id] || null, ...owedRefundOf(s, refunds) }))
    .filter((f) => f.amount > 0);
}

/** Every refund line in a statement, with the expense it belongs to. */
export const statementRefunds = (rows) =>
  (rows || []).flatMap((r) => (r.refunds || []).map((f) => ({ ...f, expense_id: r.id, title: r.title, expense_date: r.expense_date })));

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
export function computeReport({ expenses, splitsMap, memberId, categories, includeSplits, memberNames, ownerId, refundsMap = {}, deletionMap = {} }) {
  const catSet = categories && categories.length ? new Set(categories) : null;
  const rows = [];

  expenses.forEach((e) => {
    if (catSet && !catSet.has(e.category)) return;
    const splits = splitsMap[e.id] || [];
    // Deletion refund sent → still counts as paid ('verifying for deletion');
    // confirmed → settled and left out of the totals ('refunded for deletion').
    const info = splits.map((s) => {
      const deletion = deletionStateOf(s, deletionMap[e.id]);
      const share = r2(s.share_amount);
      if (deletion === 'verifying') return { user_id: s.user_id, name: memberNames[s.user_id] || 'Member', share, paid: share, status: 'verifying for deletion' };
      if (deletion === 'refunded') return { user_id: s.user_id, name: memberNames[s.user_id] || 'Member', share, paid: 0, status: 'refunded for deletion', settled: true };
      return { user_id: s.user_id, name: memberNames[s.user_id] || 'Member', share, paid: r2(paidOfSplit(s)), status: memberStatusLabel(s.status) };
    });

    let share;
    let paid;
    let status;
    let excluded = false;
    if (memberId === 'all') {
      const live = info.filter((s) => !s.settled);
      share = r2(num(e.amount) - info.filter((s) => s.settled).reduce((a, s) => a + s.share, 0));
      paid = r2(live.reduce((a, s) => a + s.paid, 0));
      status = info.length > 0 && info.every((s) => s.settled) ? 'refunded for deletion'
        : live.length > 0 && live.every((s) => s.status === 'paid' || s.status === 'verifying for deletion') ? 'paid'
          : paid > 0 ? 'partly paid' : 'pending';
    } else {
      const mine = info.find((s) => s.user_id === memberId);
      if (mine) {
        share = mine.share;
        paid = mine.paid;
        status = mine.status;
        excluded = !!mine.settled;
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
      ...(excluded ? { excluded: true } : {}),
    };
    if (includeSplits) row.splits = info;
    const refunds = refundsForExpense(splits, memberId, ownerId, memberNames, refundsMap[e.id]);
    if (refunds.length) row.refunds = refunds;
    rows.push(row);
  });

  rows.sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)));
  // refunded-for-deletion rows are listed but don't count (the money went back)
  const counted = rows.filter((r) => !r.excluded);
  const total = r2(counted.reduce((a, r) => a + r.share, 0));
  const paid = r2(counted.reduce((a, r) => a + r.paid, 0));
  const pending = r2(counted.reduce((a, r) => a + Math.max(r.share - r.paid, 0), 0));
  const refundTotal = r2(statementRefunds(rows).reduce((a, f) => a + f.amount, 0));
  return { rows, total, paid, pending, refundTotal, count: rows.length };
}

// ───────────────────────── refunded for deletion ─────────────────────────
// Deletion refunds the member confirmed are saved inside the report's rows as
// { entry: 'deletion_refund', ... } (the expense itself may already be deleted),
// so no extra column is needed. splitReportRows separates them again.
export const toDeletionRefundEntries = (list) => (list || []).map((f) => ({ entry: 'deletion_refund', ...f }));
// Same for overpayment refunds the member confirmed ("Refunded for overpaid expense").
export const toOverpaidRefundEntries = (list) => (list || []).map((f) => ({ entry: 'overpaid_refund', ...f }));

export function splitReportRows(allRows) {
  const list = Array.isArray(allRows) ? allRows : [];
  return {
    rows: list.filter((r) => !r.entry),
    deletionRefunds: list.filter((r) => r.entry === 'deletion_refund'),
    overpaidRefunds: list.filter((r) => r.entry === 'overpaid_refund'),
  };
}

// ───────────────────────── shapes for the screen ─────────────────────────
/** A saved generated_reports row -> the statement object the detail modal / PDF use. */
export function statementFromReport(rep, memberNames = {}) {
  const { rows, deletionRefunds, overpaidRefunds } = splitReportRows(rep.rows);
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
    refunds: statementRefunds(rows),
    deletionRefunds,
    overpaidRefunds,
  };
}

/** The automatic monthly statement (paid amounts only) -> same shape. */
export function statementFromMonthly(s, memberLabel) {
  const rows = (s.expenses || []).map((e) => ({
    id: e.id,
    title: e.title,
    category: e.category,
    expense_date: e.expense_date,
    share: num(e.user_share),
    paid: num(e.user_share),
    status: 'paid',
    ...(e.refunds?.length ? { refunds: e.refunds } : {}),
  }));
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
    rows,
    refunds: statementRefunds(rows),
  };
}

// ───────────────────────── PDF ─────────────────────────
// jsPDF's built-in font has no ₱ glyph (it prints as "±"), so the PDF uses "PHP".
const pesoPdf = (v) =>
  `PHP ${num(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function exportReportPdf({ statement, householdName, generatedBy, refundLabel = 'Needs refund' }) {
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

  // Overpayment refunds still owed ("Needs refund" for the admin, "Refund still needed" for a member)
  const refunds = statement.refunds || statementRefunds(statement.rows);
  if (refunds.length) {
    const refundTotal = refunds.reduce((a, f) => a + num(f.amount), 0);
    doc.setFontSize(14);
    doc.setTextColor(...purple);
    doc.text(`${refundLabel} (${pesoPdf(refundTotal)})`, 14, doc.lastAutoTable.finalY + 14);
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 18,
      head: [['Expense', 'Date', 'Member', 'Overpaid', 'Status']],
      body: refunds.map((f) => [f.title, f.expense_date, f.name || 'Member', pesoPdf(f.amount), refundLabel]),
      styles: { font: 'helvetica', fontSize: 9 },
      headStyles: { fillColor: [43, 108, 176] },
    });
  }

  // Deletion refunds the member approved ("Refunded for deletion of expense")
  const deletionRefunds = statement.deletionRefunds || [];
  if (deletionRefunds.length) {
    const deletionTotal = deletionRefunds.reduce((a, f) => a + num(f.amount), 0);
    doc.setFontSize(14);
    doc.setTextColor(...purple);
    doc.text(`Refunded for deletion of expense (${pesoPdf(deletionTotal)})`, 14, doc.lastAutoTable.finalY + 14);
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 18,
      head: [['Expense', 'Date', 'Member', 'Refunded']],
      body: deletionRefunds.map((f) => [f.title, f.expense_date, f.name || 'Member', pesoPdf(f.amount)]),
      styles: { font: 'helvetica', fontSize: 9 },
      headStyles: { fillColor: [107, 70, 193] },
    });
  }

  // Overpayment refunds the member approved ("Refunded for overpaid expense")
  const overpaidRefunds = statement.overpaidRefunds || [];
  if (overpaidRefunds.length) {
    const overpaidTotal = overpaidRefunds.reduce((a, f) => a + num(f.amount), 0);
    doc.setFontSize(14);
    doc.setTextColor(...purple);
    doc.text(`Refunded for overpaid expense (${pesoPdf(overpaidTotal)})`, 14, doc.lastAutoTable.finalY + 14);
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 18,
      head: [['Expense', 'Date', 'Member', 'Refunded']],
      body: overpaidRefunds.map((f) => [f.title, f.expense_date, f.name || 'Member', pesoPdf(f.amount)]),
      styles: { font: 'helvetica', fontSize: 9 },
      headStyles: { fillColor: [107, 70, 193] },
    });
  }

  const safe = (statement.period || 'Report').replace(/[^a-z0-9]+/gi, '-');
  doc.save(`HomeSync-Report-${safe}.pdf`);
}