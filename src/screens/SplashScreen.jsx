import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { supabase, openedFromVerifyLink } from '../supabaseClient';
import { finishPendingSignup } from '../utils/signupSetup';
import './SplashScreen.css';

export default function SplashScreen() {
  const navigate = useNavigate();
  // The Home Screen app always opens here ("/"): already logged in → straight to
  // the Dashboard instead of looking logged out. Nothing renders until we know.
  const [checking, setChecking] = useState(true);
  // verification link opened in a phone browser (not the Home Screen app):
  // say so, since the Home Screen app keeps its own sign-in
  const [verifiedInBrowser, setVerifiedInBrowser] = useState(false);

  useEffect(() => {
    let alive = true;
    // An expired / already-used verification link comes back as
    // #error=access_denied&error_code=otp_expired — explain it on Sign In.
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get('error_code') || hash.get('error')) {
      navigate('/login', { replace: true, state: { linkError: hash.get('error_code') || hash.get('error') } });
      return undefined;
    }
    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        if (!alive) return;
        if (!session) { setChecking(false); return; }
        // the email verification link lands here: finish the sign-up setup first
        const setupError = await finishPendingSignup(session.user);
        if (setupError) console.error('Finishing sign-up setup failed:', setupError);
        if (!alive) return;
        const phone = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
        const standalone = window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
        if (openedFromVerifyLink && phone && !standalone) { setVerifiedInBrowser(true); setChecking(false); return; }
        navigate('/dashboard', { replace: true });
      })
      .catch(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [navigate]);

  if (checking) return <div className="splash" aria-busy="true" />;

  if (verifiedInBrowser) {
    return (
      <div className="splash splash--verified">
        <div className="check-card" role="status">
          <span className="check-icon" aria-hidden="true"><MailCheck size={30} /></span>
          <h1 className="check-title">Email verified!</h1>
          <p className="check-text">Your HomeSync account is ready.</p>
          <ol className="check-steps">
            <li>Added HomeSync to your Home Screen? <strong>Open it from there</strong> and sign in with your email and password.</li>
            <li>Or just <strong>continue here</strong> in your browser.</li>
          </ol>
          <button className="register-btn check-btn" onClick={() => navigate('/dashboard', { replace: true })}>Continue here</button>
        </div>
      </div>
    );
  }

  return (
    <div className="splash">

      {/* Top — Logo + Subtitle */}
      <div className="splash-top">
        <div className="splash-logo-row">
          <svg className="splash-logo-icon" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#3B2AAB"/>
            <path d="M16 6L6 14v12h7v-6h6v6h7V14L16 6z" fill="white"/>
          </svg>
          <span className="splash-logo-text">HomeSync</span>
        </div>
        <p className="splash-subtitle">
          A Smart Household Financial Management System
        </p>
      </div>

      {/* Middle — Illustration */}
      <div className="splash-illustration">
        <img src="/splash-illustration.svg" alt="HomeSync illustration" />
      </div>

      {/* Bottom — Tagline + Button */}
      <div className="splash-bottom">
        <p className="splash-tagline">
          Shared Bills.<br/>Clear Contributions.
        </p>
        <button
          className="splash-btn"
          onClick={() => navigate('/register')}
        >
          Get Started
        </button>
      </div>

    </div>
  );
}