// "Export My Data (PDF)" in Settings: a statement of THIS month only, for every
// household the user belongs to. A new month starts a fresh export, so last
// month's expenses (deleted or not) no longer appear.
//
// Per household:
//   • expenses dated this month — deleted ones included and marked — with the
//     expense total, the user's share, what they paid and the status
//   • payment history this month: payment proofs, follow-up payments,
//     overpayment refunds and deletion refunds the admin sent them
//   • payments a former owner made while they were the owner — no refund is
//     owed for them when the expense is deleted
//   • household name changes this month (approved requests + the owner's own renames)
//   • change trail this month (expense_history): category changes, deleted and
//     recreated expenses — with time, who did it and before / after
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../supabaseClient';
import { deletionStateOf } from './refundsOwed';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const num = (v) => Number(v) || 0;
// jsPDF's built-in font has no ₱ glyph (it prints as "±"), so the PDF uses "PHP".
const php = (v) => `PHP ${num(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shortDate = (s) => (s ? new Date(s).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const inRange = (ts, from, to) => { const d = String(ts || '').slice(0, 10); return d >= from && d <= to; };

const SPLIT_STATUS = { approved: 'Paid', partly_paid: 'Partly paid', pending_verification: 'Verifying', unpaid: 'Unpaid' };
const PROOF_STATUS = { verified: 'Approved', pending_verification: 'Pending review', rejected: 'Rejected' };
const REFUND_STATUS = { sent: 'Awaiting your confirmation', confirmed: 'Received', rejected: 'You rejected it' };
const TRAIL_ACTION = { category_changed: 'Category changed', deleted: 'Expense deleted', recreated: 'Expense recreated' };
const dateTime = (s) => new Date(s).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const describe = (v) => (v ? `${v.title} · ${v.category} · ${php(v.amount)}` : '—');

// Category changes / deletions / recreations in this household this month.
async function loadTrail(householdId, from, to) {
  const { data } = await supabase
    .from('expense_history')
    .select('action, before, after, actor_id, created_at')
    .eq('household_id', householdId)
    .gte('created_at', new Date(`${from}T00:00:00`).toISOString())
    .lte('created_at', new Date(`${to}T23:59:59.999`).toISOString())
    .order('created_at', { ascending: true });
  const rows = data || [];
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))];
  const { data: actors } = actorIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', actorIds)
    : { data: [] };
  const nameOf = Object.fromEntries((actors || []).map((p) => [p.id, p.full_name]));
  return rows.map((r) => ({
    at: r.created_at,
    action: TRAIL_ACTION[r.action] || r.action,
    actor: nameOf[r.actor_id] || 'Someone',
    expense: (r.after || r.before)?.title || 'Expense',
    before: r.action === 'category_changed' ? r.before?.category : describe(r.before),
    after: r.action === 'category_changed' ? r.after?.category
      : r.action === 'deleted' ? 'Deleted' : describe(r.after),
  }));
}

// Approved name changes of this household this month (see household_name_history)
async function loadNameChanges(householdId, from, to) {
  const { data } = await supabase.rpc('household_name_history', { p_household: householdId, p_from: from, p_to: to });
  return (data || []).map((r) => ({
    at: r.changed_at,
    from: r.old_name,
    to: r.new_name,
    how: r.by_owner ? `Renamed by the owner (${r.approved_by_name})` : `Requested by ${r.requested_by_name}, approved by ${r.approved_by_name}`,
  }));
}

async function loadHouseholdData(household, userId, from, to) {
  const [trail, nameChanges] = await Promise.all([loadTrail(household.id, from, to), loadNameChanges(household.id, from, to)]);
  const { data: expenses } = await supabase
    .from('expenses')
    .select('id, title, category, amount, expense_date, approval_status, deleted_at')
    .eq('household_id', household.id)
    .eq('approval_status', 'approved')
    .gte('expense_date', from)
    .lte('expense_date', to)
    .order('expense_date', { ascending: true });
  const ids = (expenses || []).map((e) => e.id);
  if (!ids.length) return { household, expenses: [], history: [], trail, ownerPaid: [], nameChanges };

  const [{ data: splits }, { data: refunds }, { data: followups }, { data: proofs }, { data: ownerSplits }] = await Promise.all([
    supabase.from('expense_splits').select('expense_id, user_id, share_amount, paid_amount, status, paid_as_owner').eq('user_id', userId).in('expense_id', ids),
    supabase.from('expense_refunds').select('expense_id, user_id, amount, status, refund_type, created_at').eq('user_id', userId).in('expense_id', ids),
    supabase.from('expense_followup_proofs').select('expense_id, amount, status, created_at').eq('user_id', userId).in('expense_id', ids),
    supabase.from('payment_proofs').select('expense_id, status, created_at').eq('submitted_by', userId).in('expense_id', ids),
    supabase.from('expense_splits').select('expense_id, user_id, paid_amount, profiles:user_id (full_name)').eq('paid_as_owner', true).in('expense_id', ids),
  ]);

  const splitOf = Object.fromEntries((splits || []).map((s) => [s.expense_id, s]));
  const refundsOf = {};
  (refunds || []).forEach((r) => { (refundsOf[r.expense_id] ||= []).push(r); });
  const byId = Object.fromEntries(expenses.map((e) => [e.id, e]));

  // Only expenses the user has a share in
  const rows = expenses.filter((e) => splitOf[e.id]).map((e) => {
    const split = splitOf[e.id];
    const share = num(split.share_amount);
    const deletion = deletionStateOf(split, refundsOf[e.id]);
    let paid = split.status === 'approved' ? share : Math.min(num(split.paid_amount), share);
    let status = SPLIT_STATUS[split.status] || 'Unpaid';
    if (deletion === 'verifying') { paid = share; status = 'Verifying for deletion'; }
    if (deletion === 'refunded') { paid = 0; status = 'Refunded for deletion'; }
    if (split.paid_as_owner && !deletion) status = `${status} (as owner, no refund)`;
    if (e.deleted_at) status = `Deleted · ${status}`;
    return { expense: e, share, paid, status };
  });

  const history = [
    ...(proofs || []).filter((p) => inRange(p.created_at, from, to)).map((p) => ({
      at: p.created_at, expense: byId[p.expense_id], type: 'Payment proof',
      amount: splitOf[p.expense_id]?.share_amount, status: PROOF_STATUS[p.status] || p.status,
    })),
    ...(followups || []).filter((f) => inRange(f.created_at, from, to)).map((f) => ({
      at: f.created_at, expense: byId[f.expense_id], type: 'Follow-up payment',
      amount: f.amount, status: PROOF_STATUS[f.status] || f.status,
    })),
    ...(refunds || []).filter((r) => inRange(r.created_at, from, to)).map((r) => ({
      at: r.created_at, expense: byId[r.expense_id],
      type: r.refund_type === 'expense_deletion' ? 'Refund for deleted expense' : 'Overpayment refund',
      amount: r.amount, status: REFUND_STATUS[r.status] || r.status,
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  // Former owner's payments from their time as owner (paid to themselves)
  const ownerPaid = (ownerSplits || []).filter((s) => byId[s.expense_id]).map((s) => ({
    expense: byId[s.expense_id],
    name: s.user_id === userId ? 'You' : s.profiles?.full_name || 'Former owner',
    amount: s.paid_amount,
  }));

  return { household, expenses: rows, history, trail, ownerPaid, nameChanges };
}

export async function exportMyMonthlyData({ userId, fullName, email }) {
  const now = new Date();
  const from = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const monthLabel = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

  // Every household the user belongs to
  const { data: memberships } = await supabase
    .from('household_members')
    .select('household_id, role')
    .eq('user_id', userId)
    .eq('status', 'active');
  const householdIds = (memberships || []).map((m) => m.household_id);
  const { data: households } = householdIds.length
    ? await supabase.from('households').select('id, name').in('id', householdIds)
    : { data: [] };
  const roleOf = Object.fromEntries((memberships || []).map((m) => [m.household_id, m.role]));
  const sections = await Promise.all((households || [])
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((h) => loadHouseholdData(h, userId, from, to)));

  // ── PDF ──
  const doc = new jsPDF();
  const purple = [59, 42, 171];
  const pageBottom = doc.internal.pageSize.getHeight() - 20;
  let y = 20;
  const ensureRoom = (needed) => { if (y + needed > pageBottom) { doc.addPage(); y = 20; } };

  doc.setFontSize(20);
  doc.setTextColor(...purple);
  doc.text(`HomeSync — My Data · ${monthLabel}`, 14, y);
  y += 10;
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Name: ${fullName || ''}`, 14, y); y += 6;
  if (email) { doc.text(`Email: ${email}`, 14, y); y += 6; }
  doc.text(`Period: ${shortDate(from)} – ${shortDate(to)}`, 14, y); y += 6;
  doc.text(`Exported: ${now.toLocaleString('en-PH')}`, 14, y); y += 6;
  doc.text(`Households: ${sections.length ? sections.map((s) => s.household.name).join(', ') : 'none'}`, 14, y);
  y += 10;

  // Overall summary
  const all = sections.flatMap((s) => s.expenses);
  const counted = all.filter((r) => !r.expense.deleted_at && r.status !== 'Refunded for deletion');
  autoTable(doc, {
    startY: y,
    head: [['Expenses this month', 'My total share', 'Paid', 'Still to pay']],
    body: [[
      String(all.length),
      php(counted.reduce((a, r) => a + r.share, 0)),
      php(counted.reduce((a, r) => a + r.paid, 0)),
      php(counted.reduce((a, r) => a + Math.max(r.share - r.paid, 0), 0)),
    ]],
    styles: { font: 'helvetica', fontSize: 10 },
    headStyles: { fillColor: purple },
  });
  y = doc.lastAutoTable.finalY + 12;

  sections.forEach((section) => {
    ensureRoom(40);
    doc.setFontSize(15);
    doc.setTextColor(...purple);
    doc.text(`Household: ${section.household.name}`, 14, y);
    doc.setFontSize(10);
    doc.setTextColor(140);
    doc.text(roleOf[section.household.id] === 'owner' ? '(you are the admin)' : '(member)', 14, y + 6);
    y += 12;

    if (!section.expenses.length && !section.history.length && !section.trail.length && !section.ownerPaid.length && !section.nameChanges.length) {
      doc.setFontSize(10);
      doc.setTextColor(120);
      doc.text('No expenses or payments this month.', 14, y);
      y += 12;
      return;
    }

    doc.setFontSize(12);
    doc.setTextColor(...purple);
    doc.text('Expenses', 14, y);
    autoTable(doc, {
      startY: y + 3,
      head: [['Title', 'Category', 'Date', 'Expense total', 'My share', 'I paid', 'Status']],
      body: section.expenses.length
        ? section.expenses.map((r) => [
          r.expense.title, r.expense.category, shortDate(r.expense.expense_date),
          php(r.expense.amount), php(r.share), php(r.paid), r.status,
        ])
        : [[{ content: 'No expenses with a share for you this month.', colSpan: 7 }]],
      styles: { font: 'helvetica', fontSize: 8 },
      headStyles: { fillColor: purple },
      didParseCell: (data) => {
        // deleted expenses in grey
        if (data.section === 'body' && section.expenses[data.row.index]?.expense.deleted_at) data.cell.styles.textColor = [150, 150, 150];
      },
    });
    y = doc.lastAutoTable.finalY + 10;

    ensureRoom(30);
    doc.setFontSize(12);
    doc.setTextColor(...purple);
    doc.text('Payment & refund history', 14, y);
    autoTable(doc, {
      startY: y + 3,
      head: [['Date', 'Expense', 'Type', 'Amount', 'Status']],
      body: section.history.length
        ? section.history.map((h) => [
          shortDate(h.at), `${h.expense?.title || 'Expense'}${h.expense?.deleted_at ? ' (deleted)' : ''}`,
          h.type, h.amount != null ? php(h.amount) : '—', h.status,
        ])
        : [[{ content: 'No payments or refunds this month.', colSpan: 5 }]],
      styles: { font: 'helvetica', fontSize: 8 },
      headStyles: { fillColor: [107, 70, 193] },
    });
    y = doc.lastAutoTable.finalY + 10;

    if (section.nameChanges.length) {
      ensureRoom(30);
      doc.setFontSize(12);
      doc.setTextColor(...purple);
      doc.text('Household name changes', 14, y);
      autoTable(doc, {
        startY: y + 3,
        head: [['When', 'Old name', 'New name', 'How']],
        body: section.nameChanges.map((n) => [dateTime(n.at), n.from, n.to, n.how]),
        styles: { font: 'helvetica', fontSize: 8 },
        headStyles: { fillColor: [107, 70, 193] },
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    if (section.ownerPaid.length) {
      ensureRoom(30);
      doc.setFontSize(12);
      doc.setTextColor(...purple);
      doc.text('Paid by the former owner while owner (no refund needed)', 14, y);
      autoTable(doc, {
        startY: y + 3,
        head: [['Expense', 'Date', 'Former owner', 'Paid', 'Refund on deletion']],
        body: section.ownerPaid.map((o) => [
          `${o.expense.title}${o.expense.deleted_at ? ' (deleted)' : ''}`, shortDate(o.expense.expense_date),
          o.name, php(o.amount), 'Not needed — paid to themselves as owner',
        ]),
        styles: { font: 'helvetica', fontSize: 8 },
        headStyles: { fillColor: [107, 70, 193] },
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    ensureRoom(30);
    doc.setFontSize(12);
    doc.setTextColor(...purple);
    doc.text('Category, deletion & recreation history', 14, y);
    autoTable(doc, {
      startY: y + 3,
      head: [['When', 'Expense', 'Change', 'By', 'Before', 'After']],
      body: section.trail.length
        ? section.trail.map((t) => [dateTime(t.at), t.expense, t.action, t.actor, t.before || '—', t.after || '—'])
        : [[{ content: 'No category changes, deletions or recreations this month.', colSpan: 6 }]],
      styles: { font: 'helvetica', fontSize: 8 },
      headStyles: { fillColor: [107, 70, 193] },
    });
    y = doc.lastAutoTable.finalY + 14;
  });

  const safeName = (fullName || 'Me').replace(/[\\/:*?"<>|]+/g, '').trim();
  doc.save(`HomeSync MyData (${safeName}) for the month of ${monthLabel}.pdf`);
}
