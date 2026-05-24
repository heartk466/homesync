import React, {
  useState, useEffect, useRef, useCallback,
} from 'react';
import { supabase } from '../supabaseClient';
import {
  X, Send, Search, Image, Paperclip, ChevronLeft, MessageCircle, AtSign,
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

/* ─── Render message text with @mention highlighting ─────────────────────── */
function MentionText({ text }) {
  // Split by @mention tokens
  const parts = text.split(/(@\w[\w\s]*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('@') ? (
          <span key={i} className="chat-mention">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

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
   Props:
     isOpen          bool
     onClose         fn
     currentUser     { id }
     profile         profile object
     allHouseholds   array
     onUnreadChange  fn(totalUnread) — called whenever unread count changes
   ═══════════════════════════════════════════════════════════════════════════ */
export default function ChatDrawer({
  isOpen,
  onClose,
  currentUser,
  profile,
  allHouseholds = [],
  onUnreadChange,
}) {
  /* ── Tab / search ──────────────────────────────────────────────────────── */
  const [tab, setTab]       = useState('household');
  const [search, setSearch] = useState('');

  /* ── Conversation list ─────────────────────────────────────────────────── */
  const [rooms, setRooms]           = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

  /* ── Active conversation ───────────────────────────────────────────────── */
  const [activeRoom, setActiveRoom] = useState(null);
  const [messages, setMessages]     = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  /* ── Send ──────────────────────────────────────────────────────────────── */
  const [text, setText]       = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);

  /* ── Mention state ─────────────────────────────────────────────────────── */
  const [mentionQuery, setMentionQuery]   = useState('');   // text after @
  const [mentionOpen, setMentionOpen]     = useState(false);
  const [roomMembers, setRoomMembers]     = useState([]);   // { id, full_name, avatar_url }

  /* ── Profiles cache ────────────────────────────────────────────────────── */
  const profilesCache = useRef({});
  const fileInputRef  = useRef(null);
  const msgEndRef     = useRef(null);
  const realtimeRef   = useRef(null);
  const textareaRef   = useRef(null);

  /* ── Scroll to bottom ──────────────────────────────────────────────────── */
  const scrollBottom = () =>
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  useEffect(() => { if (messages.length) scrollBottom(); }, [messages]);

  /* ── Notify parent of total unread ────────────────────────────────────── */
  useEffect(() => {
    if (onUnreadChange) {
      const total = rooms.reduce((s, r) => s + (r.unread || 0), 0);
      onUnreadChange(total);
    }
  }, [rooms, onUnreadChange]);

  /* ── Fetch profile by id (with cache) ─────────────────────────────────── */
  const getProfile = useCallback(async (uid) => {
    if (profilesCache.current[uid]) return profilesCache.current[uid];
    const { data } = await supabase
      .from('profiles').select('id, full_name, avatar_url').eq('id', uid).single();
    if (data) profilesCache.current[uid] = data;
    return data;
  }, []);

  /* ── Ensure room exists (upsert) ───────────────────────────────────────── */
  const ensureRoom = useCallback(async (type, refId) => {
    const { data: existing } = await supabase
      .from('chat_rooms').select('id')
      .eq('type', type).eq('ref_id', refId).maybeSingle();
    if (existing) return existing.id;
    const { data: created } = await supabase
      .from('chat_rooms').insert({ type, ref_id: refId }).select('id').single();
    return created?.id;
  }, []);

  /* ── Load rooms and sort by most recent message ────────────────────────── */
  const loadRooms = useCallback(async () => {
    if (!currentUser?.id) return;
    setLoadingRooms(true);
    try {
      let list = [];

      if (tab === 'household') {
        list = await Promise.all(allHouseholds.map(async (hh) => {
          const roomId = await ensureRoom('household', hh.id);
          const { data: msgs } = await supabase
            .from('chat_messages').select('content, file_type, created_at, sender_id')
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
          } else {
            // No read record — count all messages from others as unread
            const { count } = await supabase
              .from('chat_messages').select('id', { count: 'exact', head: true })
              .eq('room_id', roomId).neq('sender_id', currentUser.id);
            unread = count || 0;
          }
          return {
            id: roomId, name: hh.name, emoji: '🏠', type: 'household',
            lastMsg: msgs?.[0] || null, unread,
            lastAt: msgs?.[0]?.created_at || null,
          };
        }));
      } else {
        const { data: memberRows } = await supabase
          .from('group_members').select('group_id').eq('user_id', currentUser.id);
        const groupIds = (memberRows || []).map(r => r.group_id);
        if (!groupIds.length) { setRooms([]); setLoadingRooms(false); return; }

        const { data: groups } = await supabase
          .from('groups').select('id, name').in('id', groupIds);

        list = await Promise.all((groups || []).map(async (g) => {
          const roomId = await ensureRoom('group', g.id);
          const { data: msgs } = await supabase
            .from('chat_messages').select('content, file_type, created_at, sender_id')
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
          } else {
            const { count } = await supabase
              .from('chat_messages').select('id', { count: 'exact', head: true })
              .eq('room_id', roomId).neq('sender_id', currentUser.id);
            unread = count || 0;
          }
          return {
            id: roomId, name: g.name, emoji: '👥', type: 'group',
            lastMsg: msgs?.[0] || null, unread,
            lastAt: msgs?.[0]?.created_at || null,
          };
        }));
      }

      // ── Sort: rooms with recent messages float to the top (Messenger style)
      list.sort((a, b) => {
        if (!a.lastAt && !b.lastAt) return 0;
        if (!a.lastAt) return 1;
        if (!b.lastAt) return -1;
        return new Date(b.lastAt) - new Date(a.lastAt);
      });

      setRooms(list);
    } catch (e) { console.error(e); }
    setLoadingRooms(false);
  }, [tab, allHouseholds, currentUser?.id, ensureRoom]);

  useEffect(() => { if (isOpen) loadRooms(); }, [isOpen, tab, loadRooms]);

  /* ── Load members of the active room (for @mention) ───────────────────── */
  const loadRoomMembers = useCallback(async (room) => {
    if (!room) return;
    try {
      let userIds = [];
      if (room.type === 'household') {
        // Find the household ref_id from the room
        const { data: roomRow } = await supabase
          .from('chat_rooms').select('ref_id').eq('id', room.id).single();
        if (roomRow) {
          const { data: members } = await supabase
            .from('household_members').select('user_id')
            .eq('household_id', roomRow.ref_id).eq('status', 'active');
          userIds = (members || []).map(m => m.user_id);
        }
      } else {
        const { data: roomRow } = await supabase
          .from('chat_rooms').select('ref_id').eq('id', room.id).single();
        if (roomRow) {
          const { data: members } = await supabase
            .from('group_members').select('user_id').eq('group_id', roomRow.ref_id);
          userIds = (members || []).map(m => m.user_id);
        }
      }
      // Fetch profiles, exclude self
      const others = userIds.filter(id => id !== currentUser.id);
      const profiles = await Promise.all(others.map(id => getProfile(id)));
      setRoomMembers(profiles.filter(Boolean));
    } catch (e) { console.error(e); }
  }, [currentUser?.id, getProfile]);

  /* ── Open conversation ─────────────────────────────────────────────────── */
  const openRoom = async (room) => {
    setActiveRoom(room);
    setMessages([]);
    setText('');
    setMentionOpen(false);
    setLoadingMsgs(true);

    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('room_id', room.id)
      .order('created_at', { ascending: true })
      .limit(100);

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

    // Load members for @mention
    await loadRoomMembers(room);

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
    setText('');
    setMentionOpen(false);
    setRoomMembers([]);
    if (realtimeRef.current) { supabase.removeChannel(realtimeRef.current); realtimeRef.current = null; }
    loadRooms();
  };

  /* ── @mention: detect "@" in textarea ─────────────────────────────────── */
  const handleTextChange = (e) => {
    const val = e.target.value;
    setText(val);

    // Find the last "@" before cursor
    const cursor = e.target.selectionStart;
    const before = val.slice(0, cursor);
    const atIdx  = before.lastIndexOf('@');

    if (atIdx !== -1 && (atIdx === 0 || /\s/.test(before[atIdx - 1]))) {
      const query = before.slice(atIdx + 1);
      // Only open if no space in the query (still typing the name)
      if (!query.includes(' ') || query.length < 20) {
        setMentionQuery(query);
        setMentionOpen(true);
        return;
      }
    }
    setMentionOpen(false);
    setMentionQuery('');
  };

  const insertMention = (member) => {
    const cursor = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const after  = text.slice(cursor);
    const atIdx  = before.lastIndexOf('@');
    const firstName = member.full_name.split(' ')[0];
    const newBefore = before.slice(0, atIdx) + `@${firstName} `;
    setText(newBefore + after);
    setMentionOpen(false);
    setMentionQuery('');
    setTimeout(() => {
      textareaRef.current?.focus();
      const pos = newBefore.length;
      textareaRef.current?.setSelectionRange(pos, pos);
    }, 0);
  };

  const filteredMentions = roomMembers.filter(m =>
    m.full_name.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  /* ── Send text message ─────────────────────────────────────────────────── */
  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || !activeRoom) return;
    setSending(true);
    setText('');
    setMentionOpen(false);
    await supabase.from('chat_messages').insert({
      room_id: activeRoom.id,
      sender_id: currentUser.id,
      content: trimmed,
    });
    setSending(false);
  };

  const handleKeyDown = (e) => {
    if (mentionOpen && (e.key === 'Escape')) {
      setMentionOpen(false);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mentionOpen) {
      e.preventDefault();
      handleSend();
    }
  };

  /* ── File / image upload ───────────────────────────────────────────────── */
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file || !activeRoom) return;
    e.target.value = '';
    const MAX = 10 * 1024 * 1024;
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

  /* ── Filtered room list ────────────────────────────────────────────────── */
  const filteredRooms = rooms.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase())
  );

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

            {/* Room list — sorted most recent first */}
            <div className="chat-room-list">
              {loadingRooms && <p className="chat-empty">Loading…</p>}
              {!loadingRooms && filteredRooms.length === 0 && (
                <p className="chat-empty">
                  {search ? 'No results.' : tab === 'household' ? 'No households found.' : 'No groups found.'}
                </p>
              )}
              {filteredRooms.map(room => (
                <button
                  key={room.id}
                  className={`chat-room-row ${room.unread > 0 ? 'has-unread' : ''}`}
                  onClick={() => openRoom(room)}
                >
                  <div className="chat-room-avatar">{room.emoji}</div>
                  <div className="chat-room-info">
                    <span className={`chat-room-name ${room.unread > 0 ? 'unread-name' : ''}`}>
                      {room.name}
                    </span>
                    <span className={`chat-room-last ${room.unread > 0 ? 'unread-last' : ''}`}>
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
                      <span className={`chat-room-time ${room.unread > 0 ? 'unread-time' : ''}`}>
                        {fmt(room.lastMsg.created_at)}
                      </span>
                    )}
                    {room.unread > 0 && (
                      <span className="chat-unread-badge">{room.unread > 99 ? '99+' : room.unread}</span>
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
                            <img src={msg.file_url} alt="shared" className="chat-img-preview" />
                          </a>
                        )}
                        {msg.file_type === 'file' && msg.file_url && (
                          <a href={msg.file_url} target="_blank" rel="noreferrer" className="chat-file-link">
                            📎 {msg.file_name || 'Download file'}
                          </a>
                        )}
                        {msg.content && (
                          <span className="chat-bubble-text">
                            <MentionText text={msg.content} />
                          </span>
                        )}
                        <span className="chat-bubble-time">{fmt(msg.created_at)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={msgEndRef} />
            </div>

            {/* @mention popup */}
            {mentionOpen && filteredMentions.length > 0 && (
              <div className="chat-mention-popup">
                <p className="chat-mention-label">Mention a member</p>
                {filteredMentions.map(m => (
                  <button
                    key={m.id}
                    className="chat-mention-item"
                    onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
                  >
                    <Avatar profile={m} size={28} />
                    <span className="chat-mention-name">{m.full_name}</span>
                  </button>
                ))}
              </div>
            )}

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
                title="Attach file"
              >
                {uploading ? '⏳' : <Paperclip size={18} />}
              </button>
              <button
                className="chat-attach-btn"
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.accept = 'image/*';
                    fileInputRef.current.click();
                  }
                }}
                disabled={uploading}
                title="Share image"
              >
                <Image size={18} />
              </button>
              <div className="chat-input-wrap">
                <textarea
                  ref={textareaRef}
                  className="chat-text-input"
                  placeholder="Type a message… use @ to mention"
                  value={text}
                  onChange={handleTextChange}
                  onKeyDown={handleKeyDown}
                  rows={1}
                />
              </div>
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

/* ─── ChatTriggerButton ──────────────────────────────────────────────────── */
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