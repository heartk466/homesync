import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  User, Home, Bell, Palette, Shield,
  Database, Info, LogOut, ChevronRight,
  Copy, Share2, UserMinus, Crown, Trash2,
  Download, X, Check, AlertCircle
} from 'lucide-react';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { usePushNotifications } from '../hooks/usePushNotifications';
import './SettingsScreen.css';
import { useAppContext } from '../AppContext';

// ─── VAPID helper (must match usePushNotifications.js) ────────────────────────
const VAPID_PUBLIC_KEY = 'BBcMhS6ZOXie4qlsAsjdMhgVqYVoS697eMkuiHI4J_PiB20t6J6vT4npuIFiHPO9kavudjoyg9w_VP4zHOnPNMA';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}
// ──────────────────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [household, setHousehold] = useState(null);
  const [householdMembers, setHouseholdMembers] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifPrefs, setNotifPrefs] = useState({
    expense_approvals: true,
    payment_confirmations: true,
    utility_reminders: true,
    report_schedules: true,
    group_invites: true,
  });
  const [reminderDays, setReminderDays] = useState(5);

  const { currency, setCurrency: setContextCurrency, isDark, setIsDark: setContextDark } = useAppContext();

  // UI State
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [showDeleteHouseholdModal, setShowDeleteHouseholdModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showEditHouseholdModal, setShowEditHouseholdModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [newHouseholdName, setNewHouseholdName] = useState('');
  const [expandedSection, setExpandedSection] = useState(null);

  // Delete account password confirmation
  const [deletePassword, setDeletePassword] = useState('');
  const [deletePasswordError, setDeletePasswordError] = useState('');

  // Payment Details modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ gcash_number: '', gcash_account_name: '', paymaya_number: '', paymaya_account_name: '', bank_name: '', bank_account_number: '', bank_account_name: '' });
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  // Push notification status display
  const [pushStatus, setPushStatus] = useState('unknown'); // 'granted' | 'denied' | 'default' | 'unsupported'

  // ── Wire up push subscription whenever user + prefs are loaded ──────────────
  usePushNotifications(currentUser?.id, notifPrefs);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }
      setCurrentUser(user);

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(profileData);

      // Apply saved theme
      if (profileData?.theme === 'dark') {
        setContextDark(true);
      } else {
        setContextDark(false);
      }

      // Load preferences
      if (profileData?.notification_preferences) {
        setNotifPrefs(profileData.notification_preferences);
      }
      if (profileData?.default_reminder_days) {
        setReminderDays(profileData.default_reminder_days);
      }
      if (profileData?.currency) {
        setContextCurrency(profileData.currency);
      }

      if (profileData?.household_id) {
        const { data: householdData } = await supabase
          .from('households')
          .select('*')
          .eq('id', profileData.household_id)
          .single();
        setHousehold(householdData);
        setNewHouseholdName(householdData?.name || '');

        const { data: members } = await supabase
          .from('household_members')
          .select('*, profiles(*)')
          .eq('household_id', profileData.household_id);
        setHouseholdMembers(members || []);

        const userMember = members?.find(m => m.user_id === user.id);
        setIsAdmin(userMember?.role === 'owner');
      }

      const { data: notifData } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      setNotifications(notifData || []);
      setUnreadCount((notifData || []).filter(n => !n.is_read).length);

    } catch (err) {
      console.error(err);
    }
  };

  // ── Check browser push permission status on mount ──────────────────────────
  useEffect(() => {
    if (!('Notification' in window)) {
      setPushStatus('unsupported');
    } else {
      setPushStatus(Notification.permission); // 'granted' | 'denied' | 'default'
    }
  }, []);

  const markAllRead = async () => {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', currentUser.id)
      .eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleDark = async () => {
    const newTheme = isDark ? 'light' : 'dark';
    setContextDark(!isDark);
    await supabase
      .from('profiles')
      .update({ theme: newTheme })
      .eq('id', currentUser.id);
    showToast(`${newTheme === 'dark' ? '🌙 Dark' : '☀️ Light'} mode enabled`);
  };

  // ── Toggle a notification preference + re-subscribe / unsubscribe if needed ─
  const handleToggleNotif = async (key) => {
    const newPrefs = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(newPrefs);

    // Persist to Supabase
    await supabase
      .from('profiles')
      .update({ notification_preferences: newPrefs })
      .eq('id', currentUser.id);

    const anyEnabled = Object.values(newPrefs).some(Boolean);

    // If browser permission not yet asked, ask now
    if (anyEnabled && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      setPushStatus(permission);

      if (permission === 'granted') {
        await subscribeUserToPush(currentUser.id);
        showToast('🔔 Push notifications enabled!');
      } else {
        showToast('Push notifications blocked. Enable in browser settings.', 'error');
      }
      return;
    }

    if (anyEnabled && Notification.permission === 'granted') {
      await subscribeUserToPush(currentUser.id);
      showToast('🔔 Notification preference saved!');
    } else if (!anyEnabled) {
      await unsubscribeFromPush(currentUser.id);
      showToast('🔕 All notifications turned off.');
    }
  };

  // ── Subscribe this browser to Web Push ────────────────────────────────────
  const subscribeUserToPush = async (userId) => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      await supabase.from('push_subscriptions').upsert(
        { user_id: userId, subscription: subscription.toJSON() },
        { onConflict: 'user_id' }
      );
    } catch (err) {
      console.error('Subscribe failed:', err);
    }
  };

  // ── Remove subscription from Supabase (user turned off all notifs) ─────────
  const unsubscribeFromPush = async (userId) => {
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) await subscription.unsubscribe();
      }
      await supabase.from('push_subscriptions').delete().eq('user_id', userId);
    } catch (err) {
      console.error('Unsubscribe failed:', err);
    }
  };

  const handleSaveReminderDays = async (days) => {
    setReminderDays(days);
    await supabase
      .from('profiles')
      .update({ default_reminder_days: days })
      .eq('id', currentUser.id);
    showToast('Reminder preference saved!');
  };

  const handleSaveCurrency = async (curr) => {
    setContextCurrency(curr);
    await supabase
      .from('profiles')
      .update({ currency: curr })
      .eq('id', currentUser.id);
    showToast('Currency updated!');
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(household?.code || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    showToast('Household code copied!');
  };

  const handleShareCode = async () => {
    const shareData = {
      title: 'Join my HomeSync Household!',
      text: `Join "${household?.name}" on HomeSync! Code: ${household?.code}`,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); }
      catch { handleCopyCode(); }
    } else {
      handleCopyCode();
    }
  };

  const handleChangePassword = async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(
      profile?.email,
      { redirectTo: 'http://localhost:5173/reset-password' }
    );
    if (error) {
      showToast('Failed to send reset email.', 'error');
    } else {
      showToast('Password reset email sent! Check your inbox. ✅');
    }
  };

  const handleEditHousehold = async () => {
    if (!newHouseholdName.trim()) {
      showToast('Household name cannot be empty.', 'error');
      return;
    }
    setLoading(true);
    await supabase
      .from('households')
      .update({ name: newHouseholdName.trim() })
      .eq('id', household.id);
    setHousehold(prev => ({ ...prev, name: newHouseholdName.trim() }));
    setShowEditHouseholdModal(false);
    showToast('Household name updated! ✅');
    setLoading(false);
  };

  const handleKickMember = async (member) => {
    await supabase
      .from('household_members')
      .update({ status: 'inactive' })
      .eq('id', member.id);

    await supabase.from('notifications').insert({
      user_id: member.user_id,
      title: 'Removed from Household',
      message: `You have been removed from "${household?.name}".`,
      type: 'kicked',
    });

    setHouseholdMembers(prev => prev.filter(m => m.id !== member.id));
    showToast(`${member.profiles?.full_name} removed.`);
  };

  const handleTransferOwnership = async () => {
    if (!transferTarget) {
      showToast('Please select a member.', 'error');
      return;
    }
    setLoading(true);

    await supabase
      .from('household_members')
      .update({ role: 'member' })
      .eq('user_id', currentUser.id)
      .eq('household_id', household.id);

    await supabase
      .from('household_members')
      .update({ role: 'owner' })
      .eq('user_id', transferTarget)
      .eq('household_id', household.id);

    await supabase
      .from('households')
      .update({ created_by: transferTarget })
      .eq('id', household.id);

    await supabase.from('notifications').insert({
      user_id: transferTarget,
      title: 'You are now the Owner! 👑',
      message: `${profile?.full_name} transferred ownership of "${household?.name}" to you!`,
      type: 'ownership_transfer',
    });

    setShowTransferModal(false);
    setIsAdmin(false);
    showToast('Ownership transferred! ✅');
    setLoading(false);
  };

  const handleDeleteHousehold = async () => {
    setLoading(true);
    await supabase.from('household_members').delete().eq('household_id', household.id);
    await supabase.from('expenses').delete().eq('household_id', household.id);
    await supabase.from('utilities').delete().eq('household_id', household.id);
    await supabase.from('households').delete().eq('id', household.id);
    await supabase
      .from('profiles')
      .update({ household_id: null })
      .eq('id', currentUser.id);
    setLoading(false);
    navigate('/dashboard');
    showToast('Household deleted.');
  };

  const handleLeaveHousehold = async () => {
    setLoading(true);
    await supabase
      .from('household_members')
      .update({ status: 'inactive' })
      .eq('user_id', currentUser.id)
      .eq('household_id', household.id);

    await supabase
      .from('profiles')
      .update({ household_id: null })
      .eq('id', currentUser.id);

    await supabase.from('notifications').insert({
      user_id: household.created_by,
      title: 'Member Left Household',
      message: `${profile?.full_name} left "${household?.name}".`,
      type: 'member_left',
    });

    setLoading(false);
    navigate('/dashboard');
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword.trim()) {
      setDeletePasswordError('Please enter your password to confirm.');
      return;
    }
    setLoading(true);
    setDeletePasswordError('');

    // Re-authenticate with password first
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: profile?.email,
      password: deletePassword,
    });

    if (authError) {
      setDeletePasswordError('Incorrect password. Please try again.');
      setLoading(false);
      return;
    }

    await supabase
      .from('profiles')
      .update({ deleted: true })
      .eq('id', currentUser.id);

    await supabase
      .from('household_members')
      .update({ status: 'inactive' })
      .eq('user_id', currentUser.id);

    await supabase.auth.signOut();
    navigate('/');
  };

  const handleExportData = async () => {
    try {
      const { data: expenses } = await supabase
        .from('expenses')
        .select('*')
        .eq('household_id', profile?.household_id)
        .order('expense_date', { ascending: false });

      const doc = new jsPDF();

      doc.setFontSize(20);
      doc.setTextColor(59, 42, 171);
      doc.text('HomeSync — My Data Export', 14, 20);

      doc.setFontSize(12);
      doc.setTextColor(100);
      doc.text(`User: ${profile?.full_name}`, 14, 30);
      doc.text(`Email: ${profile?.email}`, 14, 38);
      doc.text(`Household: ${household?.name || 'N/A'}`, 14, 46);
      doc.text(`Exported: ${new Date().toLocaleDateString()}`, 14, 54);

      autoTable(doc, {
        startY: 62,
        head: [['Title', 'Category', 'Amount', 'Date', 'Status']],
        body: (expenses || []).map(e => [
          e.title,
          e.category,
          `₱${Number(e.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
          e.expense_date,
          e.status,
        ]),
        styles: { font: 'helvetica', fontSize: 9 },
        headStyles: { fillColor: [59, 42, 171] },
      });

      doc.save(`HomeSync-MyData-${profile?.full_name}.pdf`);
      showToast('Data exported! ✅');
    } catch {
      showToast('Export failed.', 'error');
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  const toggleSection = (section) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const handleOpenPaymentModal = () => {
    setPaymentForm({
      gcash_number: profile?.gcash_number || '',
      gcash_account_name: profile?.gcash_account_name || '',
      paymaya_number: profile?.paymaya_number || '',
      paymaya_account_name: profile?.paymaya_account_name || '',
      bank_name: profile?.bank_name || '',
      bank_account_number: profile?.bank_account_number || '',
      bank_account_name: profile?.bank_account_name || '',
    });
    setPaymentSuccess(false);
    setShowPaymentModal(true);
  };

  const handleSavePaymentDetails = async () => {
    setPaymentLoading(true);
    const { error } = await supabase
      .from('profiles')
      .update({
        gcash_number: paymentForm.gcash_number,
        gcash_account_name: paymentForm.gcash_account_name,
        paymaya_number: paymentForm.paymaya_number,
        paymaya_account_name: paymentForm.paymaya_account_name,
        bank_name: paymentForm.bank_name,
        bank_account_number: paymentForm.bank_account_number,
        bank_account_name: paymentForm.bank_account_name,
      })
      .eq('id', currentUser.id);

    if (error) {
      showToast('Failed to save payment details.', 'error');
    } else {
      setProfile(prev => ({
        ...prev,
        gcash_number: paymentForm.gcash_number,
        gcash_account_name: paymentForm.gcash_account_name,
        paymaya_number: paymentForm.paymaya_number,
        paymaya_account_name: paymentForm.paymaya_account_name,
        bank_name: paymentForm.bank_name,
        bank_account_number: paymentForm.bank_account_number,
        bank_account_name: paymentForm.bank_account_name,
      }));
      setPaymentSuccess(true);
      setTimeout(() => {
        setShowPaymentModal(false);
        setPaymentSuccess(false);
      }, 1500);
    }
    setPaymentLoading(false);
  };

  const Toggle = ({ value, onToggle }) => (
    <div
      className={`toggle-switch ${value ? 'on' : ''}`}
      onClick={onToggle}
    >
      <div className="toggle-knob"/>
    </div>
  );

  const REMINDER_OPTIONS = [3, 5, 7, 14];
  const CURRENCIES = ['PHP', 'USD', 'EUR', 'SGD', 'JPY'];

  // Helper: push status badge shown next to "Notifications" section title
  const PushStatusBadge = () => {
    if (pushStatus === 'granted') {
      return <span style={{ fontSize: 10, background: '#f0fff4', color: '#38a169', fontWeight: 700, padding: '2px 8px', borderRadius: 50, marginLeft: 6 }}>✓ Enabled</span>;
    }
    if (pushStatus === 'denied') {
      return <span style={{ fontSize: 10, background: '#ffe5e5', color: '#e53e3e', fontWeight: 700, padding: '2px 8px', borderRadius: 50, marginLeft: 6 }}>Blocked</span>;
    }
    if (pushStatus === 'unsupported') {
      return <span style={{ fontSize: 10, background: '#F0EDFF', color: '#9E8FCC', fontWeight: 700, padding: '2px 8px', borderRadius: 50, marginLeft: 6 }}>Not supported</span>;
    }
    return null;
  };

  return (
    <div className={`settings-screen ${isDark ? 'dark' : ''}`}>

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.message}</div>
      )}

      {/* TopBar */}
      <TopBar
        profile={profile}
        setProfile={setProfile}
        household={household}
        currentUser={currentUser}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAllRead={markAllRead}
        title="HomeSync"
        showBell={true}
      />

      {/* Screen Title */}
      <div className="settings-title-section">
        <h2 className="settings-title">Settings</h2>
        <p className="settings-subtitle">Manage your account & preferences</p>
      </div>

      {/* Scrollable Content */}
      <div className="settings-content">

        {/* Profile Section */}
        <div className="settings-section">
          <div className="settings-profile-row">
            <div className="settings-avatar">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="settings-avatar-img"/>
              ) : (
                profile?.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
              )}
            </div>
            <div className="settings-profile-info">
              <p className="settings-profile-name">{profile?.full_name}</p>
              <p className="settings-profile-email">{profile?.email}</p>
              <span className="settings-role-badge">
                {isAdmin ? '👑 Owner' : '👤 Member'}
              </span>
            </div>
          </div>

          {/* Payment Details */}
          <button
            className="settings-row"
            onClick={() => toggleSection('payment')}
          >
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple">💳</div>
              <span>Payment Details</span>
            </div>
            <ChevronRight
              size={16}
              className={`chevron ${expandedSection === 'payment' ? 'open' : ''}`}
            />
          </button>

          {expandedSection === 'payment' && (
            <div className="settings-expanded">
              <div className="payment-detail-row">
                <span className="payment-label">GCash Name</span>
                <span className="payment-value">{profile?.gcash_account_name || 'Not set'}</span>
              </div>
              <div className="payment-detail-row">
                <span className="payment-label">GCash Number</span>
                <span className="payment-value">{profile?.gcash_number || 'Not set'}</span>
              </div>
              <div className="payment-detail-row">
                <span className="payment-label">PayMaya Name</span>
                <span className="payment-value">{profile?.paymaya_account_name || 'Not set'}</span>
              </div>
              <div className="payment-detail-row">
                <span className="payment-label">PayMaya Number</span>
                <span className="payment-value">{profile?.paymaya_number || 'Not set'}</span>
              </div>
              <div className="payment-detail-row">
                <span className="payment-label">Bank</span>
                <span className="payment-value">{profile?.bank_name || 'Not set'}</span>
              </div>
              <div className="payment-detail-row">
                <span className="payment-label">Account #</span>
                <span className="payment-value">{profile?.bank_account_number || 'Not set'}</span>
              </div>
              <div className="payment-detail-row">
                <span className="payment-label">Account Name</span>
                <span className="payment-value">{profile?.bank_account_name || 'Not set'}</span>
              </div>
              <button
                onClick={handleOpenPaymentModal}
                style={{
                  marginTop: 6,
                  width: '100%',
                  background: '#3B2AAB',
                  color: 'white',
                  border: 'none',
                  borderRadius: 50,
                  padding: '10px 0',
                  fontFamily: 'Poppins, sans-serif',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                ✏️ Edit Payment Details
              </button>
            </div>
          )}
        </div>

        {/* Household Section */}
        {household && (
          <div className="settings-section">
            <p className="settings-section-title"><Home size={16}/> Household</p>

            <div className="settings-household-info">
              <p className="household-name-display">🏠 {household.name}</p>
              <div className="household-code-row">
                <span className="household-code-label">Code:</span>
                <span className="household-code-value">{household.code}</span>
                <button className="code-action-btn" onClick={handleCopyCode} title="Copy code">
                  {copied ? <Check size={14}/> : <Copy size={14}/>}
                </button>
                <button className="code-action-btn" onClick={handleShareCode} title="Share code">
                  <Share2 size={14}/>
                </button>
              </div>
            </div>

            {isAdmin ? (
              <>
                <button className="settings-row" onClick={() => setShowEditHouseholdModal(true)}>
                  <div className="settings-row-left">
                    <div className="settings-icon-wrap purple">✏️</div>
                    <span>Edit Household Name</span>
                  </div>
                  <ChevronRight size={16}/>
                </button>

                <button className="settings-row" onClick={() => setShowMembersModal(true)}>
                  <div className="settings-row-left">
                    <div className="settings-icon-wrap purple">👥</div>
                    <span>Manage Members</span>
                  </div>
                  <ChevronRight size={16}/>
                </button>

                <button className="settings-row" onClick={() => setShowTransferModal(true)}>
                  <div className="settings-row-left">
                    <div className="settings-icon-wrap yellow">👑</div>
                    <span>Transfer Ownership</span>
                  </div>
                  <ChevronRight size={16}/>
                </button>

                <button className="settings-row danger" onClick={() => setShowDeleteHouseholdModal(true)}>
                  <div className="settings-row-left">
                    <div className="settings-icon-wrap red">🗑️</div>
                    <span>Delete Household</span>
                  </div>
                  <ChevronRight size={16}/>
                </button>
              </>
            ) : (
              <button className="settings-row danger" onClick={() => setShowLeaveModal(true)}>
                <div className="settings-row-left">
                  <div className="settings-icon-wrap red">🚪</div>
                  <span>Leave Household</span>
                </div>
                <ChevronRight size={16}/>
              </button>
            )}
          </div>
        )}

        {/* Notifications */}
        <div className="settings-section">
          <p className="settings-section-title">
            <Bell size={16}/> Notifications <PushStatusBadge/>
          </p>

          {/* Show a warning if browser blocked push */}
          {pushStatus === 'denied' && (
            <div style={{
              background: '#ffe5e5', borderRadius: 10, padding: '8px 12px',
              fontSize: 11, color: '#e53e3e', marginBottom: 8, lineHeight: 1.5
            }}>
              ⚠️ Push notifications are blocked in your browser. Go to your browser settings → Site Settings → Notifications → Allow for this site.
            </div>
          )}

          {[
            { key: 'expense_approvals',     label: 'Expense Approvals',     icon: '💸' },
            { key: 'payment_confirmations', label: 'Payment Confirmations', icon: '✅' },
            { key: 'utility_reminders',     label: 'Utility Reminders',     icon: '🏠' },
            { key: 'report_schedules',      label: 'Report Schedules',      icon: '📊' },
            { key: 'group_invites',         label: 'Group Invites',         icon: '👥' },
          ].map(item => (
            <div key={item.key} className="settings-row">
              <div className="settings-row-left">
                <div className="settings-icon-wrap purple">{item.icon}</div>
                <span>{item.label}</span>
              </div>
              <Toggle
                value={notifPrefs[item.key]}
                onToggle={() => handleToggleNotif(item.key)}
              />
            </div>
          ))}

          <div className="settings-row no-border">
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple">⏰</div>
              <span>Default Reminder</span>
            </div>
            <div className="reminder-options-row">
              {REMINDER_OPTIONS.map(d => (
                <button
                  key={d}
                  className={`reminder-chip ${reminderDays === d ? 'active' : ''}`}
                  onClick={() => handleSaveReminderDays(d)}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* App Preferences */}
        <div className="settings-section">
          <p className="settings-section-title">
            <Palette size={16}/> App Preferences
          </p>

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple">
                {isDark ? '🌙' : '☀️'}
              </div>
              <span>Dark Mode</span>
            </div>
            <Toggle value={isDark} onToggle={handleToggleDark}/>
          </div>

          <div className="settings-row no-border">
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple">💱</div>
              <span>Currency</span>
            </div>
            <div className="currency-options">
              {CURRENCIES.map(c => (
                <button
                  key={c}
                  className={`currency-chip ${currency === c ? 'active' : ''}`}
                  onClick={() => handleSaveCurrency(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Security */}
        <div className="settings-section">
          <p className="settings-section-title">
            <Shield size={16}/> Security
          </p>

          <button className="settings-row" onClick={handleChangePassword}>
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple">🔑</div>
              <span>Change Password</span>
            </div>
            <ChevronRight size={16}/>
          </button>

          <button className="settings-row no-border" onClick={() => toggleSection('sessions')}>
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple">📱</div>
              <span>Active Sessions</span>
            </div>
            <ChevronRight
              size={16}
              className={`chevron ${expandedSection === 'sessions' ? 'open' : ''}`}
            />
          </button>

          {expandedSection === 'sessions' && (
            <div className="settings-expanded">
              <div className="session-item">
                <span className="session-device">🌐 Web Browser</span>
                <span className="session-active">Active now</span>
              </div>
            </div>
          )}
        </div>

        {/* Data & Privacy */}
        <div className="settings-section">
          <p className="settings-section-title">
            <Database size={16}/> Data & Privacy
          </p>

          <button className="settings-row" onClick={handleExportData}>
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple">
                <Download size={16}/>
              </div>
              <span>Export My Data (PDF)</span>
            </div>
            <ChevronRight size={16}/>
          </button>

          <button
            className="settings-row danger no-border"
            onClick={() => setShowDeleteAccountModal(true)}
          >
            <div className="settings-row-left">
              <div className="settings-icon-wrap red">⚠️</div>
              <span>Delete My Account</span>
            </div>
            <ChevronRight size={16}/>
          </button>
        </div>

        {/* About */}
        <div className="settings-section">
          <p className="settings-section-title">
            <Info size={16}/> About
          </p>

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple">📱</div>
              <span>Version</span>
            </div>
            <span className="settings-value">v1.0.0</span>
          </div>

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple">❤️</div>
              <span>Made with love</span>
            </div>
            <span className="settings-value">HomeSync Team</span>
          </div>

          <button className="settings-row no-border" onClick={() => setShowTermsModal(true)}>
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple">📄</div>
              <span>Terms of Service</span>
            </div>
            <ChevronRight size={16}/>
          </button>
        </div>

        {/* Sign Out */}
        <button
          className="signout-row"
          onClick={() => setShowSignOutModal(true)}
        >
          <LogOut size={18}/>
          <span>Sign Out</span>
        </button>

      </div>

      {/* Payment Details Modal */}
      {showPaymentModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal">
            <div className="modal-top-row">
              <h2>💳 Payment Details</h2>
              <button className="modal-x-btn" onClick={() => setShowPaymentModal(false)}>
                <X size={18}/>
              </button>
            </div>

            {paymentSuccess ? (
              <div style={{ textAlign: 'center', padding: '16px 0', fontSize: 14, color: '#38a169', fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>
                ✅ Payment details updated!
              </div>
            ) : (
              <>
                <p style={{ fontSize: 10, color: '#9E8FCC', fontStyle: 'italic', margin: '0 0 4px', paddingLeft: 4, fontFamily: 'Poppins, sans-serif' }}>
                  These GCash/PayMaya details are shown to members when they use "Pay Online" for household bills you created.
                </p>
                <div className="topbar-input-group" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA', paddingLeft: 4, fontFamily: 'Poppins, sans-serif' }}>GCash Account Name</label>
                  <input
                    type="text"
                    className="settings-modal-input"
                    value={paymentForm.gcash_account_name}
                    onChange={e => setPaymentForm({ ...paymentForm, gcash_account_name: e.target.value })}
                    placeholder="e.g. Juan D."
                  />
                </div>
                <div className="topbar-input-group" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA', paddingLeft: 4, fontFamily: 'Poppins, sans-serif' }}>GCash Number</label>
                  <input
                    type="text"
                    className="settings-modal-input"
                    value={paymentForm.gcash_number}
                    onChange={e => setPaymentForm({ ...paymentForm, gcash_number: e.target.value })}
                    placeholder="e.g. 09XX XXX XXXX"
                  />
                </div>
                <div className="topbar-input-group" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA', paddingLeft: 4, fontFamily: 'Poppins, sans-serif' }}>PayMaya Account Name</label>
                  <input
                    type="text"
                    className="settings-modal-input"
                    value={paymentForm.paymaya_account_name}
                    onChange={e => setPaymentForm({ ...paymentForm, paymaya_account_name: e.target.value })}
                    placeholder="e.g. Juan D."
                  />
                </div>
                <div className="topbar-input-group" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA', paddingLeft: 4, fontFamily: 'Poppins, sans-serif' }}>PayMaya Number</label>
                  <input
                    type="text"
                    className="settings-modal-input"
                    value={paymentForm.paymaya_number}
                    onChange={e => setPaymentForm({ ...paymentForm, paymaya_number: e.target.value })}
                    placeholder="e.g. 09XX XXX XXXX"
                  />
                </div>
                <div className="topbar-input-group" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA', paddingLeft: 4, fontFamily: 'Poppins, sans-serif' }}>Bank Name</label>
                  <input
                    type="text"
                    className="settings-modal-input"
                    value={paymentForm.bank_name}
                    onChange={e => setPaymentForm({ ...paymentForm, bank_name: e.target.value })}
                    placeholder="e.g. BDO, BPI, Metrobank"
                  />
                </div>
                <div className="topbar-input-group" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA', paddingLeft: 4, fontFamily: 'Poppins, sans-serif' }}>Bank Account Number</label>
                  <input
                    type="text"
                    className="settings-modal-input"
                    value={paymentForm.bank_account_number}
                    onChange={e => setPaymentForm({ ...paymentForm, bank_account_number: e.target.value })}
                    placeholder="Account number"
                  />
                </div>
                <div className="topbar-input-group" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#5A4AAA', paddingLeft: 4, fontFamily: 'Poppins, sans-serif' }}>Account Name</label>
                  <input
                    type="text"
                    className="settings-modal-input"
                    value={paymentForm.bank_account_name}
                    onChange={e => setPaymentForm({ ...paymentForm, bank_account_name: e.target.value })}
                    placeholder="Account name"
                  />
                </div>
                <button className="modal-primary-btn" onClick={handleSavePaymentDetails} disabled={paymentLoading}>
                  {paymentLoading ? 'Saving...' : 'Save Payment Details'}
                </button>
                <button className="modal-ghost-btn" onClick={() => setShowPaymentModal(false)}>Cancel</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sign Out Modal */}
      {showSignOutModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal">
            <p className="modal-emoji">🥺</p>
            <h2>DON'T GO YET!</h2>
            <p className="modal-msg">
              Your expenses might get lonely without you!<br/>
              Are you sure you want to sign out?
            </p>
            <p className="modal-sub">We'd love for you to stick around!</p>
            <button className="modal-primary-btn" onClick={() => setShowSignOutModal(false)}>STAY</button>
            <button className="modal-ghost-btn" onClick={handleSignOut}>Log out 😢</button>
          </div>
        </div>
      )}

      {/* Delete Account Modal */}
      {showDeleteAccountModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal">
            <AlertCircle size={40} color="#e53e3e"/>
            <h2>Delete Account?</h2>
            <p className="modal-msg">
              Your expenses will remain visible to your household admin.
              This action <strong>cannot be undone</strong>.
            </p>
            <p className="modal-msg" style={{ fontSize: 12 }}>
              Enter your password to confirm:
            </p>
            <input
              type="password"
              className="settings-modal-input"
              placeholder="Your password"
              value={deletePassword}
              onChange={e => { setDeletePassword(e.target.value); setDeletePasswordError(''); }}
              style={{ borderColor: deletePasswordError ? '#e53e3e' : undefined }}
            />
            {deletePasswordError && (
              <p style={{ fontSize: 11, color: '#e53e3e', margin: 0, alignSelf: 'flex-start', paddingLeft: 8 }}>
                {deletePasswordError}
              </p>
            )}
            <button className="modal-danger-btn" onClick={handleDeleteAccount} disabled={loading}>
              {loading ? 'Deleting...' : 'Yes, Delete My Account'}
            </button>
            <button className="modal-ghost-btn" onClick={() => {
              setShowDeleteAccountModal(false);
              setDeletePassword('');
              setDeletePasswordError('');
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Delete Household Modal */}
      {showDeleteHouseholdModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal">
            <AlertCircle size={40} color="#e53e3e"/>
            <h2>Delete Household?</h2>
            <p className="modal-msg">
              This will permanently delete "{household?.name}" and all its expenses. This cannot be undone.
            </p>
            <button className="modal-danger-btn" onClick={handleDeleteHousehold} disabled={loading}>
              {loading ? 'Deleting...' : 'Yes, Delete Household'}
            </button>
            <button className="modal-ghost-btn" onClick={() => setShowDeleteHouseholdModal(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Leave Household Modal */}
      {showLeaveModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal">
            <AlertCircle size={40} color="#e53e3e"/>
            <h2>Leave Household?</h2>
            <p className="modal-msg">You will no longer have access to "{household?.name}".</p>
            <button className="modal-danger-btn" onClick={handleLeaveHousehold} disabled={loading}>
              {loading ? 'Leaving...' : 'Yes, Leave'}
            </button>
            <button className="modal-ghost-btn" onClick={() => setShowLeaveModal(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Edit Household Modal */}
      {showEditHouseholdModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal">
            <h2>Edit Household Name</h2>
            <input
              type="text"
              className="settings-modal-input"
              value={newHouseholdName}
              onChange={e => setNewHouseholdName(e.target.value)}
              placeholder="Household name"
            />
            <button className="modal-primary-btn" onClick={handleEditHousehold} disabled={loading}>
              {loading ? 'Saving...' : 'Save'}
            </button>
            <button className="modal-ghost-btn" onClick={() => setShowEditHouseholdModal(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Manage Members Modal */}
      {showMembersModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal wide">
            <div className="modal-top-row">
              <h2>Manage Members</h2>
              <button className="modal-x-btn" onClick={() => setShowMembersModal(false)}>
                <X size={18}/>
              </button>
            </div>
            {householdMembers
              .filter(m => m.status !== 'inactive')
              .map(m => (
                <div key={m.id} className="member-manage-row">
                  <div className="member-manage-avatar">
                    {m.profiles?.avatar_url ? (
                      <img src={m.profiles.avatar_url} alt="" className="member-manage-img"/>
                    ) : (
                      m.profiles?.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div className="member-manage-info">
                    <p className="member-manage-name">{m.profiles?.full_name}</p>
                    <p className="member-manage-role">{m.role === 'owner' ? '👑 Owner' : '👤 Member'}</p>
                  </div>
                  {m.user_id !== currentUser?.id && (
                    <button className="kick-member-btn" onClick={() => handleKickMember(m)}>
                      <UserMinus size={14}/>
                    </button>
                  )}
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* Transfer Ownership Modal */}
      {showTransferModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal">
            <h2>Transfer Ownership</h2>
            <p className="modal-msg">Select a member to become the new owner</p>
            <div className="transfer-members">
              {householdMembers
                .filter(m => m.user_id !== currentUser?.id && m.status !== 'inactive')
                .map(m => (
                  <button
                    key={m.user_id}
                    className={`transfer-member-btn ${transferTarget === m.user_id ? 'active' : ''}`}
                    onClick={() => setTransferTarget(m.user_id)}
                  >
                    <Crown size={14}/>
                    {m.profiles?.full_name}
                  </button>
                ))
              }
            </div>
            <button
              className="modal-primary-btn"
              onClick={handleTransferOwnership}
              disabled={loading || !transferTarget}
            >
              {loading ? 'Transferring...' : 'Confirm Transfer'}
            </button>
            <button className="modal-ghost-btn" onClick={() => setShowTransferModal(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Terms of Service Modal */}
      {showTermsModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal wide" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
            <div className="modal-top-row">
              <h2>📄 Terms of Service</h2>
              <button className="modal-x-btn" onClick={() => setShowTermsModal(false)}><X size={18}/></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, fontFamily: 'Poppins, sans-serif' }}>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Last updated: January 2025</p>

              <div>
                <p style={{ fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>1. Acceptance of Terms</p>
                <p style={{ margin: 0 }}>By using HomeSync, you agree to be bound by these Terms of Service. If you do not agree, please do not use the app.</p>
              </div>

              <div>
                <p style={{ fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>2. Use of the Service</p>
                <p style={{ margin: 0 }}>HomeSync is a household expense tracking tool. You may use it only for lawful purposes. You are responsible for all activity under your account.</p>
              </div>

              <div>
                <p style={{ fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>3. Account Responsibility</p>
                <p style={{ margin: 0 }}>You are responsible for keeping your password secure. HomeSync is not liable for any loss due to unauthorized access to your account.</p>
              </div>

              <div>
                <p style={{ fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>4. Data & Privacy</p>
                <p style={{ margin: 0 }}>We collect only the data necessary to provide the service (expenses, household information, profile details). We do not sell your data to third parties. Expense data may remain visible to household admins even after you leave a household.</p>
              </div>

              <div>
                <p style={{ fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>5. User Content</p>
                <p style={{ margin: 0 }}>Any expense data, payment proofs, or other content you upload remains yours. By uploading content, you grant HomeSync a license to display it to authorized household members.</p>
              </div>

              <div>
                <p style={{ fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>6. Account Deletion</p>
                <p style={{ margin: 0 }}>You may delete your account at any time from Settings. Upon deletion, your profile is marked inactive. Shared expense records will remain visible to your household for record-keeping purposes.</p>
              </div>

              <div>
                <p style={{ fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>7. Disclaimer</p>
                <p style={{ margin: 0 }}>HomeSync is provided "as is" without warranties of any kind. We are not responsible for any financial decisions made based on data shown in the app.</p>
              </div>

              <div>
                <p style={{ fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>8. Changes to Terms</p>
                <p style={{ margin: 0 }}>We may update these terms from time to time. Continued use of the app after changes constitutes acceptance of the new terms.</p>
              </div>

              <div>
                <p style={{ fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>9. Contact</p>
                <p style={{ margin: 0 }}>For questions about these terms, contact us at support@homesync.app</p>
              </div>
            </div>
            <button className="modal-primary-btn" onClick={() => setShowTermsModal(false)} style={{ marginTop: 8 }}>Got it</button>
          </div>
        </div>
      )}

      <BottomNav active="settings"/>
    </div>
  );
}