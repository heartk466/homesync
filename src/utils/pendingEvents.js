// Tells the bottom nav to recount its "Pending Approvals" badge right after this
// user handles something (refund reviewed, proof approved, ...), wherever it was
// handled. Realtime also refreshes it, but this doesn't depend on the
// supabase_realtime publication being set up.
export const PENDING_CHANGED_EVENT = 'homesync:pending-changed';

export const notifyPendingChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PENDING_CHANGED_EVENT));
};
