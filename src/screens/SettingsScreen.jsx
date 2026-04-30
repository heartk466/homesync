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
import './SettingsScreen.css';

export default function SettingsScreen() {
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [household, setHousehold] = useState(null);
  const [householdMembers, setHouseholdMembers] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isDark, setIsDark] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState({
    expense_approvals: true,
    payment_confirmations: true,
    utility_reminders: true,
    report_schedules: true,
    group_invites: true,
  });
  const [reminderDays, setReminderDays] = useState(5);
  const [currency, setCurrency] = useState('PHP');

  // UI State
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [showDeleteHouseholdModal, setShowDeleteHouseholdModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showEditHouseholdModal, setShowEditHouseholdModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [newHouseholdName, setNewHouseholdName] = useState('');
  const [expandedSection, setExpandedSection] = useState(null);

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
        setIsDark(true);
        document.documentElement.setAttribute('data-theme', 'dark');
      }

      // Load preferences
      if (profileData?.notification_preferences) {
        setNotifPrefs(profileData.notification_preferences);
      }
      if (profileData?.default_reminder_days) {
        setReminderDays(profileData.default_reminder_days);
      }
      if (profileData?.currency) {
        setCurrency(profileData.currency);
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
    setIsDark(!isDark);
    document.documentElement.setAttribute('data-theme', newTheme);
    await supabase
      .from('profiles')
      .update({ theme: newTheme })
      .eq('id', currentUser.id);
    showToast(`${newTheme === 'dark' ? '🌙 Dark' : '☀️ Light'} mode enabled`);
  };

  const handleToggleNotif = async (key) => {
    const newPrefs = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(newPrefs);
    await supabase
      .from('profiles')
      .update({ notification_preferences: newPrefs })
      .eq('id', currentUser.id);
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
    setCurrency(curr);
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
    setLoading(true);
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
                <span className="payment-label">GCash</span>
                <span className="payment-value">
                  {profile?.gcash_number || 'Not set'}
                </span>
              </div>
              <div className="payment-detail-row">
                <span className="payment-label">Bank</span>
                <span className="payment-value">
                  {profile?.bank_name || 'Not set'}
                </span>
              </div>
              <div className="payment-detail-row">
                <span className="payment-label">Account #</span>
                <span className="payment-value">
                  {profile?.bank_account_number || 'Not set'}
                </span>
              </div>
              <div className="payment-detail-row">
                <span className="payment-label">Account Name</span>
                <span className="payment-value">
                  {profile?.bank_account_name || 'Not set'}
                </span>
              </div>
              <p className="settings-hint">
                Edit payment details from your profile card (tap avatar)
              </p>
            </div>
          )}
        </div>

        {/* Household Settings */}
        <div className="settings-section">
          <p className="settings-section-title">
            <Home size={16}/> Household
          </p>

          {/* View household name & code — both admin and member */}
          <div className="settings-household-info">
            <p className="household-name-display">{household?.name}</p>
            <div className="household-code-row">
              <span className="household-code-label">Code:</span>
              <span className="household-code-value">{household?.code}</span>
              <button className="code-action-btn" onClick={handleCopyCode}>
                {copied ? <Check size={14}/> : <Copy size={14}/>}
              </button>
              <button className="code-action-btn" onClick={handleShareCode}>
                <Share2 size={14}/>
              </button>
            </div>
          </div>

          {/* Admin only */}
          {isAdmin ? (
            <>
              <button
                className="settings-row"
                onClick={() => setShowEditHouseholdModal(true)}
              >
                <div className="settings-row-left">
                  <div className="settings-icon-wrap purple">✏️</div>
                  <span>Edit Household Name</span>
                </div>
                <ChevronRight size={16}/>
              </button>

              <button
                className="settings-row"
                onClick={() => setShowMembersModal(true)}
              >
                <div className="settings-row-left">
                  <div className="settings-icon-wrap purple">👥</div>
                  <span>Manage Members</span>
                </div>
                <ChevronRight size={16}/>
              </button>

              <button
                className="settings-row"
                onClick={() => setShowTransferModal(true)}
              >
                <div className="settings-row-left">
                  <div className="settings-icon-wrap yellow">👑</div>
                  <span>Transfer Ownership</span>
                </div>
                <ChevronRight size={16}/>
              </button>

              <button
                className="settings-row danger"
                onClick={() => setShowDeleteHouseholdModal(true)}
              >
                <div className="settings-row-left">
                  <div className="settings-icon-wrap red">🗑️</div>
                  <span>Delete Household</span>
                </div>
                <ChevronRight size={16}/>
              </button>
            </>
          ) : (
            <button
              className="settings-row danger"
              onClick={() => setShowLeaveModal(true)}
            >
              <div className="settings-row-left">
                <div className="settings-icon-wrap red">🚪</div>
                <span>Leave Household</span>
              </div>
              <ChevronRight size={16}/>
            </button>
          )}
        </div>

        {/* Notifications */}
        <div className="settings-section">
          <p className="settings-section-title">
            <Bell size={16}/> Notifications
          </p>

          {[
            { key: 'expense_approvals', label: 'Expense Approvals' },
            { key: 'payment_confirmations', label: 'Payment Confirmations' },
            { key: 'utility_reminders', label: 'Utility Reminders' },
            { key: 'report_schedules', label: 'Report Schedules' },
            { key: 'group_invites', label: 'Group Invites' },
          ].map(item => (
            <div key={item.key} className="settings-row">
              <div className="settings-row-left">
                <div className="settings-icon-wrap purple">🔔</div>
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

          <button className="settings-row no-border">
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
            <p className="modal-sub">
              We'd love for you to stick around!
            </p>
            <button className="modal-primary-btn" onClick={() => setShowSignOutModal(false)}>
              STAY
            </button>
            <button className="modal-ghost-btn" onClick={handleSignOut}>
              Log out 😢
            </button>
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
              This action cannot be undone.
            </p>
            <button
              className="modal-danger-btn"
              onClick={handleDeleteAccount}
              disabled={loading}
            >
              {loading ? 'Deleting...' : 'Yes, Delete My Account'}
            </button>
            <button
              className="modal-ghost-btn"
              onClick={() => setShowDeleteAccountModal(false)}
            >
              Cancel
            </button>
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
              This will permanently delete "{household?.name}" and all its expenses.
              This cannot be undone.
            </p>
            <button
              className="modal-danger-btn"
              onClick={handleDeleteHousehold}
              disabled={loading}
            >
              {loading ? 'Deleting...' : 'Yes, Delete Household'}
            </button>
            <button
              className="modal-ghost-btn"
              onClick={() => setShowDeleteHouseholdModal(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Leave Household Modal */}
      {showLeaveModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal">
            <AlertCircle size={40} color="#e53e3e"/>
            <h2>Leave Household?</h2>
            <p className="modal-msg">
              You will no longer have access to "{household?.name}".
            </p>
            <button
              className="modal-danger-btn"
              onClick={handleLeaveHousehold}
              disabled={loading}
            >
              {loading ? 'Leaving...' : 'Yes, Leave'}
            </button>
            <button
              className="modal-ghost-btn"
              onClick={() => setShowLeaveModal(false)}
            >
              Cancel
            </button>
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
            <button
              className="modal-primary-btn"
              onClick={handleEditHousehold}
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
            <button
              className="modal-ghost-btn"
              onClick={() => setShowEditHouseholdModal(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Manage Members Modal */}
      {showMembersModal && (
        <div className="settings-modal-overlay">
          <div className="settings-modal wide">
            <div className="modal-top-row">
              <h2>Manage Members</h2>
              <button
                className="modal-x-btn"
                onClick={() => setShowMembersModal(false)}
              >
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
                    <p className="member-manage-role">
                      {m.role === 'owner' ? '👑 Owner' : '👤 Member'}
                    </p>
                  </div>
                  {m.user_id !== currentUser?.id && (
                    <button
                      className="kick-member-btn"
                      onClick={() => handleKickMember(m)}
                    >
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
            <p className="modal-msg">
              Select a member to become the new owner
            </p>
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
            <button
              className="modal-ghost-btn"
              onClick={() => setShowTransferModal(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <BottomNav active="settings"/>
    </div>
  );
}