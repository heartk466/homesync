// Terms of Service & Privacy Policy, shown once per account on its first
// sign-in (whichever device that is). Mounted once in App: on any signed-in
// screen it checks profiles.terms_accepted_at and, while empty, blocks the app
// with this modal until the user ticks the box and agrees. "Decline" signs out.
// If the column doesn't exist yet (migration not run) it stays out of the way.
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '../supabaseClient';
import './TermsGate.css';

const PUBLIC_ROUTES = ['/', '/login', '/register', '/reset-password'];
const EFFECTIVE_DATE = 'October 31, 2026';
const CONTACT_EMAIL = 'homesync466@gmail.com';

let acceptedFor = null;   // user id already checked / accepted this session

export default function TermsGate() {
  const location = useLocation();
  const navigate = useNavigate();
  const [userId, setUserId] = useState(null);   // set while the modal is needed
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isPublic = PUBLIC_ROUTES.includes(location.pathname);

  useEffect(() => {
    if (isPublic) return undefined;
    let alive = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid || acceptedFor === uid) { if (alive) setUserId(null); return; }
      const { data, error: fetchError } = await supabase
        .from('profiles').select('terms_accepted_at').eq('id', uid).maybeSingle();
      if (!alive) return;
      // no profile yet, or the column isn't there (migration not run): don't block
      if (fetchError || !data || data.terms_accepted_at) { acceptedFor = uid; setUserId(null); return; }
      setUserId(uid);
    })();
    return () => { alive = false; };
  }, [isPublic, location.pathname]);

  if (!userId || isPublic) return null;

  const agree = async () => {
    setSaving(true);
    setError('');
    const { error: saveError } = await supabase
      .from('profiles').update({ terms_accepted_at: new Date().toISOString() }).eq('id', userId);
    setSaving(false);
    if (saveError) { setError('Could not save your agreement. Please try again.'); return; }
    acceptedFor = userId;
    setUserId(null);
    if (location.pathname !== '/dashboard') navigate('/dashboard', { replace: true });
  };

  const decline = async () => {
    acceptedFor = null;
    setUserId(null);
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="tg-overlay" role="dialog" aria-modal="true" aria-labelledby="tg-title">
      <div className="tg-card">
        <div className="tg-head">
          <span className="tg-icon" aria-hidden="true"><ShieldCheck size={22} /></span>
          <div>
            <h2 id="tg-title">Terms of Service &amp; Privacy Policy</h2>
            <p className="tg-sub">Please read before using HomeSync · Effective {EFFECTIVE_DATE}</p>
          </div>
        </div>

        <div className="tg-body" tabIndex={0}>
          <h3>Terms of Service</h3>

          <h4>1. About HomeSync</h4>
          <p>HomeSync helps households and groups record shared expenses, split bills, track utilities, upload proofs of payment, chat, and view reports. It is a record-keeping tool.</p>

          <h4>2. HomeSync does not handle money</h4>
          <p>Payments are made outside the app (for example through GCash, PayMaya, or bank transfer). HomeSync does not send, receive, hold, or guarantee any money. Disputes about payments are between the members involved.</p>

          <h4>3. Your account</h4>
          <p>You must give accurate information and keep your password private. You are responsible for activity on your account. Tell us right away if you think someone else has used it.</p>

          <h4>4. Households and groups</h4>
          <p>The owner of a household or group approves expenses, reviews proofs of payment, sends refunds, and manages members. Members can see the household's shared expenses, payment statuses, and messages. Ownership can be transferred; the new owner must accept.</p>

          <h4>5. Acceptable use</h4>
          <p>Do not upload fake or altered proofs of payment, impersonate others, harass members, share illegal or offensive content, or try to break, overload, or access parts of the service you are not allowed to.</p>

          <h4>6. Your content</h4>
          <p>You keep ownership of what you add (expenses, notes, photos, messages). You allow HomeSync to store and show it to the members of your household or group so the app can work.</p>

          <h4>7. Availability and changes</h4>
          <p>HomeSync is provided “as is”. We try to keep it running and accurate but cannot promise it will always be available or error-free. We may update these terms; if the changes are important we will tell you in the app.</p>

          <h4>8. Ending your account</h4>
          <p>You can delete your account in Settings. We may suspend accounts that break these terms. Some records may remain where other members still need them (for example, an expense you were part of).</p>

          <h3>Privacy Policy</h3>

          <h4>1. What we collect</h4>
          <ul>
            <li>Account details: name, email address, password (stored encrypted), profile photo.</li>
            <li>Payment details you choose to add: GCash / PayMaya numbers and names, bank name and account details, QR codes.</li>
            <li>Household data: expenses, splits, due dates, payment statuses, refunds, reports and schedules.</li>
            <li>Uploads and messages: proof-of-payment screenshots, chat messages and photos.</li>
            <li>Device information for notifications and Active Sessions (device type, browser, push subscription).</li>
          </ul>

          <h4>2. How we use it</h4>
          <p>Only to run HomeSync: to split and track expenses, show balances and reports, verify payments, send in-app, email and phone notifications and reminders, and keep your account secure.</p>

          <h4>3. Who can see it</h4>
          <p>Members of your households and groups can see your name, photo, your shares and payment statuses, and the payment details you add (so they know where to pay). Payment proofs are private: only you and the owner who reviews them can open them. We do not sell your data or share it with advertisers.</p>

          <h4>4. Where it is stored</h4>
          <p>Data is stored with our hosting providers (Supabase for the database and files, Vercel for the website) using encrypted connections. Access is limited by security rules so users only see what they are allowed to.</p>

          <h4>5. How long we keep it</h4>
          <p>We keep your data while your account is active. Rejected proof images are removed automatically after a set period. When you delete your account, your personal data is removed, except records other members still need.</p>

          <h4>6. Your rights</h4>
          <p>Under the Philippine Data Privacy Act of 2012 (RA 10173) you can access, correct, download (Settings → Export My Data), and delete your data, and object to its use. You can turn notifications off anytime in Settings.</p>

          <h4>7. Contact</h4>
          <p>Questions or requests: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
        </div>

        <label className="tg-check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>I have read and agree to the Terms of Service and Privacy Policy.</span>
        </label>
        {error && <p className="tg-error" role="alert">{error}</p>}

        <button type="button" className="tg-agree" disabled={!checked || saving} onClick={agree}>
          {saving ? 'Saving…' : 'Agree and continue'}
        </button>
        <button type="button" className="tg-decline" onClick={decline} disabled={saving}>
          Decline and sign out
        </button>
      </div>
    </div>
  );
}
