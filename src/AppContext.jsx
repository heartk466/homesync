import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from './supabaseClient';
import { AppContext, CURRENCY_SYMBOLS } from './appContextCore';
import { applyDarkStyles } from './utils/darkTheme';

// Last theme on this device, so a dark-mode user doesn't see a light flash
// while the profile loads (the profile stays the source of truth).
const THEME_KEY = 'homesync-theme';
const readCachedDark = () => { try { return localStorage.getItem(THEME_KEY) === 'dark'; } catch { return false; } };
function applyTheme(dark) {
  if (dark) applyDarkStyles();
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch { /* storage blocked */ }
}


export function AppProvider({ children }) {
  const [currency, setCurrencyState] = useState('PHP');
  const [isDark, setIsDarkState] = useState(readCachedDark);

  // Apply the cached theme on first render
  useEffect(() => { applyTheme(readCachedDark()); }, []);

  // Load from profile on mount
  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('currency, theme')
        .eq('id', user.id)
        .single();
      if (profile?.currency) setCurrencyState(profile.currency);
      const dark = profile?.theme === 'dark';
      setIsDarkState(dark);
      applyTheme(dark);
    };
    load();
  }, []);

  // Owner activity: "inactive 30 days" ownership claims read profiles.last_active_at
  // (the RPC only writes once every 10 minutes). Runs on load and on return to the app.
  useEffect(() => {
    const touch = () => { if (document.visibilityState === 'visible') supabase.rpc('touch_last_active').then(() => {}, () => {}); };
    touch();
    document.addEventListener('visibilitychange', touch);
    return () => document.removeEventListener('visibilitychange', touch);
  }, []);

  // Stable setters: screens list them as effect / callback deps, so a new
  // function on every render would re-run their data loads (and re-apply the
  // saved theme / currency over the one just picked — the toggle "flicker").
  const setCurrency = useCallback((curr) => setCurrencyState(curr), []);

  const setIsDark = useCallback((val) => {
    setIsDarkState(val);
    applyTheme(val);
  }, []);

  const currencySymbol = CURRENCY_SYMBOLS[currency] || '₱';
  const value = useMemo(
    () => ({ currency, setCurrency, isDark, setIsDark, currencySymbol }),
    [currency, setCurrency, isDark, setIsDark, currencySymbol],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}
