import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './RegisterScreen.css';

export default function RegisterScreen() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    householdType: 'join',
    householdCode: '',
  });

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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

    if (!formData.householdCode.trim())
      newErrors.householdCode = formData.householdType === 'join'
        ? 'Household code or name is required'
        : 'Household name is required';

    return newErrors;
  };

  const generateCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
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
          data: {
            full_name: formData.fullName,
          }
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

      const userId = authData.user.id;

      // 2. Handle household creation/joining
      if (formData.householdType === 'create') {
        // Create new household
        const code = generateCode();
        const { data: household, error: householdError } = await supabase
          .from('households')
          .insert({
            name: formData.householdCode.trim(),
            code: code,
            created_by: userId,
          })
          .select()
          .single();

        if (householdError) {
          console.error('Household creation error:', householdError);
          setErrors({ general: `Failed to create household: ${householdError.message}` });
          setLoading(false);
          return;
        }

        // Create profile with household_id
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: userId,
            full_name: formData.fullName.trim(),
            email: formData.email,
            household_id: household.id,
          });

        if (profileError) {
          console.error('Profile creation error:', profileError);
          setErrors({ general: `Failed to create profile: ${profileError.message}` });
          setLoading(false);
          return;
        }

        // Add to household_members as owner
        const { error: memberError } = await supabase
          .from('household_members')
          .insert({
            household_id: household.id,
            user_id: userId,
            role: 'owner',
            status: 'active',
          });

        if (memberError) {
          console.error('Member insertion error:', memberError);
          // Non-fatal, but log it
        }

      } else {
        // Join existing household
        const { data: household, error: findError } = await supabase
          .from('households')
          .select('id, name, created_by')
          .or(`code.eq.${formData.householdCode.trim()},name.eq.${formData.householdCode.trim()}`)
          .maybeSingle(); // Use maybeSingle to avoid 0 rows error

        if (findError) {
          console.error('Find household error:', findError);
          setErrors({ general: `Error finding household: ${findError.message}` });
          setLoading(false);
          return;
        }

        if (!household) {
          setErrors({ householdCode: 'Household not found. Check the code or name.' });
          setLoading(false);
          return;
        }

        // Create profile with household_id
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: userId,
            full_name: formData.fullName.trim(),
            email: formData.email,
            household_id: household.id,
          });

        if (profileError) {
          console.error('Profile creation error:', profileError);
          setErrors({ general: `Failed to create profile: ${profileError.message}` });
          setLoading(false);
          return;
        }

        // Add to household_members as member
        const { error: memberError } = await supabase
          .from('household_members')
          .insert({
            household_id: household.id,
            user_id: userId,
            role: 'member',
            status: 'active',
          });

        if (memberError) {
          console.error('Member insertion error:', memberError);
          // Non-fatal, but log it
        }
      }

      // 5. Success – navigate to dashboard
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

  return (
    <div className="register">
      <div className="register-logo-row">
        <svg className="register-logo-icon" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="8" fill="#3B2AAB"/>
          <path d="M16 6L6 14v12h7v-6h6v6h7V14L16 6z" fill="white"/>
        </svg>
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
              {showPassword ? '🙈' : '👁️'}
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
              {showConfirmPassword ? '🙈' : '👁️'}
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
        </div>

        <div className="input-group">
          <input
            type="text"
            name="householdCode"
            placeholder={
              formData.householdType === 'join'
                ? 'Household Code / Name'
                : 'Create a Household Name'
            }
            value={formData.householdCode}
            onChange={handleChange}
            className={errors.householdCode ? 'input-error' : ''}
          />
          {errors.householdCode && <span className="error-text">{errors.householdCode}</span>}
        </div>

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