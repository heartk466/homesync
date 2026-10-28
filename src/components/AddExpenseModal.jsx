import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../supabaseClient';
import DatePickerField from './DatePickerField';
import CategoryField from './CategoryField';
import SelectField from './SelectField';
import { detectCategory } from '../utils/categoryDetection';
import { formatMoney, formatDate } from '../utils/format';
import { notifyPendingChanged } from '../utils/pendingEvents';
import {
  SUBSCRIPTION_PRESETS, UTILITY_SCOPE_CATEGORIES, categoryLabel, isUtilityCategory,
  isBillingCategory, billingPeriodOf, checkDuplicate, getReminderPreview, getMyReminderDays,
} from '../utils/expenseUtils';
import './AddExpenseModal.css';
import { Icon, InlineIcon, CategoryIcon, StatusIcon } from './Icon';
import { ICONS, CATEGORY_ICON, SUBSCRIPTION_ICON, NOTIF_ICON } from '../utils/iconMap';

// Local (device) date as YYYY-MM-DD (toISOString() would be UTC).
const todayStr = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};

const emptyForm = (category, whoPaid) => ({
  title: '', amount: '', category, due_date: '', who_paid: whoPaid,
  split_type: 'equal', selected_members: [], custom_splits: {},
});

// Members (with profiles) of a household, for the household picker.
async function loadHouseholdMembers(householdId) {
  const { data: rows } = await supabase
    .from('household_members')
    .select('user_id, role, status')
    .eq('household_id', householdId)
    .eq('status', 'active');
  const ids = (rows || []).map((m) => m.user_id);
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('id, full_name, avatar_url').in('id', ids)
    : { data: [] };
  return (rows || []).map((m) => ({ ...m, profiles: (profiles || []).find((p) => p.id === m.user_id) || { full_name: 'Member' } }));
}

/**
 * The one "Add Expense" form + submit flow, shared by ExpensesScreen,
 * GroupDetailScreen and UtilitiesScreen.
 *
 * props:
 *   context          { type: 'household' | 'group', id, name, ownerId }
 *   members          that context's members [{ user_id, profiles }] (loaded here when omitted)
 *   householdChoices [{ id, name, created_by }] → household picker as the first field
 *   categories       full category list for this screen ('Other' last)
 *   categoryScope    'utilities' → only utility categories
 *   defaultCategory
 *   currentUser, profile
 *   onOpenExpense    (expense) => void   "Electricity already exists…" link
 *   onAdded          (expense, { paidUpfront, isAdmin, context }) => void
 *   onClose, showToast
 */
export default function AddExpenseModal({
  context, members: membersProp, householdChoices, categories, categoryScope, defaultCategory,
  currentUser, profile, onOpenExpense, onAdded, onClose, showToast,
}) {
  const scoped = categoryScope === 'utilities';
  const categoryList = scoped ? UTILITY_SCOPE_CATEGORIES : categories;
  const startCategory = defaultCategory && categoryList.includes(defaultCategory) ? defaultCategory : categoryList[0];

  const [ctx, setCtx] = useState(context);
  const [loadedMembers, setLoadedMembers] = useState(null);   // { id, list } for a picked household
  const usingProp = membersProp && ctx?.id === context?.id;
  const members = usingProp ? membersProp : (loadedMembers?.id === ctx?.id ? loadedMembers.list : []);
  const isAdmin = !!ctx && ctx.ownerId === currentUser?.id;
  const isSolo = members.length <= 1;

  const [form, setForm] = useState(() => emptyForm(startCategory, context?.ownerId === currentUser?.id ? currentUser?.id : ''));
  const [errors, setErrors] = useState({});
  const [otherType, setOtherType] = useState('');
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [categoryAutoDetected, setCategoryAutoDetected] = useState(false);
  const [billingMonth, setBillingMonth] = useState(() => todayStr().slice(0, 7));
  const [slotConflict, setSlotConflict] = useState(null);
  const [duplicate, setDuplicate] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ctx?.id || usingProp || ctx.type !== 'household') return undefined;
    let alive = true;
    loadHouseholdMembers(ctx.id).then((list) => { if (alive) setLoadedMembers({ id: ctx.id, list }); });
    return () => { alive = false; };
  }, [ctx, usingProp]);

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const pickHousehold = (id) => {
    const h = householdChoices.find((x) => x.id === id);
    if (!h) return;
    setCtx({ type: 'household', id: h.id, name: h.name, ownerId: h.created_by });
    // members differ per household — start the people part over
    set({ who_paid: h.created_by === currentUser?.id ? currentUser.id : '', selected_members: [], custom_splits: {} });
  };

  // Typing in Description picks a matching category — until the user chooses one by hand
  const handleTitleChange = (value) => {
    const hit = categoryTouched ? null : detectCategory(value);
    const usable = hit && categoryList.includes(hit.category) ? hit : null;
    set({ title: value, ...(usable ? { category: usable.category } : {}) });
    if (usable) {
      setCategoryAutoDetected(true);
      setOtherType(usable.category === 'Other' ? (usable.otherType || '') : '');
    }
  };

  const finalCategory = form.category === 'Other' && otherType.trim() ? otherType.trim() : form.category;
  const showPresets = form.category === 'Subscription' || (scoped && form.category === 'Entertainment');

  const validate = () => {
    const e = {};
    if (!ctx?.id) e.household = 'Choose a household';
    if (!form.title.trim()) e.title = 'Title is required';
    if (!form.amount || Number.isNaN(Number(form.amount)) || Number(form.amount) <= 0) e.amount = 'Valid amount is required';
    if (form.due_date && form.due_date < todayStr()) e.due_date = 'Due date cannot be in the past';
    if (!form.who_paid) e.who_paid = 'Please select who paid';
    if (!isSolo && form.selected_members.length === 0) e.members = 'Select at least one member to split with';
    if (slotConflict) e.category = `${slotConflict.category} already exists for this month. Edit that expense instead.`;
    return e;
  };

  const submit = async () => {
    const participants = isSolo ? members.map((m) => m.user_id) : form.selected_members;
    const splitType = isSolo ? 'equal' : form.split_type;
    const payerId = form.who_paid === 'none' ? null : form.who_paid;
    const totalAmount = Number(form.amount);
    const splits = {};
    if (splitType === 'equal') {
      const share = totalAmount / participants.length;
      participants.forEach((id) => { splits[id] = share.toFixed(2); });
    } else {
      let customTotal = 0;
      participants.forEach((id) => {
        const val = Number(form.custom_splits[id]) || 0;
        splits[id] = val.toFixed(2);
        customTotal += val;
      });
      if (Math.abs(customTotal - totalAmount) > 0.01) {
        showToast(`Custom split total (${formatMoney(customTotal)}) does not equal total amount (${formatMoney(totalAmount)})`, 'error');
        return;
      }
    }

    const insertData = {
      [ctx.type === 'household' ? 'household_id' : 'group_id']: ctx.id,
      created_by: currentUser.id,
      title: form.title.trim(),
      amount: totalAmount,
      category: finalCategory,
      expense_type: ctx.type,
      expense_date: todayStr(),                 // auto: the day it was created (not editable)
      billing_period: isBillingCategory(finalCategory) ? billingPeriodOf(billingMonth) : null,
      due_date: form.due_date || null,
      location: ctx.name,
      paid_by: payerId,
      split_type: splitType,
      members_split: splits,
      status: 'pending',
      approval_status: isAdmin ? 'approved' : 'pending_approval',
    };

    const { data: inserted, error } = await supabase.from('expenses').insert(insertData).select().single();
    if (error) { showToast(`Failed to add expense: ${error.message}`, 'error'); return; }

    const link = {
      link_path: `/groups/${ctx.id}?type=${ctx.type}`,
      link_state: JSON.stringify({ type: ctx.type }),
      link_query: `expenseId=${inserted.id}`,
    };

    if (isAdmin) {
      // Owner-created expenses are approved right away: create the split rows now
      // (everyone starts Unpaid) and tell every member who owes a share.
      const { error: splitError } = await supabase.from('expense_splits').upsert(
        participants.map((uid) => ({
          expense_id: inserted.id, user_id: uid, share_amount: Number(splits[uid]),
          status: 'unpaid', updated_at: new Date().toISOString(),
        })),
        { onConflict: 'expense_id,user_id' },
      );
      if (splitError) console.error('Failed to create splits:', splitError);

      const dueText = form.due_date ? ` Due ${formatDate(form.due_date)}.` : '';
      const rows = participants.filter((uid) => uid !== currentUser.id).map((uid) => ({
        user_id: uid,
        title: 'New Expense Added',
        message: `${profile?.full_name} added "${inserted.title}" for ${formatMoney(totalAmount)}. Your share: ${formatMoney(splits[uid])}.${dueText}${!payerId ? ' It is marked unpaid — please upload your proof of payment once you pay your share.' : ''}${uid === form.who_paid && uid !== ctx.ownerId ? ' You are marked as the payer — please upload your proof of payment.' : ''}`,
        type: 'expense_added',
        ...link,
      }));
      if (rows.length) {
        const { error: notifError } = await supabase.from('notifications').insert(rows);
        if (notifError) console.error('Failed to notify members:', notifError);
      }
    } else if (ctx.ownerId) {
      await supabase.from('notifications').insert({
        user_id: ctx.ownerId,
        title: 'New Expense Pending Approval',
        message: `${profile?.full_name} submitted "${inserted.title}" for ${formatMoney(totalAmount)}. Tap to review.`,
        type: 'approval_request',
        ...link,
      });
    }

    notifyPendingChanged();
    onAdded(inserted, { paidUpfront: form.who_paid === currentUser.id, isAdmin, context: ctx });
  };

  const handleAdd = async (skipDuplicateCheck = false) => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) { showToast(Object.values(e)[0], 'error'); return; }
    setSaving(true);
    if (!skipDuplicateCheck && ctx.type === 'household' && isUtilityCategory(form.category)) {
      const dupes = await checkDuplicate(ctx.id, form.category, Number(form.amount), todayStr());
      if (dupes.length) { setDuplicate(dupes[0]); setSaving(false); return; }
    }
    await submit();
    setSaving(false);
  };

  const preview = form.due_date ? getReminderPreview(form.due_date, getMyReminderDays(profile), todayStr()) : [];
  const totalAmt = Number(form.amount) || 0;
  const customTotal = form.selected_members.reduce((sum, uid) => sum + (Number(form.custom_splits[uid]) || 0), 0);
  const remaining = totalAmt - customTotal;

  return (
    <div className="aem-overlay" role="dialog" aria-modal="true" aria-labelledby="aem-title">
      <div className="aem-card">
        <div className="aem-header">
          <h2 id="aem-title">Add Expense{ctx?.name && !householdChoices ? ` · ${ctx.name}` : ''}</h2>
          <button type="button" className="aem-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {duplicate ? (
          <div className="aem-body aem-dup">
            <p className="aem-dup-icon" aria-hidden="true"><Icon as={ICONS.warning} size={30} /></p>
            <h3>Possible duplicate</h3>
            <p>We found a similar entry: “{duplicate.title || duplicate.provider_name}” · {formatMoney(duplicate.amount)} · {formatDate(duplicate.expense_date || duplicate.billing_date)}</p>
            <button type="button" className="aem-submit" disabled={saving} onClick={() => { setDuplicate(null); handleAdd(true); }}>
              {saving ? 'Adding…' : 'Add anyway'}
            </button>
            <button type="button" className="aem-secondary" onClick={() => setDuplicate(null)}>Don’t add — go back</button>
          </div>
        ) : (
          <div className="aem-body">
            {householdChoices && (
              <div className="aem-field">
                <label>Household *</label>
                <SelectField
                  label="Household"
                  options={[{ value: '', label: 'Choose a household' }, ...householdChoices.map((h) => ({ value: h.id, label: h.name }))]}
                  value={ctx?.id || ''}
                  onChange={pickHousehold}
                />
                {errors.household && <span className="aem-error">{errors.household}</span>}
              </div>
            )}

            <div className="aem-field">
              <label htmlFor="aem-desc">Description *</label>
              <input id="aem-desc" className={`aem-input${errors.title ? ' aem-input--error' : ''}`} placeholder="e.g. Electricity bill" value={form.title} onChange={(e) => handleTitleChange(e.target.value)} />
              {errors.title && <span className="aem-error">{errors.title}</span>}
            </div>

            <div className="aem-field">
              <label htmlFor="aem-amount">Amount *</label>
              <div className={`aem-amount${errors.amount ? ' aem-input--error' : ''}`}>
                <span>₱</span>
                <input id="aem-amount" type="number" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
              </div>
              {errors.amount && <span className="aem-error">{errors.amount}</span>}
            </div>

            <div className="aem-field">
              <label>Date</label>
              <DatePickerField value={todayStr()} onChange={() => {}} disabled />
              <span className="aem-hint">Set automatically to today</span>
            </div>

            <div className="aem-field">
              <label>Due Date (optional)</label>
              <DatePickerField value={form.due_date} min={todayStr()} placeholder="Select due date" hasError={!!errors.due_date} onChange={(v) => set({ due_date: v && v < todayStr() ? '' : v })} />
              {errors.due_date && <span className="aem-error">{errors.due_date}</span>}
              {form.due_date && (
                <span className="aem-hint">
                  <InlineIcon as={ICONS.bell} />
                  {preview.length
                    ? `You'll be reminded on ${preview.join(', ')} (from your Settings). Each member is reminded based on their own Settings.`
                    : 'None of your reminder days fall before this due date. Other members are reminded based on their own Settings.'}
                </span>
              )}
            </div>

            <div className="aem-field">
              <label>Category</label>
              <CategoryField
                categories={categoryList}
                labelOf={categoryLabel}
                value={form.category}
                onChange={(c) => {
                  set({ category: c });
                  setCategoryTouched(true);
                  setCategoryAutoDetected(false);
                  if (c !== 'Other') setOtherType('');
                }}
                householdId={ctx?.type === 'household' ? ctx.id : null}
                groupId={ctx?.type === 'group' ? ctx.id : null}
                billingMonth={billingMonth}
                onBillingMonthChange={setBillingMonth}
                onConflictChange={setSlotConflict}
                onOpenExpense={onOpenExpense}
              />
              {categoryAutoDetected && !categoryTouched && <span className="aem-hint"><InlineIcon as={ICONS.sparkle} /> Picked from your description — change it anytime.</span>}
              {form.category === 'Other' && (
                <input
                  className="aem-input"
                  placeholder="Specify type (e.g. Pet supplies, Haircut)"
                  value={otherType}
                  onChange={(e) => { setOtherType(e.target.value); setCategoryTouched(true); setCategoryAutoDetected(false); }}
                />
              )}
            </div>

            {showPresets && (
              <div className="aem-field">
                <label>Quick Select</label>
                <div className="aem-presets">
                  {SUBSCRIPTION_PRESETS.map((p) => (
                    <button key={p.name} type="button" className={`aem-preset${form.title === p.name ? ' active' : ''}`} onClick={() => set({ title: p.name, amount: String(p.suggestedAmount) })}>
                      <Icon as={SUBSCRIPTION_ICON[p.name] || ICONS.payment} size={16} />
                      <span className="aem-preset-name">{p.name}</span>
                      <span className="aem-preset-amt">₱{p.suggestedAmount}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="aem-field">
              <label>Who Paid *</label>
              <SelectField
                label="Who paid"
                options={[
                  { value: '', label: 'Select member' },
                  ...members.map((m) => ({ value: m.user_id, label: m.profiles?.full_name || 'Member', avatar: { url: m.profiles?.avatar_url, name: m.profiles?.full_name } })),
                  { value: 'none', label: 'None — nobody has paid yet' },
                ]}
                value={form.who_paid}
                onChange={(v) => set({ who_paid: v })}
              />
              {errors.who_paid && <span className="aem-error">{errors.who_paid}</span>}
            </div>

            {!isSolo && (
              <>
                <div className="aem-field">
                  <label>Split With *</label>
                  <div className="aem-members">
                    {members.map((m) => (
                      <label key={m.user_id} className="aem-member">
                        <input
                          type="checkbox"
                          checked={form.selected_members.includes(m.user_id)}
                          onChange={(e) => set({
                            selected_members: e.target.checked
                              ? [...form.selected_members, m.user_id]
                              : form.selected_members.filter((id) => id !== m.user_id),
                          })}
                        />
                        {m.profiles?.full_name}
                      </label>
                    ))}
                  </div>
                  {errors.members && <span className="aem-error">{errors.members}</span>}
                </div>

                <div className="aem-field">
                  <label>Split Method</label>
                  <div className="aem-toggle">
                    <button type="button" className={form.split_type === 'equal' ? 'active' : ''} onClick={() => set({ split_type: 'equal' })}>Equal</button>
                    <button type="button" className={form.split_type === 'custom' ? 'active' : ''} onClick={() => set({ split_type: 'custom' })}>Custom</button>
                  </div>
                </div>

                {form.split_type === 'custom' && (
                  <div className="aem-field">
                    <label>Custom Amounts</label>
                    {form.selected_members.map((uid, i) => {
                      const member = members.find((m) => m.user_id === uid);
                      const prevTotal = form.selected_members.slice(0, i).reduce((sum, pid) => sum + (Number(form.custom_splits[pid]) || 0), 0);
                      const thisRemaining = totalAmt - prevTotal;
                      const entered = Number(form.custom_splits[uid]) || 0;
                      return (
                        <div key={uid} className="aem-custom">
                          <div className="aem-custom-head">
                            <span>{member?.profiles?.full_name}</span>
                            {totalAmt > 0 && (
                              <span className="aem-hint">
                                {entered > 0 ? `${formatMoney(thisRemaining - entered)} left after this` : `${formatMoney(thisRemaining)} still needs to be split`}
                              </span>
                            )}
                          </div>
                          <div className="aem-amount aem-amount--small">
                            <span>₱</span>
                            <input type="number" inputMode="decimal" placeholder="0.00" value={form.custom_splits[uid] || ''} onChange={(e) => set({ custom_splits: { ...form.custom_splits, [uid]: e.target.value } })} />
                          </div>
                        </div>
                      );
                    })}
                    {totalAmt > 0 && (
                      <div className={`aem-split-status ${Math.abs(remaining) < 0.01 ? 'ok' : 'off'}`}>
                        {Math.abs(remaining) < 0.01 ? <><InlineIcon as={ICONS.approved} /> Split total matches!</> : `${formatMoney(Math.abs(remaining))} ${remaining > 0 ? 'still unassigned' : 'over budget'}`}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <button type="button" className="aem-submit" onClick={() => handleAdd(false)} disabled={saving}>
              {saving ? 'Adding…' : 'Add Expense'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
