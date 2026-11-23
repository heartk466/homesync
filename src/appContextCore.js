// The app-wide context object, its hook and the currency map. Kept apart from
// AppContext.jsx so that file only exports a component (fast refresh needs that).
import { createContext, useContext } from 'react';

// Currency symbols map
export const CURRENCY_SYMBOLS = {
  PHP: '₱',
  USD: '$',
  EUR: '€',
  SGD: 'S$',
  JPY: '¥',
};

export const AppContext = createContext(null);

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used inside AppProvider');
  return ctx;
}
