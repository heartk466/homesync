import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

// Currency symbols map
export const CURRENCY_SYMBOLS = {
  PHP: '₱',
  USD: '$',
  EUR: '€',
  SGD: 'S$',
  JPY: '¥',
};

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [currency, setCurrencyState] = useState('PHP');
  const [isDark, setIsDarkState] = useState(false);

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
      if (profile?.theme === 'dark') {
        setIsDarkState(true);
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
      }
    };
    load();
  }, []);

  const setCurrency = (curr) => setCurrencyState(curr);

  const setIsDark = (val) => {
    setIsDarkState(val);
    document.documentElement.setAttribute('data-theme', val ? 'dark' : 'light');
  };

  const currencySymbol = CURRENCY_SYMBOLS[currency] || '₱';

  return (
    <AppContext.Provider value={{ currency, setCurrency, isDark, setIsDark, currencySymbol }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used inside AppProvider');
  return ctx;
}