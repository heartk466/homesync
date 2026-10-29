// The household picked last on Dashboard / Expenses / Utilities / Reports, so
// switching on one screen makes the others open on the same household.
// Per device (localStorage); an id the user no longer belongs to is ignored.
const KEY = 'homesync-active-household';

export function rememberHousehold(id) {
  try { if (id) localStorage.setItem(KEY, id); } catch { /* storage blocked */ }
}

// the remembered household if it's in the list, else the fallback
export function pickRememberedHousehold(households, fallback) {
  let id = null;
  try { id = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  return (id && households.find(h => h.id === id)) || fallback;
}
