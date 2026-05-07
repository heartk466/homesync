import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { Bell, X, LogOut, Camera, Edit } from 'lucide-react';
import './TopBar.css';
import logo from '../assets/Homesync.svg';

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
}) {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [showProfileCard, setShowProfileCard] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [editForm, setEditForm] = useState({ full_name: '', gcash_number: '', bank_name: '', bank_account_number: '', bank_account_name: '' });
  const [editLoading, setEditLoading] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);

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
   * Navigates to the linked screen and opens the proof modal.
   */
  const handleNotificationClick = async (notification) => {
    console.log("🔔 Notification clicked:", notification);
    
    // Mark this notification as read
    if (!notification.is_read) {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notification.id);
      if (onMarkAllRead) onMarkAllRead(); // refresh parent counts
    }

    // Close notification panel
    setShowNotifications(false);

    if (!notification.link_path) {
      console.log("No link_path in notification");
      return;
    }

    // Build destination URL with optional query string
    const query = notification.link_query ? `?${notification.link_query}` : '';
    const destination = `${notification.link_path}${query}`;

    // Parse link_state back to object for react-router state
    let state = {};
    try {
      if (notification.link_state) state = JSON.parse(notification.link_state);
    } catch (_) {}

    console.log("📍 Navigating to:", destination, state);
    
    // Small delay to ensure panel closes before navigation
    setTimeout(() => {
      navigate(destination, { state });
    }, 100);
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
      default:                   return '🔔';
    }
  };

  return (
    <>
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept="image/jpeg,image/png,image/webp"
        onChange={handlePhotoChange}
      />

      {/* Top Bar */}
      <div className="topbar">
  <img src={logo} alt="homesync" className="topbar-logo-icon" />
  <span>{title}</span>
</div>
        
        <div className="topbar-actions">
          {showBell && (
            <button
              className="topbar-bell-btn"
              onClick={() => {
                setShowNotifications(!showNotifications);
                setShowProfileCard(false);
              }}
            >
              <Bell size={20}/>
              {unreadCount > 0 && (
                <span className="topbar-bell-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </button>
          )}
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