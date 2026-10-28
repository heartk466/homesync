import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Home, Copy, Check, Share2, ChevronRight, ChevronDown, AlertCircle, X, UserMinus, Crown, ExternalLink, Pencil, Eye, EyeOff,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { formatMoney } from '../utils/format';
import './HouseholdsSection.css';
import { Icon, InlineIcon, CategoryIcon, StatusIcon } from './Icon';
import { ICONS, CATEGORY_ICON, SUBSCRIPTION_ICON, NOTIF_ICON } from '../utils/iconMap';

const initialsOf = (name) => (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

// One blocker row → where to fix it (the Expenses screen opens / pulses the item)
const blockerLink = (householdId, b) => {
  const base = `/expenses?householdId=${householdId}&expenseId=${b.expense_id}`;
  if (b.proof_id) return `${base}&proofId=${b.proof_id}`;
  if (b.refund_id) return `${base}&refundId=${b.refund_id}`;
  return base;
};
// `who` = the member being removed (owner's view); omitted = you, leaving yourself
const blockerText = (b, who) => {
  if (who) {
    const first = who.split(' ')[0];
    if (b.kind === 'unpaid_share') return `${first} still owes ${formatMoney(b.amount)} for "${b.title}"`;
    if (b.kind === 'refund_review') return `${first} hasn't confirmed your ${formatMoney(b.amount)} refund for "${b.title}"`;
    return `${b.member}'s payment proof for "${b.title}" is waiting for review`;
  }
  if (b.kind === 'unpaid_share') return `Pay your ${formatMoney(b.amount)} share of "${b.title}"`;
  if (b.kind === 'proof_review') return `Review ${b.member}'s ${b.followup_id ? 'follow-up ' : ''}payment proof for "${b.title}"`;
  return `Confirm or reject the ${formatMoney(b.amount)} refund for "${b.title}"`;
};

// Second verification, same as the household screen: email accounts type their
// password; Google-style accounts (no password) type the household's name.
const canUsePasswordFor = (user) => {
  const providers = user?.app_metadata?.providers || (user?.app_metadata?.provider ? [user.app_metadata.provider] : []);
  return providers.includes('email') && !!user?.email;
};
async function verifyIdentity(user, secret, householdName) {
  if (canUsePasswordFor(user)) {
    const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: secret });
    return error ? 'Incorrect password. Please try again.' : null;
  }
  return secret.trim() === householdName ? null : `Type “${householdName}” exactly to confirm`;
}

function VerifyField({ user, householdName, value, onChange, error }) {
  const [show, setShow] = useState(false);
  const usePassword = canUsePasswordFor(user);
  return (
    <div className="hs-verify">
      <label className="rn-label" htmlFor="hs-verify-input">
        {usePassword ? 'Enter your password to confirm' : `Type “${householdName}” to confirm`}
      </label>
      <div className="hs-verify-row">
        <input
          id="hs-verify-input"
          className="rn-input"
          type={usePassword && !show ? 'password' : 'text'}
          autoComplete={usePassword ? 'current-password' : 'off'}
          placeholder={usePassword ? 'Your password' : householdName}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {usePassword && (
          <button type="button" className="hs-verify-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {error && <span className="rn-error">{error}</span>}
    </div>
  );
}

function BlockerList({ householdId, blockers, onGo, who }) {
  return (
    <ul className="hs-blockers">
      {blockers.map((b, i) => (
        <li key={`${b.kind}-${b.expense_id}-${b.proof_id || b.refund_id || b.followup_id || i}`}>
          <span className="hs-blocker-dot" aria-hidden="true" />
          <span className="hs-blocker-text">{blockerText(b, who)}</span>
          <button type="button" className="hs-blocker-link" onClick={() => onGo(blockerLink(householdId, b))}>
            {who ? 'View' : 'Fix'} <ExternalLink size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Remove member" from the owner's view: the blockers (what they still owe /
 * what's waiting for review) with View links, or the confirm step when there
 * are none. Shared by Settings → Manage Members and the household screen.
 *   blockers: rows from household_leave_blockers(household, member)
 */
export function RemoveMemberModal({ householdId, householdName, member, blockers, busy, onGo, onConfirm, onClose, overlayClassName = 'settings-modal-overlay' }) {
  return (
    <div className={overlayClassName}>
      <div className="settings-modal">
        <AlertCircle size={40} color="#e53e3e"/>
        <h2>{blockers.length ? `Can’t remove ${member.full_name} yet` : `Remove ${member.full_name}?`}</h2>
        {blockers.length ? (
          <>
            <p className="modal-msg">These need to be settled first:</p>
            <BlockerList householdId={householdId} blockers={blockers} onGo={onGo} who={member.full_name} />
          </>
        ) : (
          <p className="modal-msg">Their past expenses, payments and proofs stay in "{householdName}" and they'll show as a former member.</p>
        )}
        {!blockers.length && (
          <button className="modal-danger-btn" disabled={busy} onClick={onConfirm}>
            {busy ? 'Removing...' : 'Yes, Remove'}
          </button>
        )}
        <button className="modal-ghost-btn" onClick={onClose}>{blockers.length ? 'Close' : 'Cancel'}</button>
      </div>
    </div>
  );
}

/**
 * Settings → every household I'm in, each with its own role badge and actions:
 *   member  → Leave (blocked by unpaid shares / pending reviews) · claim
 *             ownership when the owner has been inactive 30+ days
 *   owner   → Edit name · Manage members · Transfer ownership · Leave
 *             (blocked until ownership is transferred) or Delete household
 *             when they are the only member
 * Ownership requests (transfer accept/decline, claim votes) show on the card.
 * Every action is an RPC — the backend enforces the same rules.
 */
export default function HouseholdsSection({ currentUser, showToast, onChanged }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [households, setHouseholds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [modal, setModal] = useState(null);   // { type, household, ... }
  const [expanded, setExpanded] = useState({});   // household id → open (2+ households)
  const highlightId = new URLSearchParams(location.search).get('ownership');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_households_overview');
    if (error) { console.error('households overview failed:', error); return; }
    setHouseholds(data || []);
  }, []);

  /* eslint-disable-next-line react-hooks/set-state-in-effect */
  useEffect(() => { void load(); }, [load]);

  // Ownership notification (?ownership=<request id>):
  //   still pending → open that household, scroll to the request box and pulse it
  //   already handled → open the household card, pulse it, and say what happened
  const jumpRef = useRef(null);
  useEffect(() => {
    if (!highlightId) { jumpRef.current = null; return; }   // link cleared → the next tap counts again
    if (jumpRef.current === highlightId) return;
    jumpRef.current = highlightId;
    (async () => {
      const [{ data: list }, { data: req }] = await Promise.all([
        supabase.rpc('my_households_overview'),
        supabase.from('household_ownership_requests')
          .select('id, household_id, kind, status, to_user, from_user')
          .eq('id', highlightId)
          .maybeSingle(),
      ]);
      const fresh = list || [];
      setHouseholds(fresh);
      navigate('/settings', { replace: true });
      if (!req) { showToast('This request is no longer available.', 'error'); return; }

      const hh = fresh.find((x) => x.id === req.household_id);
      const pending = req.status === 'pending' && !!hh?.requests.some((r) => r.id === req.id);
      if (hh) setExpanded((prev) => ({ ...prev, [hh.id]: true }));
      if (!pending) {
        const name = hh?.name ? `"${hh.name}"` : 'the household';
        const mine = req.to_user === currentUser.id;
        const sentByMe = req.from_user === currentUser.id && req.kind === 'transfer';
        const toName = hh?.members.find((m) => m.user_id === req.to_user)?.full_name || 'The member';
        const message = {
          accepted: mine ? `You already accepted this request — you're the new owner of ${name}.` : `This request was accepted — ${name} has a new owner.`,
          declined: mine
            ? (req.kind === 'claim' ? 'Most members voted against your ownership request.' : 'You already declined this request.')
            : sentByMe ? `${toName} declined — you're still the owner of ${name}.` : 'This request was declined.',
          expired: 'This request expired after 7 days.',
          cancelled: 'This request was cancelled.',
        }[req.status] || 'This request was already handled.';
        showToast(message, req.status === 'accepted' ? 'success' : 'error');
      }
      // after the card has opened
      setTimeout(() => {
        const el = document.getElementById(pending ? `hs-request-${req.id}` : `hs-card-${req.household_id}`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('hs-pulse');
        setTimeout(() => el.classList.remove('hs-pulse'), 3600);
      }, 80);
    })();
  }, [highlightId, navigate, showToast, currentUser.id]);

  const run = async (fn, okMessage) => {
    setBusy(true);
    try {
      const { error } = await fn();
      if (error) throw error;
      if (okMessage) showToast(okMessage);
      setModal(null);
      await load();
      onChanged?.();
    } catch (err) {
      showToast(err.message || 'Something went wrong', 'error');
    }
    setBusy(false);
  };

  const copyCode = (h) => {
    navigator.clipboard.writeText(h.code || '');
    setCopiedId(h.id);
    setTimeout(() => setCopiedId(null), 2000);
    showToast('Household code copied!');
  };
  const shareCode = async (h) => {
    const text = `Join "${h.name}" on HomeSync! Code: ${h.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Join my household', text }); } catch { copyCode(h); }
    } else copyCode(h);
  };

  // Leave: check blockers first, then confirm
  const openLeave = async (h) => {
    setBusy(true);
    const { data, error } = await supabase.rpc('household_leave_blockers', { p_household: h.id, p_user: currentUser.id });
    setBusy(false);
    if (error) { showToast(error.message, 'error'); return; }
    setModal({ type: 'leave', household: h, blockers: data || [] });
  };

  const openRemove = async (h, member) => {
    setBusy(true);
    const { data, error } = await supabase.rpc('household_leave_blockers', { p_household: h.id, p_user: member.user_id });
    setBusy(false);
    if (error) { showToast(error.message, 'error'); return; }
    setModal({ type: 'remove', household: h, member, blockers: data || [] });
  };

  const go = (path) => { setModal(null); navigate(path); };

  const confirmLeave = async () => {
    setBusy(true);
    const verifyError = await verifyIdentity(currentUser, modal.secret || '', modal.household.name);
    if (verifyError) { setModal({ ...modal, error: verifyError }); setBusy(false); return; }
    setBusy(false);
    await run(() => supabase.rpc('leave_household', { p_household: modal.household.id }), 'You left the household');
  };

  // Rename: edit → confirm (+ password), then notify everyone — like the household screen
  const confirmRename = async () => {
    const h = modal.household;
    const newName = modal.name.trim();
    setBusy(true);
    const verifyError = await verifyIdentity(currentUser, modal.secret, h.name);
    if (verifyError) { setModal({ ...modal, error: verifyError }); setBusy(false); return; }
    const { error } = await supabase.from('households').update({ name: newName }).eq('id', h.id);
    if (error) { setModal({ ...modal, error: 'Could not change the name. Please try again.' }); setBusy(false); return; }
    // keep the name shown on older expenses in sync (best effort)
    await supabase.from('expenses').update({ location: newName }).eq('household_id', h.id).eq('location', h.name);
    // logged for the "Export My Data" name history (best effort)
    await supabase.from('name_change_requests').insert({
      household_id: h.id, requested_by: currentUser.id, old_name: h.name, new_name: newName,
      status: 'approved', resolved_by: currentUser.id, resolved_at: new Date().toISOString(),
    });
    const rows = h.members.filter((m) => m.user_id !== currentUser.id).map((m) => ({
      user_id: m.user_id,
      title: 'Household renamed',
      message: `${h.members.find((x) => x.user_id === currentUser.id)?.full_name || 'The owner'} renamed "${h.name}" to "${newName}".`,
      type: 'name_changed',
      link_path: `/groups/${h.id}?type=household`,
      link_state: JSON.stringify({ type: 'household' }),
    }));
    if (rows.length) await supabase.from('notifications').insert(rows);
    showToast('Household name changed');
    setModal(null);
    setBusy(false);
    await load();
    onChanged?.();
  };

  const confirmDelete = async () => {
    setBusy(true);
    const verifyError = await verifyIdentity(currentUser, modal.secret, modal.household.name);
    if (verifyError) { setModal({ ...modal, error: verifyError }); setBusy(false); return; }
    setBusy(false);
    await run(() => supabase.rpc('delete_household', { p_household: modal.household.id }), 'Household deleted.');
  };

  if (!households.length) return null;

  return (
    <>
      {households.length > 1 && (
        <p className="hs-group-title"><Home size={16}/> Households <span>({households.length})</span></p>
      )}
      {households.map((h, index) => {
        const isOwner = h.role === 'owner';
        const others = h.members.filter((m) => m.user_id !== currentUser.id);
        const soleMember = others.length === 0;
        const transfer = h.requests.find((r) => r.kind === 'transfer');
        const claim = h.requests.find((r) => r.kind === 'claim');
        const incoming = transfer && transfer.to_user === currentUser.id ? transfer : null;
        const collapsible = households.length > 1;
        const open = !collapsible || (expanded[h.id] ?? index === 0);
        const needsMe = !!incoming || (claim && !isOwner && claim.to_user !== currentUser.id && claim.my_vote == null);
        const bodyId = `hs-body-${h.id}`;
        return (
          <div key={h.id} id={`hs-card-${h.id}`} className={`settings-section hs-card${collapsible ? ' hs-collapsible' : ''}`}>
            {collapsible ? (
              <button
                type="button"
                className="hs-head"
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() => setExpanded((prev) => ({ ...prev, [h.id]: !open }))}
              >
                <span className="hs-head-name"><InlineIcon as={ICONS.household} /> {h.name}</span>
                {needsMe && <span className="hs-head-dot" role="status" aria-label="Needs your response" />}
                <span className={`hs-role hs-role--${h.role}`}>{isOwner ? <><InlineIcon as={ICONS.owner} /> Owner</> : <><InlineIcon as={ICONS.member} /> Member</>}</span>
                <ChevronDown size={16} className={`hs-head-chevron${open ? ' open' : ''}`} aria-hidden="true" />
              </button>
            ) : (
              <div className="hs-title-row">
                <p className="settings-section-title"><Home size={16}/> Household</p>
                <span className={`hs-role hs-role--${h.role}`}>{isOwner ? <><InlineIcon as={ICONS.owner} /> Owner</> : <><InlineIcon as={ICONS.member} /> Member</>}</span>
              </div>
            )}

            {open && (
            <div id={bodyId} className={collapsible ? 'hs-body' : undefined}>
            <div className="settings-household-info">
              {!collapsible && <p className="household-name-display"><InlineIcon as={ICONS.household} /> {h.name}</p>}
              <div className="household-code-row">
                <span className="household-code-label">Code:</span>
                <span className="household-code-value">{h.code}</span>
                <button className="code-action-btn" onClick={() => copyCode(h)} title="Copy code" aria-label="Copy code">
                  {copiedId === h.id ? <Check size={14}/> : <Copy size={14}/>}
                </button>
                <button className="code-action-btn" onClick={() => shareCode(h)} title="Share code" aria-label="Share code">
                  <Share2 size={14}/>
                </button>
              </div>
              {!isOwner && <p className="hs-owner-line">Owner: {h.owner_name || 'Unknown'}{h.owner_inactive ? ' · inactive 30+ days' : ''}</p>}
            </div>

            {/* Ownership requests on this household */}
            {incoming && (
              <div className="hs-request" id={`hs-request-${incoming.id}`}>
                <p><strong>{h.owner_name}</strong> wants to make you the owner. You'll approve payments, manage members and settings, and members will pay you.</p>
                <div className="hs-request-actions">
                  <button className="modal-primary-btn" disabled={busy} onClick={() => run(() => supabase.rpc('respond_ownership_request', { p_request: incoming.id, p_accept: true }), 'You are now the owner')}>Accept</button>
                  <button className="modal-ghost-btn" disabled={busy} onClick={() => run(() => supabase.rpc('respond_ownership_request', { p_request: incoming.id, p_accept: false }), 'Request declined')}>Decline</button>
                </div>
                <p className="hs-request-meta">Expires {new Date(transfer.expires_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</p>
              </div>
            )}
            {transfer && isOwner && (
              <div className="hs-request" id={`hs-request-${transfer.id}`}>
                <p>Waiting for <strong>{transfer.to_name}</strong> to accept ownership. You stay the owner until then.</p>
                <div className="hs-request-actions">
                  <button className="modal-ghost-btn" disabled={busy} onClick={() => run(() => supabase.rpc('cancel_ownership_request', { p_request: transfer.id }), 'Transfer request cancelled')}>Cancel request</button>
                </div>
                <p className="hs-request-meta">Expires {new Date(transfer.expires_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</p>
              </div>
            )}
            {claim && (
              <div className="hs-request" id={`hs-request-${claim.id}`}>
                <p>
                  {claim.to_user === currentUser.id ? 'You asked' : <><strong>{claim.to_name}</strong> asked</>} to become the owner (owner inactive 30+ days).
                  {' '}{claim.yes} of {claim.voters} member{claim.voters === 1 ? '' : 's'} approved — needs more than half.
                </p>
                <div className="hs-request-actions">
                  {isOwner ? (
                    <button className="modal-ghost-btn" disabled={busy} onClick={() => run(() => supabase.rpc('cancel_ownership_request', { p_request: claim.id }), 'Request cancelled — you stay the owner')}>I'm still here — cancel it</button>
                  ) : claim.to_user === currentUser.id ? (
                    <button className="modal-ghost-btn" disabled={busy} onClick={() => run(() => supabase.rpc('cancel_ownership_request', { p_request: claim.id }), 'Request withdrawn')}>Withdraw</button>
                  ) : (
                    <>
                      <button className={`modal-primary-btn${claim.my_vote === true ? ' hs-voted' : ''}`} disabled={busy} onClick={() => run(() => supabase.rpc('vote_ownership_claim', { p_request: claim.id, p_approve: true }), 'Vote saved')}>Approve</button>
                      <button className={`modal-ghost-btn${claim.my_vote === false ? ' hs-voted' : ''}`} disabled={busy} onClick={() => run(() => supabase.rpc('vote_ownership_claim', { p_request: claim.id, p_approve: false }), 'Vote saved')}>Reject</button>
                    </>
                  )}
                </div>
              </div>
            )}

            {isOwner && (
              <>
                <button className="settings-row" onClick={() => setModal({ type: 'rename', household: h, name: h.name, step: 'edit', secret: '', error: '' })}>
                  <div className="settings-row-left"><div className="settings-icon-wrap purple"><Icon as={ICONS.edit} /></div><span>Edit Household Name</span></div>
                  <ChevronRight size={16}/>
                </button>
                <button className="settings-row" onClick={() => setModal({ type: 'members', household: h })}>
                  <div className="settings-row-left"><div className="settings-icon-wrap purple"><Icon as={ICONS.members} /></div><span>Manage Members</span></div>
                  <ChevronRight size={16}/>
                </button>
                {!soleMember && (
                  <button className="settings-row" onClick={() => setModal({ type: 'transfer', household: h, target: '' })}>
                    <div className="settings-row-left"><div className="settings-icon-wrap yellow"><Icon as={ICONS.owner} /></div><span>Transfer Ownership</span></div>
                    <ChevronRight size={16}/>
                  </button>
                )}
              </>
            )}

            {!isOwner && h.owner_inactive && !claim && (
              <button className="settings-row" disabled={busy} onClick={() => run(() => supabase.rpc('request_ownership_claim', { p_household: h.id }), 'Request sent — members will vote')}>
                <div className="settings-row-left"><div className="settings-icon-wrap yellow"><Icon as={ICONS.vote} /></div><span>Request ownership (owner inactive)</span></div>
                <ChevronRight size={16}/>
              </button>
            )}

            {isOwner && soleMember ? (
              <button className="settings-row danger" onClick={() => setModal({ type: 'delete', household: h, secret: '', error: '' })}>
                <div className="settings-row-left"><div className="settings-icon-wrap red"><Icon as={ICONS.delete} /></div><span>Delete Household</span></div>
                <ChevronRight size={16}/>
              </button>
            ) : isOwner ? (
              <div className="settings-row danger hs-disabled" aria-disabled="true">
                <div className="settings-row-left">
                  <div className="settings-icon-wrap red"><Icon as={ICONS.leave} /></div>
                  <span>Leave Household<small className="hs-row-hint">Transfer ownership first — the new owner must accept</small></span>
                </div>
              </div>
            ) : (
              <button className="settings-row danger" disabled={busy} onClick={() => openLeave(h)}>
                <div className="settings-row-left"><div className="settings-icon-wrap red"><Icon as={ICONS.leave} /></div><span>Leave Household</span></div>
                <ChevronRight size={16}/>
              </button>
            )}
            </div>
            )}
          </div>
        );
      })}

      {/* ── Modals (existing Settings modal styles) ── */}
      {modal?.type === 'leave' && (
        <div className="settings-modal-overlay">
          <div className="settings-modal">
            <AlertCircle size={40} color="#e53e3e"/>
            <h2>{modal.blockers.length ? 'You can’t leave yet' : 'Are you sure you want to leave this household?'}</h2>
            {modal.blockers.length ? (
              <>
                <p className="modal-msg">Settle these in "{modal.household.name}" first:</p>
                <BlockerList householdId={modal.household.id} blockers={modal.blockers} onGo={go} />
              </>
            ) : (
              <>
                <p className="modal-msg">
                  You'll leave "{modal.household.name}". Your past expenses, payments and proofs stay in the household and you'll show as a former member. Your payment details are no longer shared with it. To come back you'd need the invite code again.
                </p>
                {/* Second verification so a mis-tap can't remove you */}
                <VerifyField
                  user={currentUser}
                  householdName={modal.household.name}
                  value={modal.secret || ''}
                  error={modal.error}
                  onChange={(v) => setModal({ ...modal, secret: v, error: '' })}
                />
              </>
            )}
            {!modal.blockers.length && (
              <button className="modal-danger-btn" disabled={busy || !(modal.secret || '').trim()} onClick={confirmLeave}>
                {busy ? 'Leaving...' : 'Yes, Leave'}
              </button>
            )}
            <button className="modal-ghost-btn" onClick={() => setModal(null)}>{modal.blockers.length ? 'Close' : 'Cancel'}</button>
          </div>
        </div>
      )}

      {modal?.type === 'delete' && (
        <div className="settings-modal-overlay">
          <div className="settings-modal">
            <AlertCircle size={40} color="#e53e3e"/>
            <h2>Delete Household?</h2>
            <p className="modal-msg">You're the only member. This permanently deletes "{modal.household.name}" and all its expenses. This cannot be undone.</p>
            <VerifyField
              user={currentUser}
              householdName={modal.household.name}
              value={modal.secret}
              error={modal.error}
              onChange={(v) => setModal({ ...modal, secret: v, error: '' })}
            />
            <button className="modal-danger-btn" disabled={busy || !modal.secret.trim()} onClick={confirmDelete}>
              {busy ? 'Deleting...' : 'Yes, Delete Household'}
            </button>
            <button className="modal-ghost-btn" onClick={() => setModal(null)}>Cancel</button>
          </div>
        </div>
      )}

      {modal?.type === 'rename' && (() => {
        const trimmed = modal.name.trim();
        const invalid = trimmed.length < 2 ? 'Name must be at least 2 characters'
          : trimmed === modal.household.name ? 'Enter a different name' : '';
        return (
          <div className="settings-modal-overlay" onClick={() => !busy && setModal(null)}>
            <div className="rn-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              {modal.step === 'edit' ? (
                <>
                  <div className="rn-icon"><Pencil size={22} /></div>
                  <h2 className="rn-title">Rename household</h2>
                  <p className="rn-sub">Fix a typo or pick a new name. Everyone in the household will see it.</p>
                  <label className="rn-label" htmlFor="hs-rn-input">New name</label>
                  <input
                    id="hs-rn-input"
                    className="rn-input"
                    type="text"
                    autoFocus
                    maxLength={40}
                    value={modal.name}
                    onChange={(e) => setModal({ ...modal, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !invalid) setModal({ ...modal, step: 'confirm' }); }}
                  />
                  <div className="rn-meta">
                    <span className={modal.name && invalid ? 'rn-error' : ''}>{modal.name ? invalid : ''}</span>
                    <span>{modal.name.length}/40</span>
                  </div>
                  <button className="rn-btn-primary" disabled={!!invalid} onClick={() => setModal({ ...modal, step: 'confirm' })}>Continue</button>
                  <button className="rn-btn-ghost" onClick={() => setModal(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <div className="rn-icon rn-icon-confirm"><AlertCircle size={24} /></div>
                  <h2 className="rn-title">Change the household name?</h2>
                  <div className="rn-diff">
                    <div className="rn-diff-row"><span className="rn-diff-label">Current</span><span className="rn-old">{modal.household.name}</span></div>
                    <div className="rn-diff-row"><span className="rn-diff-label">New</span><span className="rn-new">{trimmed}</span></div>
                  </div>
                  <div className="rn-note">Are you sure? All members will be notified of the new household name.</div>
                  <VerifyField
                    user={currentUser}
                    householdName={modal.household.name}
                    value={modal.secret}
                    error={modal.error}
                    onChange={(v) => setModal({ ...modal, secret: v, error: '' })}
                  />
                  <button className="rn-btn-primary" disabled={busy || !modal.secret.trim()} onClick={confirmRename}>
                    {busy ? 'Saving…' : 'Yes, change name'}
                  </button>
                  <button className="rn-btn-ghost" disabled={busy} onClick={() => setModal({ ...modal, step: 'edit', secret: '', error: '' })}>Go back</button>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {modal?.type === 'transfer' && (
        <div className="settings-modal-overlay">
          <div className="settings-modal">
            <h2>Transfer Ownership</h2>
            <p className="modal-msg">Pick the new owner. They get a request and must accept within 7 days — you stay the owner until then.</p>
            <div className="transfer-members">
              {modal.household.members.filter((m) => m.user_id !== currentUser.id).map((m) => (
                <button key={m.user_id} className={`transfer-member-btn ${modal.target === m.user_id ? 'active' : ''}`} onClick={() => setModal({ ...modal, target: m.user_id })}>
                  <Crown size={14}/> {m.full_name}
                </button>
              ))}
            </div>
            <button
              className="modal-primary-btn"
              disabled={busy || !modal.target}
              onClick={() => run(() => supabase.rpc('request_ownership_transfer', { p_household: modal.household.id, p_to: modal.target }), 'Request sent — waiting for them to accept')}
            >
              {busy ? 'Sending...' : 'Send Request'}
            </button>
            <button className="modal-ghost-btn" onClick={() => setModal(null)}>Cancel</button>
          </div>
        </div>
      )}

      {modal?.type === 'members' && (
        <div className="settings-modal-overlay">
          <div className="settings-modal wide">
            <div className="modal-top-row">
              <h2>Manage Members</h2>
              <button className="modal-x-btn" onClick={() => setModal(null)} aria-label="Close"><X size={18}/></button>
            </div>
            {modal.household.members.map((m) => (
              <div key={m.user_id} className="member-manage-row">
                <div className="member-manage-avatar">
                  {m.avatar_url ? <img src={m.avatar_url} alt="" className="member-manage-img"/> : initialsOf(m.full_name)}
                </div>
                <div className="member-manage-info">
                  <p className="member-manage-name">{m.full_name}</p>
                  <p className="member-manage-role">{m.role === 'owner' ? <><InlineIcon as={ICONS.owner} /> Owner</> : <><InlineIcon as={ICONS.member} /> Member</>}</p>
                </div>
                {m.user_id !== currentUser.id && (
                  <button className="kick-member-btn" disabled={busy} onClick={() => openRemove(modal.household, m)} aria-label={`Remove ${m.full_name}`}>
                    <UserMinus size={14}/>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {modal?.type === 'remove' && (
        <RemoveMemberModal
          householdId={modal.household.id}
          householdName={modal.household.name}
          member={modal.member}
          blockers={modal.blockers}
          busy={busy}
          onGo={go}
          onConfirm={() => run(() => supabase.rpc('remove_household_member', { p_household: modal.household.id, p_user: modal.member.user_id }), `${modal.member.full_name} removed.`)}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
