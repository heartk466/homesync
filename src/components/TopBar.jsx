import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { Bell, X, LogOut, Camera, Edit, MessageCircle } from 'lucide-react';
import './TopBar.css';
import logo from '../assets/Homesync.svg';
import useChatLauncher from './useChatLauncher';

export default function TopBar({
  profile,
  setProfile,
  household,
  currentUser,
  notifications = [],
  unreadCount = 0,
  onMarkAllRead,
  title = 'HomeSync',
  showBell = true,
  onChatOpen,            // legacy: a screen can still supply its own chat handling
  chatUnreadCount = 0,
  hideChat = false,      // set true on a screen that should NOT show the chat button
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef(null);

  const [showProfileCard, setShowProfileCard] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [editForm, setEditForm] = useState({ full_name: '', gcash_number: '', bank_name: '', bank_account_number: '', bank_account_name: '' });
  const [editLoading, setEditLoading] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);

  // Chat button + drawer on every screen (works with just `profile`, so screens
  // that don't pass `currentUser` get it too)
  const chatUser = currentUser || (profile?.id ? { id: profile.id } : null);
  const internalChat = !hideChat && !onChatOpen;
  const chat = useChatLauncher({ chatUser, profile, enabled: internalChat });
  const chatBadge = onChatOpen ? chatUnreadCount : chat.unread;
  const showChatButton = !hideChat && (!!onChatOpen || !!chatUser);

  // Ring the bell once whenever a new notification arrives
  const prevUnread = useRef(unreadCount);
  const [ringing, setRinging] = useState(false);
  useEffect(() => {
    if (unreadCount > prevUnread.current) {
      setRinging(true);
      const t = setTimeout(() => setRinging(false), 1400);
      prevUnread.current = unreadCount;
      return () => clearTimeout(t);
    }
    prevUnread.current = unreadCount;
    return undefined;
  }, [unreadCount]);

  const getInitials = () => {
    if (!profile?.full_name) return 'U';
    return profile.full_name
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  const handlePhotoClick = () => {
    fileInputRef.current.click();
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert('Please select a JPG, PNG or WebP image.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be less than 2MB.');
      return;
    }

    setUploadingPhoto(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${currentUser.id}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });

      if (uploadError) {
        alert('Failed to upload photo. Try again.');
        setUploadingPhoto(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      await supabase
        .from('profiles')
        .update({ avatar_url: urlData.publicUrl })
        .eq('id', currentUser.id);

      setProfile(prev => ({ ...prev, avatar_url: urlData.publicUrl }));

    } catch {
      alert('Something went wrong. Try again.');
    }

    setUploadingPhoto(false);
  };

  const handleEditProfile = () => {
    setEditForm({ 
      full_name: profile?.full_name || '',
      gcash_number: profile?.gcash_number || '',
      bank_name: profile?.bank_name || '',
      bank_account_number: profile?.bank_account_number || '',
      bank_account_name: profile?.bank_account_name || ''
    });
    setEditSuccess(false);
    setShowProfileCard(false);
    setShowEditModal(true);
  };

  const handleSaveProfile = async () => {
    if (!editForm.full_name.trim()) {
      alert('Full name cannot be empty.');
      return;
    }

    setEditLoading(true);

    const { error } = await supabase
      .from('profiles')
      .update({ 
        full_name: editForm.full_name.trim(),
        gcash_number: editForm.gcash_number,
        bank_name: editForm.bank_name,
        bank_account_number: editForm.bank_account_number,
        bank_account_name: editForm.bank_account_name
      })
      .eq('id', currentUser.id);

    if (error) {
      alert('Failed to update profile. Try again.');
    } else {
      setProfile(prev => ({ ...prev, 
        full_name: editForm.full_name.trim(),
        gcash_number: editForm.gcash_number,
        bank_name: editForm.bank_name,
        bank_account_number: editForm.bank_account_number,
        bank_account_name: editForm.bank_account_name
      }));
      setEditSuccess(true);
      setTimeout(() => {
        setShowEditModal(false);
        setEditSuccess(false);
      }, 1500);
    }

    setEditLoading(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  /**
   * Handle notification tap — works like Facebook notifications.
   *
   * Flow:  current screen  →  /groups (GroupsScreen)  →  /group-detail/:id (GroupDetailScreen)
   *
   * Why this was broken: notifications are saved with link_path "/groups/<id>?type=...",
   * but GroupDetailScreen actually lives at "/group-detail/<id>" (see GroupsScreen).
   * "/groups/<id>" matches no route, so React Router rendered nothing → blank gray page.
   * We now rewrite the path here, so it also fixes OLD notifications already in the DB.
   */
  const handleNotificationClick = async (notification) => {
    // Mark this notification as read
    if (!notification.is_read) {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notification.id);
      if (onMarkAllRead) onMarkAllRead();
    }

    // Close notification panel
    setShowNotifications(false);

    if (!notification.link_path) return;

    // 1) Split link_path into "path" + its own query string, then merge link_query
    //    (expenseId / openProof / proofId) in as proper separate params.
    const [rawPath, rawQuery = ''] = notification.link_path.split('?');
    const params = new URLSearchParams(rawQuery);
    if (notification.link_query) {
      new URLSearchParams(notification.link_query).forEach((value, key) => params.set(key, value));
    }

    // 2) Restore router state (e.g. { type: 'household' | 'group' })
    let state = {};
    try {
      if (notification.link_state) state = JSON.parse(notification.link_state);
    } catch (_) {}

    // 3) Pull the group/household id out of the path. Accepts both the old
    //    "/groups/<id>" and the correct "/group-detail/<id>" formats.
    const match = rawPath.match(/^\/(?:groups|group-detail)\/([^/]+)/);

    // Not a group link (future notification types) → navigate as-is
    if (!match) {
      const qs = params.toString();
      setTimeout(() => navigate(qs ? `${rawPath}?${qs}` : rawPath, { state }), 100);
      return;
    }

    const groupId = match[1];
    const type = params.get('type') || state.type || 'group';
    params.set('type', type);
    state = { ...state, type };

    const detailUrl = `/group-detail/${groupId}?${params.toString()}`;
    const onGroupsScreen = location.pathname === '/groups';
    const onSameDetail = location.pathname === `/group-detail/${groupId}`;

    // 4) Step one: land on GroupsScreen so the back button returns there
    if (!onGroupsScreen && !onSameDetail) {
      navigate('/groups');
    }

    // 5) Step two: open the exact GroupDetailScreen (it handles the highlight / proof modal)
    setTimeout(() => {
      navigate(detailUrl, { state, replace: onSameDetail });
    }, onGroupsScreen || onSameDetail ? 100 : 150);
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'payment_proof':      return '📸';
      case 'payment_confirmed':  return '✅';
      case 'payment_rejected':   return '❌';
      case 'approval_request':   return '⏳';
      case 'approval':           return '✅';
      case 'rejection':          return '❌';
      case 'kicked':             return '🚪';
      case 'expense_updated':    return '✏️';
      case 'expense_added':      return '➕';
      case 'expense_removed':    return '➖';
      case 'expense_deleted':    return '🗑️';
      case 'followup_submitted': return '📸';
      case 'followup_confirmed': return '✅';
      case 'followup_rejected':  return '❌';
      case 'refund_sent':        return '💸';
      case 'refund_confirmed':   return '✅';
      case 'report_generated':   return '📄';
      case 'report_schedule':    return '🗓️';
      default:                   return '🔔';
    }
  };

  return (
    <>
      {/* Hidden file input for avatar upload */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept="image/jpeg,image/png,image/webp"
        onChange={handlePhotoChange}
      />

      {/* Top Bar */}
      <div className="topbar">
        <div className="topbar-title">
          <img src={logo} alt="homesync" className="topbar-logo-icon" />
          <span>{title}</span>
        </div>

        <div className="topbar-actions">
          {/* Chat — sits beside the bell on every screen */}
          {showChatButton && (
            <button
              className="topbar-chat-btn"
              aria-label="Messages"
              title="Messages"
              onClick={() => {
                setShowProfileCard(false);
                setShowNotifications(false);
                if (onChatOpen) onChatOpen();
                else chat.toggle();
              }}
            >
              <MessageCircle size={20} className="chat-icon" />
              {chatBadge > 0 && (
                <span className="topbar-chat-badge">{chatBadge > 99 ? '99+' : chatBadge}</span>
              )}
            </button>
          )}

          {/* Bell / Notifications */}
          {showBell && (
            <button
              className={`topbar-bell-btn ${ringing ? 'ringing' : ''} ${unreadCount > 0 ? 'has-unread' : ''}`}
              aria-label="Notifications"
              title="Notifications"
              onClick={() => {
                setShowNotifications(!showNotifications);
                setShowProfileCard(false);
              }}
            >
              <Bell size={20} className="bell-icon" />
              {unreadCount > 0 && (
                <span className="topbar-bell-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </button>
          )}

          {/* Avatar / Profile */}
          <button
            className="topbar-avatar-btn"
            onClick={() => setShowProfileCard(!showProfileCard)}
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="avatar" className="topbar-avatar-img"/>
            ) : (
              getInitials()
            )}
          </button>
        </div>
      </div>

      {/* Chat drawer (covers the whole screen) */}
      {chat.drawer}

      {/* Notifications Panel */}
      {showNotifications && (
        <div className="topbar-overlay" onClick={() => setShowNotifications(false)}>
          <div className="topbar-notifications-panel" onClick={e => e.stopPropagation()}>
            <div className="notifications-header">
              <span>Notifications</span>
              <button className="mark-read-btn" onClick={() => { if (onMarkAllRead) onMarkAllRead(); }}>
                Mark all read
              </button>
            </div>
            {notifications.length === 0 ? (
              <p className="no-notifications">No notifications yet</p>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={`notification-item ${!n.is_read ? 'unread' : ''} ${n.link_path ? 'notification-clickable' : ''}`}
                  onClick={() => handleNotificationClick(n)}
                  role={n.link_path ? 'button' : undefined}
                  style={n.link_path ? { cursor: 'pointer' } : {}}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.3 }}>
                      {getNotificationIcon(n.type)}
                    </span>
                    <div style={{ flex: 1 }}>
                      <p className="notification-title">{n.title}</p>
                      <p className="notification-msg">{n.message}</p>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <p className="notification-time">
                          {new Date(n.created_at).toLocaleString()}
                        </p>
                        {n.link_path && (
                          <span style={{ fontSize: 10, color: '#3B2AAB', fontWeight: 600, fontFamily: 'Poppins, sans-serif' }}>
                            Tap to view →
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Floating Profile Card */}
      {showProfileCard && (
        <div className="topbar-overlay" onClick={() => setShowProfileCard(false)}>
          <div className="topbar-profile-card" onClick={e => e.stopPropagation()}>
            <button
              className="topbar-profile-close"
              onClick={() => setShowProfileCard(false)}
            >
              <X size={16}/>
            </button>
            <div className="topbar-profile-avatar">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="avatar" className="topbar-avatar-img-large"/>
              ) : (
                getInitials()
              )}
            </div>
            <button
              className="topbar-change-photo"
              onClick={handlePhotoClick}
              disabled={uploadingPhoto}
            >
              <Camera size={14}/>
              {uploadingPhoto ? 'Uploading...' : 'Change Photo'}
            </button>
            <p className="topbar-profile-name">{profile?.full_name}</p>
            <p className="topbar-profile-email">{profile?.email}</p>
            <div className="topbar-household-badge">
              🏠 {household?.name || 'No Household'} · {household?.created_by === profile?.id ? 'Owner' : 'Member'}
            </div>
            <button className="topbar-edit-btn" onClick={handleEditProfile}>
              <Edit size={14}/> Edit Profile
            </button>
            <button
              className="topbar-signout-btn"
              onClick={() => { setShowProfileCard(false); setShowSignOutModal(true); }}
            >
              <LogOut size={14}/> Sign Out
            </button>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {showEditModal && (
        <div className="topbar-modal-overlay">
          <div className="topbar-edit-modal">
            <button
              className="topbar-modal-close"
              onClick={() => setShowEditModal(false)}
            >
              <X size={18}/>
            </button>
            <div className="topbar-edit-avatar">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="avatar" className="topbar-avatar-img-large"/>
              ) : (
                getInitials()
              )}
            </div>
            <h2 className="topbar-edit-title">Edit Profile</h2>

            {editSuccess ? (
              <div className="topbar-edit-success">
                ✅ Profile updated successfully!
              </div>
            ) : (
              <>
                <div className="topbar-input-group">
                  <label>Full Name</label>
                  <input
                    type="text"
                    value={editForm.full_name}
                    onChange={e => setEditForm({ ...editForm, full_name: e.target.value })}
                    placeholder="Enter your full name"
                  />
                </div>
                <div className="topbar-input-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={profile?.email || ''}
                    disabled
                    className="disabled"
                  />
                  <span className="topbar-hint">Email cannot be changed</span>
                </div>
                <div className="topbar-input-group">
                  <label>GCash Number</label>
                  <input
                    type="text"
                    value={editForm.gcash_number}
                    onChange={e => setEditForm({ ...editForm, gcash_number: e.target.value })}
                    placeholder="e.g. 09XX XXX XXXX"
                  />
                </div>
                <div className="topbar-input-group">
                  <label>Bank Name</label>
                  <input
                    type="text"
                    value={editForm.bank_name}
                    onChange={e => setEditForm({ ...editForm, bank_name: e.target.value })}
                    placeholder="e.g. BDO, BPI, Metrobank"
                  />
                </div>
                <div className="topbar-input-group">
                  <label>Bank Account Number</label>
                  <input
                    type="text"
                    value={editForm.bank_account_number}
                    onChange={e => setEditForm({ ...editForm, bank_account_number: e.target.value })}
                    placeholder="Account number"
                  />
                </div>
                <div className="topbar-input-group">
                  <label>Account Name</label>
                  <input
                    type="text"
                    value={editForm.bank_account_name}
                    onChange={e => setEditForm({ ...editForm, bank_account_name: e.target.value })}
                    placeholder="Account name"
                  />
                </div>
                <button
                  className="topbar-save-btn"
                  onClick={handleSaveProfile}
                  disabled={editLoading}
                >
                  {editLoading ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  className="topbar-cancel-btn"
                  onClick={() => setShowEditModal(false)}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sign Out Modal */}
      {showSignOutModal && (
        <div className="topbar-modal-overlay">
          <div className="topbar-signout-modal">
            <p className="topbar-modal-emoji">🥺</p>
            <h2>DON'T GO YET!</h2>
            <p className="topbar-modal-msg">
              Your expenses might get lonely without you!<br/>
              Are you sure you want to sign out?
            </p>
            <p className="topbar-modal-sub">
              We'd love for you to stick around, but we'll be here whenever you're ready to come back.
            </p>
            <button
              className="topbar-stay-btn"
              onClick={() => setShowSignOutModal(false)}
            >
              STAY
            </button>
            <button className="topbar-logout-btn" onClick={handleSignOut}>
              Log out 😢
            </button>
          </div>
        </div>
      )}
    </>
  );
}