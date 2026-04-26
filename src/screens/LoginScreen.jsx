import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './LoginScreen.css';

export default function LoginScreen() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
      const { error } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

      if (error) {
        if (error.message.includes('Email not confirmed')) {
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

      // Success — go to Dashboard
      navigate('/dashboard');

    } catch {
      setErrors({ general: 'Something went wrong. Please try again.' });
    }

    setLoading(false);
  };

  const handleForgotPassword = async () => {
    if (!formData.email.trim()) {
      setErrors({ email: 'Enter your email above first to reset your password.' });
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(formData.email, {
      redirectTo: 'http://localhost:5173/reset-password',
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
        <svg viewBox="0 0 60 60" fill="none" className="login-logo-icon">
          <path d="M30 5L5 25v30h15V38h20v17h15V25L30 5z" fill="#3B2AAB"/>
        </svg>
        <span className="login-logo-text">HomeSync</span>
      </div>

      {/* Heading */}
      <div className="login-heading">
        <h1>Welcome Back!</h1>
        <p>Log into HomeSync</p>
      </div>

      {/* General Error */}
      {errors.general && (
        <div className="login-error-banner">{errors.general}</div>
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
              {showPassword ? '🙈' : '👁️'}
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