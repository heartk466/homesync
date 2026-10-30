import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { withTimeout } from '../utils/withTimeout';
import {
  User, Bell, Palette, Shield,
  Database, Info, LogOut, ChevronRight,
  Trash2,
  Download, X, AlertCircle, QrCode, ImagePlus,
  LifeBuoy, Bug, MessageSquare, Plus, Smartphone, Tablet, Monitor
} from 'lucide-react';

// ─── Support inbox — bug reports & feedback land here ─────────────────────────
const SUPPORT_EMAIL = 'homesync466@gmail.com';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import HouseholdsSection from '../components/HouseholdsSection';
import { exportMyMonthlyData } from '../utils/myDataExport';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { uploadPaymentQr } from '../utils/paymentUtils';
import { describeDevice } from '../utils/deviceInfo';
import './SettingsScreen.css';

// Custom due-date reminders: how many a user can have, and the furthest-ahead day allowed
const MAX_REMINDERS = 5;
const MAX_REMINDER_DAYS = 60;
import { useAppContext } from '../appContextCore';
import { Icon, InlineIcon, CategoryIcon, StatusIcon } from '../components/Icon';
import { ICONS, CATEGORY_ICON, SUBSCRIPTION_ICON, NOTIF_ICON } from '../utils/iconMap';
import { useCachedState, useScreenLoad } from '../utils/screenCache';
import { LoadGate, SettingsSkeleton } from '../components/Skeleton';

function Toggle({ value, onToggle }) {
  return (
    <div
      className={`toggle-switch ${value ? 'on' : ''}`}
      onClick={onToggle}
    >
      <div className="toggle-knob"/>
    </div>
  );
}

function PushStatusBadge({ pushStatus }) {
  if (pushStatus === 'enabled') {
    return <span style={{ fontSize: 10, background: '#f0fff4', color: '#38a169', fontWeight: 700, padding: '2px 8px', borderRadius: 50, marginLeft: 6 }}>✓ Enabled</span>;
  }
  if (pushStatus === 'denied') {
    return <span style={{ fontSize: 10, background: '#ffe5e5', color: '#e53e3e', fontWeight: 700, padding: '2px 8px', borderRadius: 50, marginLeft: 6 }}>Blocked</span>;
  }
  if (pushStatus === 'unsupported') {
    return <span style={{ fontSize: 10, background: '#F0EDFF', color: '#9E8FCC', fontWeight: 700, padding: '2px 8px', borderRadius: 50, marginLeft: 6 }}>Not supported</span>;
  }
  if (pushStatus === 'unavailable') {
    return <span style={{ fontSize: 10, background: '#fffaf0', color: '#c05621', fontWeight: 700, padding: '2px 8px', borderRadius: 50, marginLeft: 6 }}>Unavailable</span>;
  }
  if (pushStatus === 'not-enabled') {
    return <span style={{ fontSize: 10, background: '#F0EDFF', color: '#9E8FCC', fontWeight: 700, padding: '2px 8px', borderRadius: 50, marginLeft: 6 }}>Not set up</span>;
  }
  return null;
}

export default function SettingsScreen() {
  const navigate = useNavigate();

  const [profile, setProfile] = useCachedState('settings', 'profile', null);
  const [currentUser, setCurrentUser] = useCachedState('settings', 'currentUser', null);
  const [household, setHousehold] = useCachedState('settings', 'household', null);
  const [isAdmin, setIsAdmin] = useCachedState('settings', 'isAdmin', false);
  const [notifications, setNotifications] = useCachedState('settings', 'notifications', []);
  const [unreadCount, setUnreadCount] = useCachedState('settings', 'unreadCount', 0);
  const [notifPrefs, setNotifPrefs] = useCachedState('settings', 'notifPrefs', {
    expense_approvals: true,
    payment_confirmations: true,
    utility_reminders: true,
    report_schedules: true,
    group_invites: true,
  });
  // Which days before a due date this user wants a reminder (0 = on the due date)
  const [reminderDays, setReminderDays] = useCachedState('settings', 'reminderDays', [3]);
  const [showCustomReminder, setShowCustomReminder] = useState(false);
  const [customDayInput, setCustomDayInput] = useState('');

  const { currency, setCurrency: setContextCurrency, isDark, setIsDark: setContextDark } = useAppContext();

  // UI State
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [toast, setToast] = useState(null);

  // Bug report / feedback modal
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackType, setFeedbackType] = useState('bug'); // 'bug' | 'feedback'
  const [feedbackSubject, setFeedbackSubject] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackError, setFeedbackError] = useState('');
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const load = useScreenLoad('settings');
  const { done: loadDone, fail: loadFail } = load;
  const [expandedSection, setExpandedSection] = useState(null);
  // Active Sessions: what this device is (model, OS, app or browser)
  const [thisDevice, setThisDevice] = useState(null);
  useEffect(() => {
    let alive = true;
    describeDevice().then((d) => { if (alive) setThisDevice(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Delete account password confirmation
  const [deletePassword, setDeletePassword] = useState('');
  const [deletePasswordError, setDeletePasswordError] = useState('');

  // Payment Details modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ gcash_number: '', gcash_account_name: '', gcash_qr_url: '', paymaya_number: '', paymaya_account_name: '', paymaya_qr_url: '', bank_name: '', bank_account_number: '', bank_account_name: '' });
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  // QR code uploads (GCash / PayMaya) inside the Payment Details modal
  const [qrUploading, setQrUploading] = useState({ gcash: false, paymaya: false });
  const gcashQrInputRef = React.useRef(null);
  const paymayaQrInputRef = React.useRef(null);

  const { pushStatus, requestPermission, subscribe, unsubscribe } = usePushNotifications(currentUser?.id);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchData = useCallback(async () => {
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
      if (Array.isArray(profileData?.reminder_days)) {
        setReminderDays(profileData.reminder_days);
      } else if (profileData?.default_reminder_days) {
        setReminderDays([profileData.default_reminder_days]);
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
        setIsAdmin(householdData?.created_by === user.id);
      } else {
        setHousehold(null);
        setIsAdmin(false);
      }

      const { data: notifData } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      setNotifications(notifData || []);
      setUnreadCount((notifData || []).filter(n => !n.is_read).length);
      loadDone();
    } catch (err) {
      loadFail(err);
    }
  }, [navigate, setContextCurrency, setContextDark, loadDone, loadFail, setCurrentUser, setHousehold, setIsAdmin, setNotifPrefs, setNotifications, setProfile, setReminderDays, setUnreadCount]);

  const markAllRead = async () => {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', currentUser.id)
      .eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleToggleDark = async () => {
    const next = !isDark;
    const newTheme = next ? 'dark' : 'light';
    setContextDark(next);
    setProfile(p => (p ? { ...p, theme: newTheme } : p));
    const { error } = await supabase
      .from('profiles')
      .update({ theme: newTheme })
      .eq('id', currentUser.id);
    if (error) { setContextDark(!next); showToast('Could not save theme', 'error'); return; }
    showToast(`${next ? 'Dark' : 'Light'} mode enabled`);
  };

  // ── Toggle a notification preference + re-subscribe / unsubscribe if needed ─
  // Explicit "Turn on phone notifications" (needs a tap: iPhones only ask for permission from a user action)
  const [pushBusy, setPushBusy] = useState(false);
  const handleEnablePush = async () => {
    setPushBusy(true);
    const permission = await requestPermission();
    if (permission === 'granted') {
      const ok = await subscribe(currentUser.id);
      showToast(ok ? 'Phone notifications are on for this device.' : 'Could not turn on phone notifications here.', ok ? 'success' : 'error');
    } else if (permission === 'unsupported') {
      showToast('This browser can’t receive phone notifications. On iPhone, open HomeSync from your Home Screen.', 'error');
    } else {
      showToast('Notifications are blocked. Allow them in your phone settings for HomeSync.', 'error');
    }
    setPushBusy(false);
  };

  const handleToggleNotif = async (key) => {
    const newPrefs = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(newPrefs);

    const anyEnabled = Object.values(newPrefs).some(Boolean);
    const permission = anyEnabled ? await requestPermission() : 'unsupported';

    const { error } = await supabase
      .from('profiles')
      .update({ notification_preferences: newPrefs })
      .eq('id', currentUser.id);
    if (error) {
      console.error('Could not save notification preferences:', error);
      showToast('Could not save notification preferences.', 'error');
      return;
    }

    if (!anyEnabled) {
      const removed = await unsubscribe(currentUser.id);
      showToast(
        removed ? 'All notifications turned off.' : 'Preferences were saved, but browser push could not be disabled.',
        removed ? 'success' : 'error'
      );
      return;
    }

    if (permission === 'unsupported') {
      showToast('Your browser does not support push notifications. In-app preferences were saved.', 'error');
      return;
    }

    if (permission !== 'granted') {
      showToast('In-app preferences were saved, but browser push permission was not granted.', 'error');
      return;
    }

    const subscribed = await subscribe(currentUser.id);
    if (subscribed) {
      showToast('Notification preferences and browser push are enabled!');
    } else {
      showToast('In-app preferences were saved, but browser push is unavailable in this browser.', 'error');
    }
  };

  // Multi-select: tap a chip to add / remove that reminder day
  const handleToggleReminderDay = async (day) => {
    const removing = reminderDays.includes(day);
    if (!removing && reminderDays.length >= MAX_REMINDERS) {
      showToast(`You can have up to ${MAX_REMINDERS} reminders`, 'error');
      return false;
    }
    const prev = reminderDays;
    const next = removing
      ? reminderDays.filter(d => d !== day)
      : [...reminderDays, day].sort((a, b) => a - b);
    setReminderDays(next);
    const { error } = await supabase
      .from('profiles')
      .update({ reminder_days: next })
      .eq('id', currentUser.id);
    if (error) { setReminderDays(prev); showToast('Could not save reminder preference', 'error'); return false; }
    showToast(next.length ? 'Reminder preference saved!' : 'Due date reminders are off');
    return true;
  };

  // Add a reminder day that isn't one of the preset chips
  const handleAddCustomReminder = async () => {
    const raw = customDayInput.trim();
    const day = Number(raw);
    if (raw === '' || !Number.isInteger(day) || day < 0 || day > MAX_REMINDER_DAYS) {
      showToast(`Enter a whole number from 0 to ${MAX_REMINDER_DAYS}`, 'error');
      return;
    }
    if (reminderDays.includes(day)) { showToast('You already have that reminder', 'error'); return; }
    const added = await handleToggleReminderDay(day);
    if (added) { setCustomDayInput(''); setShowCustomReminder(false); }
  };

  const handleSaveCurrency = async (curr) => {
    if (curr === currency) return;
    const prev = currency;
    setContextCurrency(curr);
    setProfile(p => (p ? { ...p, currency: curr } : p));
    const { error } = await supabase
      .from('profiles')
      .update({ currency: curr })
      .eq('id', currentUser.id);
    if (error) { setContextCurrency(prev); showToast('Could not save currency', 'error'); return; }
    showToast('Currency updated!');
  };

  const handleChangePassword = async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(
      profile?.email,
      { redirectTo: `${window.location.origin}/reset-password` }
    );
    if (error) {
      showToast('Failed to send reset email.', 'error');
    } else {
      showToast('Password reset email sent! Check your inbox.');
    }
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

    // Leaving every household first: the backend refuses while you owe shares,
    // have reviews pending, or still own a household with other members.
    const { error: leaveError } = await supabase
      .from('household_members')
      .update({ status: 'inactive' })
      .eq('user_id', currentUser.id)
      .eq('status', 'active');
    if (leaveError) {
      setDeletePasswordError(`${leaveError.message}. Check "Leave Household" on each household for what to settle.`);
      setLoading(false);
      return;
    }

    await supabase
      .from('profiles')
      .update({ deleted: true })
      .eq('id', currentUser.id);

    await supabase.auth.signOut();
    navigate('/');
  };

  // This month only, every household (see utils/myDataExport.js)
  const handleExportData = async () => {
    try {
      await exportMyMonthlyData({ userId: currentUser?.id || profile?.id, fullName: profile?.full_name, email: profile?.email });
      showToast('Data exported!');
    } catch (err) {
      console.error('Export failed:', err);
      showToast('Export failed.', 'error');
    }
  };

  const openFeedbackModal = (type) => {
    setFeedbackType(type);
    setFeedbackSubject('');
    setFeedbackMessage('');
    setFeedbackError('');
    setShowFeedbackModal(true);
  };

  // Submits a bug report / feedback message. Best-effort logs it to Supabase
  // (in case a `feedback_reports` table exists for an admin dashboard later),
  // then always opens the user's email app pre-addressed to support so the
  // message reaches us even if that table doesn't exist yet.
  const handleSubmitFeedback = async () => {
    if (!feedbackMessage.trim()) {
      setFeedbackError('Please write your message before sending.');
      return;
    }
    setFeedbackError('');
    setFeedbackLoading(true);

    const typeLabel = feedbackType === 'bug' ? 'Bug Report' : 'Feedback';
    const subjectLine = feedbackSubject.trim()
      ? `[HomeSync ${typeLabel}] ${feedbackSubject.trim()}`
      : `[HomeSync ${typeLabel}] from ${profile?.full_name || 'a user'}`;

    try {
      await supabase.from('feedback_reports').insert({
        user_id: currentUser?.id,
        household_id: household?.id,
        type: feedbackType,
        subject: feedbackSubject.trim() || null,
        message: feedbackMessage.trim(),
      });
    } catch { /* table may not exist yet — don't block the email */ }

    const bodyLines = [
      feedbackMessage.trim(),
      '',
      '── Sent from HomeSync app ──',
      `From: ${profile?.full_name || 'Unknown'} (${currentUser?.email || 'no email on file'})`,
      `Household: ${household?.name || 'N/A'}`,
      `Type: ${typeLabel}`,
    ];
    const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subjectLine)}&body=${encodeURIComponent(bodyLines.join('\n'))}`;
    window.location.href = mailtoUrl;

    setFeedbackLoading(false);
    setShowFeedbackModal(false);
    setFeedbackSubject('');
    setFeedbackMessage('');
    showToast('Opening your email app…');
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
      gcash_qr_url: profile?.gcash_qr_url || '',
      paymaya_number: profile?.paymaya_number || '',
      paymaya_account_name: profile?.paymaya_account_name || '',
      paymaya_qr_url: profile?.paymaya_qr_url || '',
      bank_name: profile?.bank_name || '',
      bank_account_number: profile?.bank_account_number || '',
      bank_account_name: profile?.bank_account_name || '',
    });
    setPaymentSuccess(false);
    setShowPaymentModal(true);
  };

  // ── Upload / replace a QR code for GCash or PayMaya ─────────────────────────
  // Uploads to the 'payment-qr' storage bucket and stores the resulting public
  // URL directly on the form (saved to the profile when "Save" is pressed, same
  // as the other fields).
  const handleQrFileSelect = async (methodKey, file) => {
    if (!file || !currentUser?.id) return;
    if (!file.type?.startsWith('image/')) {
      showToast('Please select an image file (JPG or PNG).', 'error');
      return;
    }
    setQrUploading(prev => ({ ...prev, [methodKey]: true }));
    const publicUrl = await uploadPaymentQr(currentUser.id, methodKey, file);
    setQrUploading(prev => ({ ...prev, [methodKey]: false }));

    if (!publicUrl) {
      showToast('Failed to upload QR code.', 'error');
      return;
    }
    setPaymentForm(prev => ({ ...prev, [`${methodKey}_qr_url`]: publicUrl }));
  };

  const handleRemoveQr = (methodKey) => {
    setPaymentForm(prev => ({ ...prev, [`${methodKey}_qr_url`]: '' }));
  };

  const handleSavePaymentDetails = async () => {
    setPaymentLoading(true);
    const { error } = await withTimeout(supabase
      .from('profiles')
      .update({
        gcash_number: paymentForm.gcash_number,
        gcash_account_name: paymentForm.gcash_account_name,
        gcash_qr_url: paymentForm.gcash_qr_url,
        paymaya_number: paymentForm.paymaya_number,
        paymaya_account_name: paymentForm.paymaya_account_name,
        paymaya_qr_url: paymentForm.paymaya_qr_url,
        bank_name: paymentForm.bank_name,
        bank_account_number: paymentForm.bank_account_number,
        bank_account_name: paymentForm.bank_account_name,
      })
      .eq('id', currentUser.id));

    if (error) {
      showToast('Failed to save payment details.', 'error');
    } else {
      setProfile(prev => ({
        ...prev,
        gcash_number: paymentForm.gcash_number,
        gcash_account_name: paymentForm.gcash_account_name,
        gcash_qr_url: paymentForm.gcash_qr_url,
        paymaya_number: paymentForm.paymaya_number,
        paymaya_account_name: paymentForm.paymaya_account_name,
        paymaya_qr_url: paymentForm.paymaya_qr_url,
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

  const REMINDER_OPTIONS = [
    { value: 0,  label: 'On the day' },
    { value: 1,  label: '1d before' },
    { value: 3,  label: '3d before' },
    { value: 5,  label: '5d before' },
    { value: 7,  label: '7d before' },
    { value: 14, label: '14d before' },
  ];

  // Saved days that aren't one of the preset chips (shown as removable chips)
  const customReminderDays = reminderDays.filter(d => !REMINDER_OPTIONS.some(o => o.value === d));

  const reminderSummary = () => {
    if (reminderDays.length === 0) return 'No due date reminders. Pick at least one to get notified.';
    const parts = reminderDays.map(d => (d === 0 ? 'on the due date' : `${d} day${d > 1 ? 's' : ''} before`));
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
    const phone = pushStatus === 'enabled' ? '' : ' Enable browser push notifications to get these on your phone too.';
    return `You'll be reminded at 8:00 AM, ${list}, for approved expenses you still owe.${phone}`;
  };
  const CURRENCIES = ['PHP', 'USD', 'EUR', 'SGD', 'JPY'];

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
        <LoadGate load={load} skeleton={<SettingsSkeleton />} onRetry={fetchData}>

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
                {isAdmin ? <><InlineIcon as={ICONS.owner} /> Owner</> : <><InlineIcon as={ICONS.member} /> Member</>}
              </span>
            </div>
          </div>

          {/* Payment Details */}
          <button
            className="settings-row"
            onClick={() => toggleSection('payment')}
          >
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple"><Icon as={ICONS.payment} /></div>
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
                <span className="payment-label">GCash QR</span>
                <span className={`payment-qr-status ${profile?.gcash_qr_url ? 'set' : ''}`}>
                  {profile?.gcash_qr_url ? '✓ Uploaded' : 'Not set'}
                </span>
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
                <span className="payment-label">PayMaya QR</span>
                <span className={`payment-qr-status ${profile?.paymaya_qr_url ? 'set' : ''}`}>
                  {profile?.paymaya_qr_url ? '✓ Uploaded' : 'Not set'}
                </span>
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
                <InlineIcon as={ICONS.edit} /> Edit Payment Details
              </button>
            </div>
          )}
        </div>

        {/* Households — one card per household, each with its own role badge and Leave */}
        {currentUser && (
          <HouseholdsSection currentUser={currentUser} showToast={showToast} onChanged={fetchData} />
        )}

        {/* Notifications */}
        <div className="settings-section">
          <p className="settings-section-title">
            <Bell size={16}/> Notifications <PushStatusBadge pushStatus={pushStatus} />
          </p>

          {/* Show a warning if browser blocked push */}
          {pushStatus === 'denied' && (
            <div style={{
              background: '#ffe5e5', borderRadius: 10, padding: '8px 12px',
              fontSize: 11, color: '#e53e3e', marginBottom: 8, lineHeight: 1.5
            }}>
              <InlineIcon as={ICONS.warning} /> Push notifications are blocked in your browser. Go to your browser settings → Site Settings → Notifications → Allow for this site.
            </div>
          )}
          {pushStatus === 'not-enabled' && (
            <button type="button" className="push-enable-btn" onClick={handleEnablePush} disabled={pushBusy}>
              <Bell size={15} aria-hidden="true" /> {pushBusy ? 'Turning on…' : 'Turn on phone notifications'}
            </button>
          )}
          {pushStatus === 'unavailable' && (
            <div style={{
              background: '#fffaf0', borderRadius: 10, padding: '8px 12px',
              fontSize: 11, color: '#c05621', marginBottom: 8, lineHeight: 1.5
            }}>
              <InlineIcon as={ICONS.warning} /> Browser push could not be set up. In-app notifications still work; try again in a browser with an available push service.
            </div>
          )}

          {[
            { key: 'expense_approvals',     label: 'Expense Approvals',     icon: ICONS.refund },
            { key: 'payment_confirmations', label: 'Payment Confirmations', icon: ICONS.approved },
            { key: 'utility_reminders',     label: 'Due Date Reminders',    icon: ICONS.reminder },
            { key: 'report_schedules',      label: 'Report Schedules',      icon: ICONS.report },
            { key: 'group_invites',         label: 'Group Invites',         icon: ICONS.members },
          ].map(item => (
            <div key={item.key} className="settings-row">
              <div className="settings-row-left">
                <div className="settings-icon-wrap purple"><Icon as={item.icon} /></div>
                <span>{item.label}</span>
              </div>
              <Toggle
                value={notifPrefs[item.key]}
                onToggle={() => handleToggleNotif(item.key)}
              />
            </div>
          ))}

          <div className="settings-row no-border reminder-label-row">
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple"><Icon as={ICONS.reminder} /></div>
              <span>Remind me before due date</span>
            </div>
          </div>
          <div className="reminder-options-wrap">
            {REMINDER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`reminder-chip ${reminderDays.includes(opt.value) ? 'active' : ''}`}
                onClick={() => handleToggleReminderDay(opt.value)}
              >
                {opt.label}
              </button>
            ))}
            {customReminderDays.map(day => (
              <button
                key={`custom-${day}`}
                className="reminder-chip active"
                title="Tap to remove"
                onClick={() => handleToggleReminderDay(day)}
              >
                {day}d before <X size={11} style={{ marginLeft: 4, verticalAlign: '-1px' }} />
              </button>
            ))}
            <button
              className={`reminder-chip reminder-chip-add${showCustomReminder ? ' open' : ''}`}
              onClick={() => setShowCustomReminder(v => !v)}
            >
              <Plus size={11} style={{ marginRight: 3, verticalAlign: '-1px' }} />Custom
            </button>
          </div>
          {showCustomReminder && (
            <div className="reminder-custom-row">
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max={MAX_REMINDER_DAYS}
                className="reminder-custom-input"
                placeholder="e.g. 10"
                value={customDayInput}
                onChange={e => setCustomDayInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddCustomReminder(); }}
              />
              <span className="reminder-custom-unit">days before</span>
              <button className="reminder-custom-add" onClick={handleAddCustomReminder}>Add</button>
            </div>
          )}
          {showCustomReminder && (
            <p className="reminder-hint">Any number from 0 to {MAX_REMINDER_DAYS} days. You can have up to {MAX_REMINDERS} reminders.</p>
          )}
          <p className="reminder-hint">{reminderSummary()}</p>
        </div>

        {/* App Preferences */}
        <div className="settings-section">
          <p className="settings-section-title">
            <Palette size={16}/> App Preferences
          </p>

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple">
                <Icon as={isDark ? ICONS.moon : ICONS.sun} />
              </div>
              <span>Dark Mode</span>
            </div>
            <Toggle value={isDark} onToggle={handleToggleDark}/>
          </div>

          <div className="settings-row no-border">
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple"><Icon as={ICONS.coins} /></div>
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
              <div className="settings-icon-wrap purple"><Icon as={ICONS.key} /></div>
              <span>Change Password</span>
            </div>
            <ChevronRight size={16}/>
          </button>

          <button className="settings-row no-border" onClick={() => toggleSection('sessions')}>
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple"><Icon as={ICONS.device} /></div>
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
                <span className="session-icon" aria-hidden="true">
                  {thisDevice?.kind === 'phone' ? <Smartphone size={18} /> : thisDevice?.kind === 'tablet' ? <Tablet size={18} /> : <Monitor size={18} />}
                </span>
                <span className="session-info">
                  <span className="session-device">{thisDevice?.name || 'This device'}</span>
                  {thisDevice?.detail && <span className="session-detail">{thisDevice.detail}</span>}
                  {thisDevice?.guess && <span className="session-guess">Likely {thisDevice.guess} (by screen size)</span>}
                </span>
                <span className="session-active">This device · Active now</span>
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
              <div className="settings-icon-wrap red"><Icon as={ICONS.warning} /></div>
              <span>Delete My Account</span>
            </div>
            <ChevronRight size={16}/>
          </button>
        </div>

        {/* Support & Feedback */}
        <div className="settings-section">
          <p className="settings-section-title">
            <LifeBuoy size={16}/> Support & Feedback
          </p>

          <button className="settings-row" onClick={() => openFeedbackModal('bug')}>
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple"><Bug size={16}/></div>
              <span>Report a Bug</span>
            </div>
            <ChevronRight size={16}/>
          </button>

          <button className="settings-row no-border" onClick={() => openFeedbackModal('feedback')}>
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple"><MessageSquare size={16}/></div>
              <span>Send Feedback</span>
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
              <div className="settings-icon-wrap purple"><Icon as={ICONS.device} /></div>
              <span>Version</span>
            </div>
            <span className="settings-value">v1.0.0</span>
          </div>

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple"><Icon as={ICONS.heart} /></div>
              <span>Made with love</span>
            </div>
            <span className="settings-value">HomeSync Team</span>
          </div>

          <button className="settings-row no-border" onClick={() => setShowTermsModal(true)}>
            <div className="settings-row-left">
              <div className="settings-icon-wrap purple"><Icon as={ICONS.report} /></div>
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

        </LoadGate>
      </div>

      {/* Payment Details Modal */}
      {showPaymentModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal">
            <div className="modal-top-row">
              <h2><InlineIcon as={ICONS.payment} /> Payment Details</h2>
              <button aria-label="Close" className="modal-x-btn" onClick={() => setShowPaymentModal(false)}>
                <X size={18}/>
              </button>
            </div>

            {paymentSuccess ? (
              <div style={{ textAlign: 'center', padding: '16px 0', fontSize: 14, color: '#38a169', fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>
                <InlineIcon as={ICONS.approved} /> Payment details updated!
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

                {/* GCash QR upload */}
                <div className="qr-upload-group">
                  <label className="qr-upload-label"><QrCode size={13} /> GCash QR Code</label>
                  <input
                    ref={gcashQrInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => handleQrFileSelect('gcash', e.target.files?.[0])}
                  />
                  {paymentForm.gcash_qr_url ? (
                    <div className="qr-preview-card">
                      <img src={paymentForm.gcash_qr_url} alt="GCash QR" className="qr-preview-img" />
                      <div className="qr-preview-actions">
                        <button type="button" className="qr-replace-btn" onClick={() => gcashQrInputRef.current?.click()} disabled={qrUploading.gcash}>
                          {qrUploading.gcash ? 'Uploading…' : 'Replace'}
                        </button>
                        <button aria-label="Remove" type="button" className="qr-remove-btn" onClick={() => handleRemoveQr('gcash')}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="qr-upload-btn" onClick={() => gcashQrInputRef.current?.click()} disabled={qrUploading.gcash}>
                      <ImagePlus size={15} /> {qrUploading.gcash ? 'Uploading…' : 'Upload GCash QR'}
                    </button>
                  )}
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

                {/* PayMaya QR upload */}
                <div className="qr-upload-group">
                  <label className="qr-upload-label"><QrCode size={13} /> PayMaya QR Code</label>
                  <input
                    ref={paymayaQrInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => handleQrFileSelect('paymaya', e.target.files?.[0])}
                  />
                  {paymentForm.paymaya_qr_url ? (
                    <div className="qr-preview-card">
                      <img src={paymentForm.paymaya_qr_url} alt="PayMaya QR" className="qr-preview-img" />
                      <div className="qr-preview-actions">
                        <button type="button" className="qr-replace-btn" onClick={() => paymayaQrInputRef.current?.click()} disabled={qrUploading.paymaya}>
                          {qrUploading.paymaya ? 'Uploading…' : 'Replace'}
                        </button>
                        <button aria-label="Remove" type="button" className="qr-remove-btn" onClick={() => handleRemoveQr('paymaya')}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="qr-upload-btn" onClick={() => paymayaQrInputRef.current?.click()} disabled={qrUploading.paymaya}>
                      <ImagePlus size={15} /> {qrUploading.paymaya ? 'Uploading…' : 'Upload PayMaya QR'}
                    </button>
                  )}
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
            <p className="modal-emoji"><Icon as={ICONS.sad} size={40} /></p>
            <h2>DON'T GO YET!</h2>
            <p className="modal-msg">
              Your expenses might get lonely without you!<br/>
              Are you sure you want to sign out?
            </p>
            <p className="modal-sub">We'd love for you to stick around!</p>
            <button className="modal-primary-btn" onClick={() => setShowSignOutModal(false)}>STAY</button>
            <button className="modal-ghost-btn" onClick={handleSignOut}>Log out</button>
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

      {/* Report a Bug / Send Feedback Modal */}
      {showFeedbackModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal wide">
            <div className="modal-top-row">
              <h2>{feedbackType === 'bug' ? <><InlineIcon as={ICONS.bug} size={18} /> Report a Bug</> : <><InlineIcon as={ICONS.chat} size={18} /> Send Feedback</>}</h2>
              <button aria-label="Close" className="modal-x-btn" onClick={() => setShowFeedbackModal(false)}><X size={18}/></button>
            </div>

            <div className="feedback-type-toggle">
              <button
                className={`feedback-type-btn ${feedbackType === 'bug' ? 'active' : ''}`}
                onClick={() => setFeedbackType('bug')}
              >
                <Bug size={14}/> Bug
              </button>
              <button
                className={`feedback-type-btn ${feedbackType === 'feedback' ? 'active' : ''}`}
                onClick={() => setFeedbackType('feedback')}
              >
                <MessageSquare size={14}/> Feedback
              </button>
            </div>

            <input
              type="text"
              className="settings-modal-input"
              placeholder="Subject (optional)"
              value={feedbackSubject}
              onChange={e => setFeedbackSubject(e.target.value)}
            />

            <textarea
              className="settings-modal-input feedback-textarea"
              placeholder={
                feedbackType === 'bug'
                  ? "What happened? What did you expect instead? Steps to reproduce help a lot."
                  : "Tell us what you think, or what you'd like to see in HomeSync…"
              }
              value={feedbackMessage}
              onChange={e => setFeedbackMessage(e.target.value)}
              rows={5}
            />

            {feedbackError && (
              <p className="modal-sub" style={{ color: '#e53e3e' }}>{feedbackError}</p>
            )}

            <p className="modal-sub">We'll open your email app addressed to {SUPPORT_EMAIL} — just hit send.</p>

            <button className="modal-primary-btn" onClick={handleSubmitFeedback} disabled={feedbackLoading}>
              {feedbackLoading ? 'Preparing…' : 'Send Report'}
            </button>
            <button className="modal-ghost-btn" onClick={() => setShowFeedbackModal(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Terms of Service Modal */}
      {showTermsModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal wide" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
            <div className="modal-top-row">
              <h2><InlineIcon as={ICONS.report} size={18} /> Terms of Service</h2>
              <button aria-label="Close" className="modal-x-btn" onClick={() => setShowTermsModal(false)}><X size={18}/></button>
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