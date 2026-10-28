import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './ResetPasswordScreen.css';
import { Icon, InlineIcon, CategoryIcon, StatusIcon } from '../components/Icon';
import { ICONS, CATEGORY_ICON, SUBSCRIPTION_ICON, NOTIF_ICON } from '../utils/iconMap';

const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="3" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16.5v.01" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export default function ResetPasswordScreen() {
  const navigate = useNavigate();

  // 'checking' | 'ready' | 'invalid' | 'done'
  const [status, setStatus] = useState('checking');
  const [formData, setFormData] = useState({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Detect the recovery session created from the email link
  useEffect(() => {
    let active = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        if (active) setStatus('ready');
      }
    });

    // The event may have fired before this component mounted, so also check directly
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (active && session) setStatus('ready');
    });

    // If nothing shows up after a few seconds, the link is invalid or expired
    const timer = setTimeout(() => {
      if (active) setStatus((s) => (s === 'checking' ? 'invalid' : s));
    }, 3000);

    return () => {
      active = false;
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  const rules = [
    { label: 'At least 8 characters', ok: formData.password.length >= 8 },
    { label: 'Includes a number', ok: /[0-9]/.test(formData.password) },
    { label: 'Includes a special character (!@#$%^&*)', ok: /[!@#$%^&*]/.test(formData.password) },
  ];

  const validate = () => {
    const e = {};
    const { password, confirmPassword } = formData;

    if (!password) e.password = 'Password is required';
    else if (password.length < 8) e.password = 'Password must be at least 8 characters';
    else if (!/[0-9]/.test(password)) e.password = 'Password must include at least one number';
    else if (!/[!@#$%^&*]/.test(password))
      e.password = 'Password must include a special character (!@#$%^&*)';

    if (!confirmPassword) e.confirmPassword = 'Please confirm your password';
    else if (password !== confirmPassword) e.confirmPassword = 'Passwords do not match';

    return e;
  };

  const handleSubmit = async () => {
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setLoading(true);
    setErrors({});

    const { error } = await supabase.auth.updateUser({ password: formData.password });

    if (error) {
      setErrors({ general: error.message });
      setLoading(false);
      return;
    }

    // End the temporary recovery session so the user logs in with the new password
    await supabase.auth.signOut();
    setStatus('done');
    setLoading(false);
    setTimeout(() => navigate('/login'), 2500);
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: '' });
  };

  return (
    <div className="rp">
      {/* Brand */}
      <div className="rp-brand">
        <svg className="rp-brand-icon" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="8" fill="#3B2AAB" />
          <path d="M16 6L6 14v12h7v-6h6v6h7V14L16 6z" fill="white" />
        </svg>
        <span className="rp-brand-text">HomeSync</span>
      </div>

      <div className="rp-card">
        {/* Checking */}
        {status === 'checking' && (
          <>
            <div className="rp-spinner" />
            <div className="rp-heading">
              <h1 className="rp-title">Verifying link</h1>
              <p className="rp-subtitle">Please wait a moment...</p>
            </div>
          </>
        )}

        {/* Invalid / expired */}
        {status === 'invalid' && (
          <>
            <div className="rp-badge rp-badge--error"><AlertIcon /></div>
            <div className="rp-heading">
              <h1 className="rp-title">Link expired</h1>
              <p className="rp-subtitle">
                This reset link is invalid or has expired. Request a new one from the login page.
              </p>
            </div>
            <button className="rp-btn" onClick={() => navigate('/login')}>
              Back to Login
            </button>
          </>
        )}

        {/* Success */}
        {status === 'done' && (
          <>
            <div className="rp-badge rp-badge--success"><CheckIcon /></div>
            <div className="rp-heading">
              <h1 className="rp-title">Password updated!</h1>
              <p className="rp-subtitle">You can now log in with your new password.</p>
            </div>
            <p className="rp-hint">Redirecting to login...</p>
          </>
        )}

        {/* Form */}
        {status === 'ready' && (
          <>
            <div className="rp-badge"><LockIcon /></div>
            <div className="rp-heading">
              <h1 className="rp-title">Set New Password</h1>
              <p className="rp-subtitle">Choose a strong password to secure your account.</p>
            </div>

            {errors.general && <div className="rp-error-banner">{errors.general}</div>}

            <div className="rp-form">
              <div className="rp-field">
                <div className="rp-input-wrap">
                  <input
                    className={`rp-input ${errors.password ? 'has-error' : ''}`}
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    placeholder="New Password"
                    value={formData.password}
                    onChange={handleChange}
                  />
                  <button
                    className="rp-eye"
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <Icon as={showPassword ? ICONS.eyeOff : ICONS.eye} size={18} />
                  </button>
                </div>
                {errors.password && <span className="rp-error-text">{errors.password}</span>}
              </div>

              <div className="rp-field">
                <div className="rp-input-wrap">
                  <input
                    className={`rp-input ${errors.confirmPassword ? 'has-error' : ''}`}
                    type={showConfirm ? 'text' : 'password'}
                    name="confirmPassword"
                    placeholder="Confirm New Password"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                  />
                  <button
                    className="rp-eye"
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  >
                    <Icon as={showConfirm ? ICONS.eyeOff : ICONS.eye} size={18} />
                  </button>
                </div>
                {errors.confirmPassword && (
                  <span className="rp-error-text">{errors.confirmPassword}</span>
                )}
              </div>

              <ul className="rp-rules">
                {rules.map((r) => (
                  <li key={r.label} className={`rp-rule ${r.ok ? 'ok' : ''}`}>
                    <span className="rp-rule-dot"><CheckIcon /></span>
                    {r.label}
                  </li>
                ))}
              </ul>

              <button className="rp-btn" onClick={handleSubmit} disabled={loading}>
                {loading ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}