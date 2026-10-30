import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { Eye, EyeOff } from 'lucide-react';
import './RegisterScreen.css';
import { completeSignupSetup } from '../utils/signupSetup';

export default function RegisterScreen() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    householdType: 'none',
    householdCode: '',
  });

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  // email confirmation is on: account made, waiting for the Gmail link
  const [checkEmail, setCheckEmail] = useState(false);

  const validate = () => {
    const newErrors = {};

    if (!formData.fullName.trim())
      newErrors.fullName = 'Full name is required';

    if (!formData.email.trim())
      newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(formData.email))
      newErrors.email = 'Enter a valid email address';

    if (!formData.password)
      newErrors.password = 'Password is required';
    else if (formData.password.length < 8)
      newErrors.password = 'Password must be at least 8 characters';
    else if (!/[0-9]/.test(formData.password))
      newErrors.password = 'Password must include at least one number';
    else if (!/[!@#$%^&*]/.test(formData.password))
      newErrors.password = 'Password must include a special character (!@#$%^&*)';

    if (!formData.confirmPassword)
      newErrors.confirmPassword = 'Please confirm your password';
    else if (formData.password !== formData.confirmPassword)
      newErrors.confirmPassword = 'Passwords do not match';

    if (formData.householdType !== 'none' && !formData.householdCode.trim())
      newErrors.householdCode = formData.householdType === 'join'
        ? 'Household invite code is required'
        : 'Household name is required';

    return newErrors;
  };

  const handleRegister = async () => {
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setLoading(true);
    setErrors({});

    try {
      // 1. Sign up with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          // saved with the account so the setup can finish on the first login
          // when email confirmation is on (no session until the link is clicked)
          data: {
            full_name: formData.fullName,
            household_type: formData.householdType,
            household_value: formData.householdType === 'none' ? '' : formData.householdCode.trim(),
          },
          // the verification link opens the app, which finishes the setup
          emailRedirectTo: `${window.location.origin}/`,
        }
      });

      if (authError) {
        console.error('Auth error:', authError);
        if (authError.message.includes('rate limit')) {
          setErrors({ general: 'Too many signup attempts. Please wait a few minutes and try again.' });
        } else if (authError.message.includes('already registered')) {
          setErrors({ email: 'This email is already registered. Please Sign In.' });
        } else {
          setErrors({ general: authError.message });
        }
        setLoading(false);
        return;
      }

      if (!authData.user) {
        setErrors({ general: 'Signup failed. Please try again.' });
        setLoading(false);
        return;
      }

      // 2. Email confirmation on → no session yet: nothing can be written until
      //    they verify. The saved choices finish the setup on their first login.
      if (!authData.session) {
        setCheckEmail(true);
        setLoading(false);
        return;
      }

      // 3. Logged in right away → profile + household now
      const { error: setupError, field } = await completeSignupSetup({
        userId: authData.user.id,
        email: formData.email,
        fullName: formData.fullName,
        type: formData.householdType,
        value: formData.householdCode,
      });
      if (setupError) {
        setErrors(field ? { [field]: setupError } : { general: setupError });
        setLoading(false);
        return;
      }

      // 4. Success – navigate to dashboard
      navigate('/dashboard');

    } catch (err) {
      console.error('Unexpected error:', err);
      setErrors({ general: 'Something went wrong. Please try again.' });
    }

    setLoading(false);
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: '' });
  };

  if (checkEmail) {
    return (
      <div className="register">
        <div className="register-logo-row">
          <img src="/Homesync.svg" alt="HomeSync" className="register-logo-icon" />
          <span className="register-logo-text">HomeSync</span>
        </div>
        <div className="register-heading">
          <h1>Check your email</h1>
          <p>We sent a verification link to <strong>{formData.email}</strong>. Open it to activate your account, then sign in.</p>
        </div>
        <p className="register-check-note">Can’t find it? Check your Spam or Promotions folder.</p>
        <button className="register-btn" onClick={() => navigate('/login')}>Go to Sign In</button>
      </div>
    );
  }

  return (
    <div className="register">
      <div className="register-logo-row">
        <img src="/Homesync.svg" alt="HomeSync" className="register-logo-icon" />
        <span className="register-logo-text">HomeSync</span>
      </div>

      <div className="register-heading">
        <h1>Welcome Onboard!</h1>
        <p>Join your household easily</p>
      </div>

      {errors.general && (
        <div className="register-error-banner">{errors.general}</div>
      )}

      <div className="register-form">
        <div className="input-group">
          <input
            type="text"
            name="fullName"
            placeholder="Enter your full name"
            value={formData.fullName}
            onChange={handleChange}
            className={errors.fullName ? 'input-error' : ''}
          />
          {errors.fullName && <span className="error-text">{errors.fullName}</span>}
        </div>

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
          {errors.password && <span className="error-text">{errors.password}</span>}
        </div>

        <div className="input-group">
          <div className="input-wrapper">
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              name="confirmPassword"
              placeholder="Confirm Password"
              value={formData.confirmPassword}
              onChange={handleChange}
              className={errors.confirmPassword ? 'input-error' : ''}
            />
            <button
              className="eye-btn"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              type="button"
            >
              {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errors.confirmPassword && <span className="error-text">{errors.confirmPassword}</span>}
        </div>

        <div className="radio-group">
          <label className="radio-label">
            <input
              type="radio"
              name="householdType"
              value="join"
              checked={formData.householdType === 'join'}
              onChange={handleChange}
            />
            Join Household
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="householdType"
              value="create"
              checked={formData.householdType === 'create'}
              onChange={handleChange}
            />
            Create Household
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="householdType"
              value="none"
              checked={formData.householdType === 'none'}
              onChange={handleChange}
            />
            I don't want to join or create a household
          </label>
        </div>

        {formData.householdType !== 'none' && (
          <div className="input-group">
            <input
              type="text"
              name="householdCode"
              placeholder={
                formData.householdType === 'join'
                  ? 'Household Invite Code'
                  : 'Create a Household Name'
              }
              value={formData.householdCode}
              onChange={handleChange}
              className={errors.householdCode ? 'input-error' : ''}
            />
            {errors.householdCode && <span className="error-text">{errors.householdCode}</span>}
          </div>
        )}

        <button
          className="register-btn"
          onClick={handleRegister}
          disabled={loading}
        >
          {loading ? 'Registering...' : 'Register'}
        </button>

        <p className="signin-text">
          Already have an Account?{' '}
          <span
            className="signin-link"
            onClick={() => navigate('/login')}
          >
            Sign In
          </span>
        </p>
      </div>
    </div>
  );
}