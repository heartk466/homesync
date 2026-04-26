import React from 'react';
import { useNavigate } from 'react-router-dom';
import './SplashScreen.css';

export default function SplashScreen() {
  const navigate = useNavigate();

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