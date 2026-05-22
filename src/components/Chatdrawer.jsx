import React, {
  useState, useEffect, useRef, useCallback,
} from 'react';
import { supabase } from '../supabaseClient';
import {
  X, Send, Search, Image, Paperclip, ChevronLeft, MessageCircle,
} from 'lucide-react';
import './ChatDrawer.css';

/* ─── helpers ────────────────────────────────────────────────────────────── */
const fmt = (iso) => {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)  return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const initials = (name = '') =>
  name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || '?';

/* ─── Avatar chip ────────────────────────────────────────────────────────── */
function Avatar({ profile, size = 36 }) {
  const style = {
    width: size, height: size, borderRadius: '50%',
    background: '#3B2AAB', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: size * 0.38, fontWeight: 700,
    fontFamily: 'Poppins, sans-serif',
    flexShrink: 0, overflow: 'hidden',
  };
  return (
    <div style={style}>
      {profile?.avatar_url
        ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : initials(profile?.full_name)}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ChatDrawer — main export
   ═══════════════════════════════════════════════════════════════════════════ */
export default function ChatDrawer({
  isOpen,
  onClose,
  currentUser,
  profile,
  allHouseholds = [],   // from DashboardScreen
}) {
  /* ── Tab / search ────────────────────────────────────────────────────────── */
  const [tab, setTab]         = useState('household'); // 'household' | 'group'
  const [search, setSearch]   = useState('');

  /* ── Conversation list ───────────────────────────────────────────────────── */
  const [rooms, setRooms]     = useState([]); // { id, name, type, emoji, lastMsg, unread }
  const [loadingRooms, setLoadingRooms] = useState(false);

  /* ── Active conversation ─────────────────────────────────────────────────── */
  const [activeRoom, setActiveRoom] = useState(null); // full room object
  const [messages, setMessages]     = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  /* ── Send ────────────────────────────────────────────────────────────────── */
  const [text, setText]       = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);

  /* ── Profiles cache ──────────────────────────────────────────────────────── */
  const profilesCache = useRef({});

  const fileInputRef  = useRef(null);
  const msgEndRef     = useRef(null);
  const realtimeRef   = useRef(null);

  /* ── Scroll to bottom ───────────────────────────────────────────────────── */
  const scrollBottom = () =>
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  useEffect(() => { if (messages.length) scrollBottom(); }, [messages]);

  /* ── Fetch profile by id (with cache) ───────────────────────────────────── */
  const getProfile = useCallback(async (uid) => {
    if (profilesCache.current[uid]) return profilesCache.current[uid];
    const { data } = await supabase
      .from('profiles').select('id, full_name, avatar_url').eq('id', uid).single();
    if (data) profilesCache.current[uid] = data;
    return data;
  }, []);

  /* ── Ensure room exists (upsert) ─────────────────────────────────────────── */
  const ensureRoom = useCallback(async (type, refId) => {
    // Try to find existing
    const { data: existing } = await supabase
      .from('chat_rooms').select('id')
      .eq('type', type).eq('ref_id', refId).maybeSingle();
    if (existing) return existing.id;

    const { data: created } = await supabase
      .from('chat_rooms').insert({ type, ref_id: refId }).select('id').single();
    return created?.id;
  }, []);

  /* ── Load rooms for current tab ─────────────────────────────────────────── */
  const loadRooms = useCallback(async () => {
    if (!currentUser?.id) return;
    setLoadingRooms(true);

    try {
      if (tab === 'household') {
        // Build household rooms
        const list = await Promise.all(allHouseholds.map(async (hh) => {
          const roomId = await ensureRoom('household', hh.id);
          // Last message
          const { data: msgs } = await supabase
            .from('chat_messages').select('content, file_type, created_at')
            .eq('room_id', roomId).order('created_at', { ascending: false }).limit(1);
          // Unread count
          const { data: readRow } = await supabase
            .from('chat_reads').select('last_read')
            .eq('user_id', currentUser.id).eq('room_id', roomId).maybeSingle();
          let unread = 0;
          if (readRow) {
            const { count } = await supabase
              .from('chat_messages').select('id', { count: 'exact', head: true })
              .eq('room_id', roomId).gt('created_at', readRow.last_read)
              .neq('sender_id', currentUser.id);
            unread = count || 0;
          }
          return {
            id: roomId, name: hh.name, emoji: '🏠', type: 'household',
            lastMsg: msgs?.[0] || null, unread,
          };
        }));
        setRooms(list);
      } else {
        // Groups: find groups user belongs to
        const { data: memberRows } = await supabase
          .from('group_members').select('group_id').eq('user_id', currentUser.id);
        const groupIds = (memberRows || []).map(r => r.group_id);
        if (!groupIds.length) { setRooms([]); setLoadingRooms(false); return; }

        const { data: groups } = await supabase
          .from('groups').select('id, name').in('id', groupIds);

        const list = await Promise.all((groups || []).map(async (g) => {
          const roomId = await ensureRoom('group', g.id);
          const { data: msgs } = await supabase
            .from('chat_messages').select('content, file_type, created_at')
            .eq('room_id', roomId).order('created_at', { ascending: false }).limit(1);
          const { data: readRow } = await supabase
            .from('chat_reads').select('last_read')
            .eq('user_id', currentUser.id).eq('room_id', roomId).maybeSingle();
          let unread = 0;
          if (readRow) {
            const { count } = await supabase
              .from('chat_messages').select('id', { count: 'exact', head: true })
              .eq('room_id', roomId).gt('created_at', readRow.last_read)
              .neq('sender_id', currentUser.id);
            unread = count || 0;
          }
          return {
            id: roomId, name: g.name, emoji: '👥', type: 'group',
            lastMsg: msgs?.[0] || null, unread,
          };
        }));
        setRooms(list);
      }
    } catch (e) { console.error(e); }
    setLoadingRooms(false);
  }, [tab, allHouseholds, currentUser?.id, ensureRoom]);

  useEffect(() => { if (isOpen) loadRooms(); }, [isOpen, tab, loadRooms]);

  /* ── Open conversation ──────────────────────────────────────────────────── */
  const openRoom = async (room) => {
    setActiveRoom(room);
    setMessages([]);
    setLoadingMsgs(true);

    // Load last 100 messages
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('room_id', room.id)
      .order('created_at', { ascending: true })
      .limit(100);

    // Hydrate sender profiles
    const msgs = await Promise.all((data || []).map(async (m) => ({
      ...m,
      senderProfile: await getProfile(m.sender_id),
    })));
    setMessages(msgs);
    setLoadingMsgs(false);

    // Mark read
    await supabase.from('chat_reads').upsert(
      { user_id: currentUser.id, room_id: room.id, last_read: new Date().toISOString() },
      { onConflict: 'user_id,room_id' }
    );

    // Realtime subscription
    if (realtimeRef.current) supabase.removeChannel(realtimeRef.current);
    realtimeRef.current = supabase
      .channel(`chat-room-${room.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
        filter: `room_id=eq.${room.id}`,
      }, async (payload) => {
        const newMsg = {
          ...payload.new,
          senderProfile: await getProfile(payload.new.sender_id),
        };
        setMessages(prev => [...prev, newMsg]);
        // Mark read immediately if drawer is open
        await supabase.from('chat_reads').upsert(
          { user_id: currentUser.id, room_id: room.id, last_read: new Date().toISOString() },
          { onConflict: 'user_id,room_id' }
        );
      })
      .subscribe();
  };

  const closeRoom = () => {
    setActiveRoom(null);
    setMessages([]);
    if (realtimeRef.current) { supabase.removeChannel(realtimeRef.current); realtimeRef.current = null; }
    loadRooms(); // refresh unread counts
  };

  /* ── Send text message ──────────────────────────────────────────────────── */
  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || !activeRoom) return;
    setSending(true);
    setText('');
    await supabase.from('chat_messages').insert({
      room_id: activeRoom.id,
      sender_id: currentUser.id,
      content: trimmed,
    });
    setSending(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  /* ── File / image upload ────────────────────────────────────────────────── */
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file || !activeRoom) return;
    e.target.value = '';

    const MAX = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX) { alert('File must be under 10 MB.'); return; }

    setUploading(true);
    const ext  = file.name.split('.').pop();
    const path = `${activeRoom.id}/${currentUser.id}-${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from('chat-files').upload(path, file, { upsert: false });

    if (upErr) { alert('Upload failed. Try again.'); setUploading(false); return; }

    const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(path);
    const isImage = file.type.startsWith('image/');

    await supabase.from('chat_messages').insert({
      room_id:   activeRoom.id,
      sender_id: currentUser.id,
      content:   null,
      file_url:  urlData.publicUrl,
      file_type: isImage ? 'image' : 'file',
      file_name: file.name,
    });
    setUploading(false);
  };

  /* ── Filtered room list ─────────────────────────────────────────────────── */
  const filteredRooms = rooms.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase())
  );

  /* ── Total unread across all rooms (for notification badge) ─────────────── */
  const totalUnread = rooms.reduce((s, r) => s + r.unread, 0);

  /* ─────────────────────────────────────────────────────────────────────────
     RENDER
     ───────────────────────────────────────────────────────────────────────── */
  if (!isOpen) return null;

  return (
    <div className="chat-backdrop" onClick={onClose}>
      <div className="chat-drawer" onClick={e => e.stopPropagation()}>

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="chat-header">
          {activeRoom ? (
            <>
              <button className="chat-back-btn" onClick={closeRoom}>
                <ChevronLeft size={20} />
              </button>
              <span className="chat-header-emoji">{activeRoom.emoji}</span>
              <span className="chat-header-title">{activeRoom.name}</span>
            </>
          ) : (
            <span className="chat-header-title">💬 Messages</span>
          )}
          <button className="chat-close-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {/* ══ Conversation List View ════════════════════════════════════════ */}
        {!activeRoom && (
          <>
            {/* Tabs */}
            <div className="chat-tabs">
              <button
                className={`chat-tab ${tab === 'household' ? 'active' : ''}`}
                onClick={() => { setTab('household'); setSearch(''); }}
              >
                🏠 Household
              </button>
              <button
                className={`chat-tab ${tab === 'group' ? 'active' : ''}`}
                onClick={() => { setTab('group'); setSearch(''); }}
              >
                👥 Groups
              </button>
            </div>

            {/* Search */}
            <div className="chat-search-wrap">
              <Search size={14} className="chat-search-icon" />
              <input
                className="chat-search-input"
                placeholder={`Search ${tab === 'household' ? 'households' : 'groups'}…`}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {/* Room list */}
            <div className="chat-room-list">
              {loadingRooms && <p className="chat-empty">Loading…</p>}
              {!loadingRooms && filteredRooms.length === 0 && (
                <p className="chat-empty">
                  {search ? 'No results.' : tab === 'household' ? 'No households found.' : 'No groups found.'}
                </p>
              )}
              {filteredRooms.map(room => (
                <button key={room.id} className="chat-room-row" onClick={() => openRoom(room)}>
                  <div className="chat-room-avatar">{room.emoji}</div>
                  <div className="chat-room-info">
                    <span className="chat-room-name">{room.name}</span>
                    <span className="chat-room-last">
                      {room.lastMsg
                        ? room.lastMsg.file_type === 'image'
                          ? '📷 Photo'
                          : room.lastMsg.file_type === 'file'
                          ? '📎 File'
                          : room.lastMsg.content
                        : 'No messages yet'}
                    </span>
                  </div>
                  <div className="chat-room-meta">
                    {room.lastMsg && (
                      <span className="chat-room-time">{fmt(room.lastMsg.created_at)}</span>
                    )}
                    {room.unread > 0 && (
                      <span className="chat-unread-badge">{room.unread}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ══ Message View ═════════════════════════════════════════════════ */}
        {activeRoom && (
          <>
            <div className="chat-messages-area">
              {loadingMsgs && <p className="chat-empty">Loading messages…</p>}
              {!loadingMsgs && messages.length === 0 && (
                <p className="chat-empty">No messages yet. Say hello! 👋</p>
              )}
              {messages.map((msg, i) => {
                const isMine = msg.sender_id === currentUser.id;
                const showAvatar = !isMine && (i === 0 || messages[i - 1].sender_id !== msg.sender_id);
                return (
                  <div key={msg.id} className={`chat-msg-row ${isMine ? 'mine' : 'theirs'}`}>
                    {/* Avatar for other users */}
                    {!isMine && (
                      <div className="chat-msg-avatar-slot">
                        {showAvatar && <Avatar profile={msg.senderProfile} size={28} />}
                      </div>
                    )}
                    <div className="chat-msg-col">
                      {!isMine && showAvatar && (
                        <span className="chat-msg-sender">{msg.senderProfile?.full_name || 'Member'}</span>
                      )}
                      <div className={`chat-bubble ${isMine ? 'bubble-mine' : 'bubble-theirs'}`}>
                        {msg.file_type === 'image' && msg.file_url && (
                          <a href={msg.file_url} target="_blank" rel="noreferrer">
                            <img
                              src={msg.file_url}
                              alt="shared"
                              className="chat-img-preview"
                            />
                          </a>
                        )}
                        {msg.file_type === 'file' && msg.file_url && (
                          <a href={msg.file_url} target="_blank" rel="noreferrer" className="chat-file-link">
                            📎 {msg.file_name || 'Download file'}
                          </a>
                        )}
                        {msg.content && <span className="chat-bubble-text">{msg.content}</span>}
                        <span className="chat-bubble-time">{fmt(msg.created_at)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={msgEndRef} />
            </div>

            {/* Input bar */}
            <div className="chat-input-bar">
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
                onChange={handleFileChange}
              />
              <button
                className="chat-attach-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Attach file or image"
              >
                {uploading ? '⏳' : <Paperclip size={18} />}
              </button>
              <button
                className="chat-attach-btn"
                onClick={() => { if (fileInputRef.current) { fileInputRef.current.accept = 'image/*'; fileInputRef.current.click(); } }}
                disabled={uploading}
                title="Share image"
              >
                <Image size={18} />
              </button>
              <textarea
                className="chat-text-input"
                placeholder="Type a message…"
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
              />
              <button
                className={`chat-send-btn ${text.trim() ? 'active' : ''}`}
                onClick={handleSend}
                disabled={!text.trim() || sending}
              >
                <Send size={16} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── ChatTriggerButton ──────────────────────────────────────────────────────
 * Place this beside the avatar in TopBar's actions div.
 * Usage:
 *   <ChatTriggerButton unreadCount={totalChatUnread} onClick={() => setShowChat(true)} />
 * ─────────────────────────────────────────────────────────────────────────── */
export function ChatTriggerButton({ unreadCount = 0, onClick }) {
  return (
    <button className="topbar-chat-btn" onClick={onClick} title="Messages">
      <MessageCircle size={22} />
      {unreadCount > 0 && (
        <span className="topbar-chat-badge">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}