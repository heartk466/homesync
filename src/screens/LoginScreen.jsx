import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { finishPendingSignup } from '../utils/signupSetup';
import { Eye, EyeOff, Mail, MailCheck, MailWarning } from 'lucide-react';
import './LoginScreen.css';

export default function LoginScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  // arrived from a verification link that expired or was already used
  const linkError = location.state?.linkError;

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // "Email not confirmed" (or an expired link): offer to send a new link
  const [needsVerify, setNeedsVerify] = useState(Boolean(linkError));
  const [resend, setResend] = useState({ busy: false, msg: '', ok: false });

  const validate = () => {
    const newErrors = {};

    if (!formData.email.trim())
      newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(formData.email))
      newErrors.email = 'Enter a valid email address';

    if (!formData.password)
      newErrors.password = 'Password is required';

    return newErrors;
  };

  const handleLogin = async () => {
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setLoading(true);
    setErrors({});

    try {
      const { data: signIn, error } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

      if (error) {
        if (error.message.includes('Email not confirmed')) {
          setNeedsVerify(true);
          setErrors({
            general: 'Please verify your email before logging in. Check your inbox.',
          });
        } else if (error.message.includes('Invalid login credentials')) {
          setErrors({ general: 'Invalid email or password. Please try again.' });
        } else {
          setErrors({ general: error.message });
        }
        setLoading(false);
        return;
      }

      // First login after verifying the email: create the profile / household
      // chosen at sign-up (does nothing for accounts that are already set up)
      const setupError = await finishPendingSignup(signIn?.user);
      if (setupError) console.error('Finishing sign-up setup failed:', setupError);

      // Success — go to Dashboard
      navigate('/dashboard');

    } catch {
      setErrors({ general: 'Something went wrong. Please try again.' });
    }

    setLoading(false);
  };

  const handleResend = async () => {
    if (!/\S+@\S+\.\S+/.test(formData.email)) {
      setErrors({ email: 'Enter your email above first.' });
      return;
    }
    setResend({ busy: true, msg: '', ok: false });
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: formData.email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    setErrors({});
    setResend(error
      ? { busy: false, ok: false, msg: error.message.includes('rate limit') ? 'Please wait a minute before sending another email.' : error.message }
      : { busy: false, ok: true, msg: 'sent' });
  };

  const handleForgotPassword = async () => {
    if (!formData.email.trim()) {
      setErrors({ email: 'Enter your email above first to reset your password.' });
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(formData.email, {
  redirectTo: `${window.location.origin}/reset-password`,
});

    if (error) {
      setErrors({ general: error.message });
    } else {
      setErrors({ general: '' });
      alert('Password reset email sent! Check your inbox.');
    }

    setLoading(false);
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: '' });
  };

  return (
    <div className="login">

      {/* Logo */}
      <div className="login-logo">
        <img src="/Homesync.svg" alt="HomeSync" className="login-logo-icon" />
        <span className="login-logo-text">HomeSync</span>
      </div>

      {/* Heading */}
      <div className="login-heading">
        <h1>Welcome Back!</h1>
        <p>Log into HomeSync</p>
      </div>

      {/* General Error (the verify card below explains "Email not confirmed") */}
      {errors.general && !needsVerify && (
        <div className="login-error-banner">{errors.general}</div>
      )}

      {/* Not verified yet / expired link: one card with the message and Resend */}
      {needsVerify && (
        <div className={`login-verify${resend.ok ? ' is-ok' : resend.msg ? ' is-err' : ''}`} role="status">
          <span className="login-verify-icon" aria-hidden="true">
            {resend.ok ? <MailCheck size={20} /> : resend.msg ? <MailWarning size={20} /> : <Mail size={20} />}
          </span>
          <div className="login-verify-body">
            <p className="login-verify-title">
              {resend.ok ? 'Verification email sent' : resend.msg ? 'Couldn’t send the email' : linkError ? 'That link has expired' : 'Verify your email first'}
            </p>
            <p className="login-verify-text">
              {resend.ok
                ? <>Check <strong>{formData.email.trim()}</strong> and open the newest email.</>
                : resend.msg
                  || (linkError
                    ? 'It was already used or is too old. Already verified? Just log in. Otherwise send a new link.'
                    : 'Open the link we emailed you, or send a new one.')}
            </p>
          </div>
          <button type="button" className="login-verify-btn" onClick={handleResend} disabled={resend.busy}>
            {resend.busy ? 'Sending…' : resend.ok ? 'Send again' : 'Resend'}
          </button>
        </div>
      )}

      {/* Form */}
      <div className="login-form">

        {/* Email */}
        <div className="input-group">
          <input
            type="email"
            name="email"
            placeholder="Enter your Email"
            value={formData.email}
            onChange={handleChange}
            className={errors.email ? 'input-error' : ''}
          />
          {errors.email && <span className="error-text">{errors.email}</span>}
        </div>

        {/* Password */}
        <div className="input-group">
          <div className="input-wrapper">
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              placeholder="Enter Password"
              value={formData.password}
              onChange={handleChange}
              className={errors.password ? 'input-error' : ''}
            />
            <button
              className="eye-btn"
              onClick={() => setShowPassword(!showPassword)}
              type="button"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errors.password && (
            <span className="error-text">{errors.password}</span>
          )}
        </div>

        {/* Forgot Password */}
        <p
          className="forgot-password"
          onClick={handleForgotPassword}
        >
          Forgot Password?
        </p>

        {/* Login Button */}
        <button
          className="login-btn"
          onClick={handleLogin}
          disabled={loading}
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>

        {/* Sign Up Link */}
        <p className="signup-text">
          Don't have an Account?{' '}
          <span
            className="signup-link"
            onClick={() => navigate('/register')}
          >
            Sign Up
          </span>
        </p>

      </div>
    </div>
  );
}