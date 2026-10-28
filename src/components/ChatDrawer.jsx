import React, {
  useState, useEffect, useRef, useCallback,
} from 'react';
import { supabase } from '../supabaseClient';
import {
  X, Send, Search, Image, Paperclip, ChevronLeft, MessageCircle, AtSign, Plus, Forward, Check,
} from 'lucide-react';
import ChatImageEditor from './ChatImageEditor';
import { compressImage } from '../utils/imageCompress';
import './ChatDrawer.css';
import { Icon, InlineIcon, CategoryIcon, StatusIcon } from './Icon';
import { ICONS, CATEGORY_ICON, SUBSCRIPTION_ICON, NOTIF_ICON } from '../utils/iconMap';

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

// Messenger-style centred dividers: a new one when the day changes or after a
// 30-minute pause. Today → just the time; yesterday → "Yesterday 7:58 AM";
// this week → "Wednesday 7:58 AM"; older → "Oct 12, 7:58 AM".
const DIVIDER_GAP_MS = 30 * 60 * 1000;
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const timeOf = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dividerLabel = (iso) => {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return timeOf(d);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `Yesterday ${timeOf(d)}`;
  if (now - d < 6 * 86400000) return `${d.toLocaleDateString([], { weekday: 'long' })} ${timeOf(d)}`;
  const date = d.toLocaleDateString([], {
    month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  return `${date}, ${timeOf(d)}`;
};
const needsDivider = (msgs, i) =>
  i === 0
  || !sameDay(new Date(msgs[i - 1].created_at), new Date(msgs[i].created_at))
  || new Date(msgs[i].created_at) - new Date(msgs[i - 1].created_at) > DIVIDER_GAP_MS;
// Shown when a bubble is tapped
const fullStamp = (iso) => new Date(iso).toLocaleString([], {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

// Local id for a message that is still sending, and a unique storage path
const tempMessageId = () => `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const uploadPath = (roomId, userId, ext) =>
  `${roomId}/${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

// Photos sent in one go share a batch_id → shown as one grid. Each shown item
// is the batch's first message with `batch` = every message in it.
function groupBatches(messages) {
  const out = [];
  messages.forEach((m) => {
    const prev = out[out.length - 1];
    if (m.batch_id && prev && prev.batch_id === m.batch_id && prev.sender_id === m.sender_id) {
      prev.batch.push(m);
    } else {
      out.push({ ...m, batch: [m] });
    }
  });
  return out;
}
const batchStatus = (batch) => (batch.some(m => m.status === 'failed') ? 'failed'
  : batch.some(m => m.status === 'sending') ? 'sending' : 'sent');
// Older databases without the batch_id / forwarded columns still save the message
const missingNewColumn = (error) => /batch_id|forwarded/.test(error?.message || '');
const withoutNewColumns = (row) => {
  const copy = { ...row };
  delete copy.batch_id;
  delete copy.forwarded;
  return copy;
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
     allHouseholds   array
     onUnreadChange  fn(totalUnread) — called whenever unread count changes
   ═══════════════════════════════════════════════════════════════════════════ */
export default function ChatDrawer({
  isOpen,
  onClose,
  currentUser,
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
  const [stampMsgId, setStampMsgId] = useState(null); // bubble whose date/time is shown
  // Photos picked but not sent yet (thumbnails in the message box, Messenger-style):
  //   { id, file, url, originalFile, originalUrl, edit }  — file/url = what gets sent
  const [pendingImages, setPendingImages] = useState([]);
  const [editingImageId, setEditingImageId] = useState(null);
  const imageInputRef = useRef(null);
  const trayRef = useRef(null);
  // Forward: the message (or photo group) being forwarded + where it went
  const [forwarding, setForwarding] = useState(null);       // batch: [messages]
  const [forwardTargets, setForwardTargets] = useState([]); // { key, type, refId, name, emoji }
  const [forwardSearch, setForwardSearch] = useState('');
  const [forwardState, setForwardState] = useState({});     // key → 'sending' | 'sent' | 'failed'

  // new photos added → scroll the row to the end so the newest one and + show
  useEffect(() => {
    const el = trayRef.current;
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
  }, [pendingImages.length]);

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

  // Callbacks depend on the id only (not the whole user object)
  const userId = currentUser?.id;

  /* ── Scroll to bottom ──────────────────────────────────────────────────── */
  const scrollBottom = () =>
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  useEffect(() => { if (messages.length) scrollBottom(); }, [messages]);

  // The message box grows with the text (up to ~5 lines), like Messenger
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // empty → the one-line default from the CSS (same height as the send button)
    if (!text) { el.style.height = ''; el.style.overflowY = 'hidden'; return; }
    el.style.height = 'auto';
    const max = 112;
    const borders = el.offsetHeight - el.clientHeight;
    const needed = el.scrollHeight + borders;
    el.style.height = `${Math.min(Math.max(needed, 38), max)}px`;
    el.style.overflowY = needed > max ? 'auto' : 'hidden';
  }, [text, activeRoom]);

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
    if (!userId) return;
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
            .eq('user_id', userId).eq('room_id', roomId).maybeSingle();
          let unread = 0;
          if (readRow) {
            const { count } = await supabase
              .from('chat_messages').select('id', { count: 'exact', head: true })
              .eq('room_id', roomId).gt('created_at', readRow.last_read)
              .neq('sender_id', userId);
            unread = count || 0;
          } else {
            // No read record — count all messages from others as unread
            const { count } = await supabase
              .from('chat_messages').select('id', { count: 'exact', head: true })
              .eq('room_id', roomId).neq('sender_id', userId);
            unread = count || 0;
          }
          return {
            id: roomId, name: hh.name, icon: ICONS.household, type: 'household',
            lastMsg: msgs?.[0] || null, unread,
            lastAt: msgs?.[0]?.created_at || null,
          };
        }));
      } else {
        const { data: memberRows } = await supabase
          .from('group_members').select('group_id').eq('user_id', userId);
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
            .eq('user_id', userId).eq('room_id', roomId).maybeSingle();
          let unread = 0;
          if (readRow) {
            const { count } = await supabase
              .from('chat_messages').select('id', { count: 'exact', head: true })
              .eq('room_id', roomId).gt('created_at', readRow.last_read)
              .neq('sender_id', userId);
            unread = count || 0;
          } else {
            const { count } = await supabase
              .from('chat_messages').select('id', { count: 'exact', head: true })
              .eq('room_id', roomId).neq('sender_id', userId);
            unread = count || 0;
          }
          return {
            id: roomId, name: g.name, icon: ICONS.group, type: 'group',
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
  }, [tab, allHouseholds, userId, ensureRoom]);

  // Started from a timer so the loader's setState calls don't run inside the effect body.
  useEffect(() => {
    if (!isOpen) return undefined;
    const timer = setTimeout(loadRooms, 0);
    return () => clearTimeout(timer);
  }, [isOpen, tab, loadRooms]);

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
      const others = userIds.filter(id => id !== userId);
      const profiles = await Promise.all(others.map(id => getProfile(id)));
      setRoomMembers(profiles.filter(Boolean));
    } catch (e) { console.error(e); }
  }, [userId, getProfile]);

  /* ── Open conversation ─────────────────────────────────────────────────── */
  const openRoom = async (room) => {
    setActiveRoom(room);
    setMessages([]);
    setStampMsgId(null);
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
        setMessages(prev => {
          if (prev.some(m => m.id === newMsg.id)) return prev;
          // my own message that's still "Sending" — deliver() swaps it in
          const pendingTwin = newMsg.sender_id === currentUser.id && prev.some(m => (
            m.status === 'sending'
            && (m.content || null) === (newMsg.content || null)
            && (m.file_name || null) === (newMsg.file_name || null)
          ));
          return pendingTwin ? prev : [...prev, newMsg];
        });
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

  /* ── Sending (optimistic, like Messenger) ─────────────────────────────────
     The bubble shows right away as "Sending…"; once the row is saved it's
     swapped for the real message ("Sent"). A failure shows "Not sent · Tap to
     retry". Files upload first (temp._file), then the row is inserted. */
  const deliver = async (temp) => {
    setMessages(prev => prev.map(m => (m.id === temp.id ? { ...m, status: 'sending' } : m)));
    const markFailed = (err, step) => {
      console.error(`chat message ${step} failed:`, err);
      const reason = err?.message || String(err || 'Unknown error');
      setMessages(prev => prev.map(m => (m.id === temp.id ? { ...m, status: 'failed', failReason: `${step}: ${reason}` } : m)));
    };
    let row = { room_id: temp.room_id, sender_id: temp.sender_id, content: temp.content ?? null };
    if (temp.batch_id) row.batch_id = temp.batch_id;
    if (temp._file) {
      const file = temp._file;
      const ext = file.name.split('.').pop();
      const path = `${uploadPath(temp.room_id, temp.sender_id, ext)}`;
      const { error: upErr } = await supabase.storage.from('chat-files').upload(path, file, { upsert: false });
      if (upErr) { markFailed(upErr, 'Upload'); return; }
      const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(path);
      row = { ...row, file_url: urlData.publicUrl, file_type: temp.file_type, file_name: file.name };
    }
    let { data, error } = await supabase.from('chat_messages').insert(row).select('*').single();
    if (error && missingNewColumn(error)) {
      ({ data, error } = await supabase.from('chat_messages').insert(withoutNewColumns(row)).select('*').single());
      if (data) data = { ...data, batch_id: temp.batch_id };   // still shown grouped here
    }
    if (error || !data) { markFailed(error, 'Save'); return; }
    setMessages(prev => (
      prev.some(m => m.id === data.id)
        ? prev.filter(m => m.id !== temp.id)   // realtime already added it
        : prev.map(m => (m.id === temp.id ? { ...data, senderProfile: m.senderProfile, status: 'sent' } : m))
    ));
    if (temp._previewUrl) URL.revokeObjectURL(temp._previewUrl);
  };

  const queueMessage = (fields) => {
    const temp = {
      id: tempMessageId(),
      room_id: activeRoom.id,
      sender_id: currentUser.id,
      created_at: new Date().toISOString(),
      status: 'sending',
      content: null,
      ...fields,
    };
    setMessages(prev => [...prev, temp]);
    deliver(temp);
  };

  /* ── Send text message ─────────────────────────────────────────────────── */
  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || !activeRoom) return;
    setText('');
    setMentionOpen(false);
    queueMessage({ content: trimmed });
  };

  /* ── Picked photos: tray → Edit / Send ─────────────────────────────────── */
  const addPendingImages = async (files) => {
    const picked = await Promise.all(files.map(async (f, i) => {
      const file = await compressImage(f);
      const url = URL.createObjectURL(file);
      return { id: `${f.name}-${f.size}-${f.lastModified}-${i}`, file, url, originalFile: file, originalUrl: url, edit: null };
    }));
    setPendingImages(prev => [...prev, ...picked.filter(p => !prev.some(q => q.id === p.id))]);
  };

  const handleImagesPicked = (e) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    e.target.value = '';
    if (files.length) addPendingImages(files);
  };

  const removePendingImage = (id) => setPendingImages(prev => {
    const item = prev.find(p => p.id === id);
    if (item) {
      URL.revokeObjectURL(item.url);
      if (item.originalUrl !== item.url) URL.revokeObjectURL(item.originalUrl);
    }
    return prev.filter(p => p.id !== id);
  });

  // Editor "Done" / "Send": the edited JPEG replaces what will be sent
  const applyImageEdit = (id, { edit, file, url }) => {
    const next = pendingImages.map(p => {
      if (p.id !== id) return p;
      if (p.url !== p.originalUrl) URL.revokeObjectURL(p.url);
      return { ...p, edit, file, url };
    });
    setPendingImages(next);
    return next;
  };

  // Sends every picked photo, then the caption (if any)
  const sendPendingImages = (list = pendingImages) => {
    const batchId = list.length > 1 ? tempMessageId() : null; // sent together → one photo group
    list.forEach(p => {
      if (p.originalUrl !== p.url) URL.revokeObjectURL(p.originalUrl);
      queueMessage({ _file: p.file, _previewUrl: p.url, file_url: p.url, file_type: 'image', file_name: p.file.name, batch_id: batchId });
    });
    setPendingImages([]);
    setEditingImageId(null);
    if (text.trim()) handleSend();
  };

  const sendAll = () => (pendingImages.length ? sendPendingImages() : handleSend());
  const editingImage = pendingImages.find(p => p.id === editingImageId) || null;
  const shown = groupBatches(messages);

  /* ── Forward to another household / group chat ──────────────────────────── */
  const openForward = async (batch) => {
    setForwarding(batch);
    setForwardSearch('');
    setForwardState({});
    const { data: memberRows } = await supabase.from('group_members').select('group_id').eq('user_id', currentUser.id);
    const groupIds = (memberRows || []).map(r => r.group_id);
    const { data: groups } = groupIds.length
      ? await supabase.from('groups').select('id, name').in('id', groupIds)
      : { data: [] };
    setForwardTargets([
      ...allHouseholds.map(h => ({ key: `household-${h.id}`, type: 'household', refId: h.id, name: h.name, icon: ICONS.household })),
      ...(groups || []).map(g => ({ key: `group-${g.id}`, type: 'group', refId: g.id, name: g.name, icon: ICONS.group })),
    ]);
  };

  const forwardTo = async (target) => {
    if (!forwarding || forwardState[target.key]) return;
    setForwardState(s => ({ ...s, [target.key]: 'sending' }));
    const roomId = await ensureRoom(target.type, target.refId);
    const batchId = forwarding.length > 1 ? tempMessageId() : null;
    const rows = forwarding.map(m => ({
      room_id: roomId,
      sender_id: currentUser.id,
      content: m.content ?? null,
      file_url: m.file_url ?? null,
      file_type: m.file_type ?? null,
      file_name: m.file_name ?? null,
      forwarded: true,
      ...(batchId ? { batch_id: batchId } : {}),
    }));
    let { error } = await supabase.from('chat_messages').insert(rows);
    if (error && missingNewColumn(error)) ({ error } = await supabase.from('chat_messages').insert(rows.map(withoutNewColumns)));
    if (error) console.error('forward failed:', error);
    setForwardState(s => ({ ...s, [target.key]: error ? 'failed' : 'sent' }));
  };

  const handleKeyDown = (e) => {
    if (mentionOpen && (e.key === 'Escape')) {
      setMentionOpen(false);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mentionOpen) {
      e.preventDefault();
      sendAll();
    }
  };

  /* ── File / image upload ───────────────────────────────────────────────── */
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file || !activeRoom) return;
    e.target.value = '';
    const MAX = 10 * 1024 * 1024;
    if (file.size > MAX) { alert('File must be under 10 MB.'); return; }
    // a photo chosen with the paperclip goes to the tray too (Edit / Send)
    if (file.type.startsWith('image/')) { addPendingImages([file]); return; }
    queueMessage({ _file: file, file_url: null, file_type: 'file', file_name: file.name });
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
              <button aria-label="Back" className="chat-back-btn" onClick={closeRoom}>
                <ChevronLeft size={20} />
              </button>
              <span className="chat-header-emoji"><Icon as={activeRoom.icon} size={24} /></span>
              <span className="chat-header-title">{activeRoom.name}</span>
            </>
          ) : (
            <span className="chat-header-title"><InlineIcon as={ICONS.chat} size={18} /> Messages</span>
          )}
          <button aria-label="Close" className="chat-close-btn" onClick={onClose}><X size={18} /></button>
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
                <InlineIcon as={ICONS.household} /> Household
              </button>
              <button
                className={`chat-tab ${tab === 'group' ? 'active' : ''}`}
                onClick={() => { setTab('group'); setSearch(''); }}
              >
                <InlineIcon as={ICONS.group} /> Groups
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
                  <div className="chat-room-avatar"><Icon as={room.icon} /></div>
                  <div className="chat-room-info">
                    <span className={`chat-room-name ${room.unread > 0 ? 'unread-name' : ''}`}>
                      {room.name}
                    </span>
                    <span className={`chat-room-last ${room.unread > 0 ? 'unread-last' : ''}`}>
                      {room.lastMsg
                        ? room.lastMsg.file_type === 'image'
                          ? <><InlineIcon as={ICONS.photo} size={12} />Photo</>
                          : room.lastMsg.file_type === 'file'
                          ? <><InlineIcon as={ICONS.file} size={12} />File</>
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
                <p className="chat-empty">No messages yet. Say hello!</p>
              )}
              {shown.map((msg, i) => {
                const isMine = msg.sender_id === currentUser.id;
                const divider = needsDivider(shown, i);
                // Bubbles from one sender in a row are grouped (rounded corners, one avatar / name)
                const groupStart = divider || shown[i - 1].sender_id !== msg.sender_id;
                const groupEnd = i === shown.length - 1 || needsDivider(shown, i + 1) || shown[i + 1].sender_id !== msg.sender_id;
                const groupPos = groupStart && groupEnd ? 'single' : groupStart ? 'first' : groupEnd ? 'last' : 'mid';
                const isLastMine = isMine && !shown.slice(i + 1).some(m => m.sender_id === currentUser.id);
                const status = batchStatus(msg.batch);
                const statusLabel = status === 'sending' ? 'sending'
                  : status === 'failed' ? 'failed'
                  : isLastMine ? 'sent' : null;
                const retry = () => msg.batch.filter(m => m.status === 'failed').forEach(deliver);
                const photos = msg.batch.filter(m => m.file_type === 'image' && m.file_url);
                const mediaOnly = photos.length > 0 && !msg.content && photos.length === msg.batch.length;
                const canForward = status === 'sent' && !String(msg.id).startsWith('tmp-');
                const onBubbleClick = (e) => {
                  if (e.target.closest('a')) return; // opening an image / file
                  if (status === 'failed') { retry(); return; }
                  setStampMsgId(id => (id === msg.id ? null : msg.id));
                };
                return (
                  <React.Fragment key={msg.id}>
                    {divider && <div className="chat-divider">{dividerLabel(msg.created_at)}</div>}
                    {stampMsgId === msg.id && <div className="chat-divider chat-stamp">{fullStamp(msg.created_at)}</div>}
                  <div className={`chat-msg-row ${isMine ? 'mine' : 'theirs'} grp-${groupPos}`}>
                    {!isMine && (
                      <div className="chat-msg-avatar-slot">
                        {groupEnd && <Avatar profile={msg.senderProfile} size={28} />}
                      </div>
                    )}
                    <div className="chat-msg-col">
                      {!isMine && groupStart && (
                        <span className="chat-msg-sender">{msg.senderProfile?.full_name || 'Member'}</span>
                      )}
                      {msg.forwarded && <span className="chat-forwarded"><Forward size={11} /> Forwarded</span>}
                      <div className="chat-bubble-line">
                      <div
                        className={`chat-bubble ${isMine ? 'bubble-mine' : 'bubble-theirs'} bubble-${groupPos}${mediaOnly ? ' bubble-media' : ''}${status === 'sending' ? ' bubble-sending' : ''}${status === 'failed' ? ' bubble-failed' : ''}${stampMsgId === msg.id ? ' bubble-selected' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={onBubbleClick}
                        onKeyDown={(e) => { if (e.key === 'Enter') onBubbleClick(e); }}
                      >
                        {photos.length > 1 && (
                          <div className={`chat-media-grid chat-media-grid--${Math.min(photos.length, 4)}`}>
                            {photos.map(p => (
                              <a key={p.id} href={p.file_url} target="_blank" rel="noreferrer" className="chat-media-tile">
                                <img src={p.file_url} alt="shared" />
                              </a>
                            ))}
                          </div>
                        )}
                        {photos.length === 1 && (
                          <a href={photos[0].file_url} target="_blank" rel="noreferrer">
                            <img src={photos[0].file_url} alt="shared" className="chat-img-preview" />
                          </a>
                        )}
                        {msg.file_type === 'file' && msg.file_url && (
                          <a href={msg.file_url} target="_blank" rel="noreferrer" className="chat-file-link">
                            <InlineIcon as={ICONS.file} /> {msg.file_name || 'Download file'}
                          </a>
                        )}
                        {msg.content && (
                          <span className="chat-bubble-text">
                            <MentionText text={msg.content} />
                          </span>
                        )}
                      </div>
                      {canForward && (
                        <button
                          type="button"
                          className={`chat-forward-btn${mediaOnly || stampMsgId === msg.id ? ' visible' : ''}`}
                          onClick={() => openForward(msg.batch)}
                          aria-label="Forward"
                          title="Forward"
                        >
                          <Forward size={15} />
                        </button>
                      )}
                      </div>
                      {statusLabel === 'sending' && (
                        <span className="chat-msg-status" aria-live="polite">
                          Sending<span className="chat-dots" aria-hidden="true"><i /><i /><i /></span>
                        </span>
                      )}
                      {statusLabel === 'failed' && (
                        <button type="button" className="chat-msg-status chat-msg-failed" onClick={retry} title={msg.batch.find(m => m.failReason)?.failReason}>
                          Not sent · Tap to retry
                        </button>
                      )}
                      {statusLabel === 'failed' && msg.batch.find(m => m.failReason) && (
                        <span className="chat-msg-fail-reason">{msg.batch.find(m => m.failReason).failReason}</span>
                      )}
                      {statusLabel === 'sent' && <span className="chat-msg-status">Sent</span>}
                    </div>
                  </div>
                  </React.Fragment>
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
              <button aria-label="Attach file"
                className="chat-attach-btn"
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.accept = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt';
                    fileInputRef.current.click();
                  }
                }}
                title="Attach file"
              >
                <Paperclip size={18} />
              </button>
              <input
                type="file"
                ref={imageInputRef}
                style={{ display: 'none' }}
                accept="image/*"
                multiple
                onChange={handleImagesPicked}
              />
              <button aria-label="Share photos"
                className="chat-attach-btn"
                onClick={() => imageInputRef.current?.click()}
                title="Share photos"
              >
                <Image size={18} />
              </button>
              <div className={`chat-input-wrap${pendingImages.length ? ' has-tray' : ''}`}>
                {pendingImages.length > 0 && (
                  <div className="chat-tray" ref={trayRef} aria-label="Photos to send">
                    {pendingImages.map(p => (
                      <div key={p.id} className="chat-tray-item">
                        <button type="button" className="chat-tray-thumb" onClick={() => setEditingImageId(p.id)} aria-label="Edit photo">
                          <img src={p.url} alt="" />
                        </button>
                        <button type="button" className="chat-tray-remove" onClick={() => removePendingImage(p.id)} aria-label="Remove photo">
                          <X size={11} strokeWidth={3} />
                        </button>
                      </div>
                    ))}
                    <button type="button" className="chat-tray-add" onClick={() => imageInputRef.current?.click()} aria-label="Add more photos">
                      <Plus size={18} />
                    </button>
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  className="chat-text-input"
                  placeholder={pendingImages.length ? 'Add a caption or send' : 'Type a message'}
                  value={text}
                  onChange={handleTextChange}
                  onKeyDown={handleKeyDown}
                  rows={1}
                />
              </div>
              <button
                className={`chat-send-btn ${text.trim() || pendingImages.length ? 'active' : ''}`}
                onClick={sendAll}
                disabled={!text.trim() && !pendingImages.length}
                aria-label={pendingImages.length ? `Send ${pendingImages.length} photo${pendingImages.length === 1 ? '' : 's'}` : 'Send'}
              >
                <Send size={16} />
                {pendingImages.length > 0 && <span className="chat-send-count">{pendingImages.length}</span>}
              </button>
            </div>

            {/* Photos picked → Edit or Send (like Messenger) */}
            {pendingImages.length > 0 && (
              <div className="chat-pick-actions">
                <button type="button" className="chat-pick-btn" onClick={() => setEditingImageId(pendingImages[pendingImages.length - 1].id)}>
                  Edit
                </button>
                <button type="button" className="chat-pick-btn chat-pick-send" onClick={() => sendPendingImages()}>
                  Send{pendingImages.length > 1 ? ` (${pendingImages.length})` : ''}
                </button>
              </div>
            )}

            {forwarding && (
              <div className="chat-fwd-overlay" onClick={() => setForwarding(null)}>
                <div className="chat-fwd-sheet" role="dialog" aria-modal="true" aria-label="Forward" onClick={e => e.stopPropagation()}>
                  <div className="chat-fwd-head">
                    <span className="chat-fwd-title">Forward</span>
                    <button type="button" className="chat-fwd-close" onClick={() => setForwarding(null)} aria-label="Close"><X size={18} /></button>
                  </div>
                  <div className="chat-fwd-preview">
                    {forwarding.some(m => m.file_type === 'image')
                      ? <><InlineIcon as={ICONS.photo} /> {forwarding.length > 1 ? `${forwarding.length} photos` : 'Photo'}</>
                      : forwarding[0].file_type === 'file' ? <><InlineIcon as={ICONS.file} /> {forwarding[0].file_name || 'File'}</>
                      : <>“{forwarding[0].content}”</>}
                  </div>
                  <div className="chat-fwd-search">
                    <Search size={14} />
                    <input placeholder="Search households and groups" value={forwardSearch} onChange={e => setForwardSearch(e.target.value)} />
                  </div>
                  <div className="chat-fwd-list">
                    {forwardTargets
                      .filter(t => !(activeRoom && t.type === activeRoom.type && t.name === activeRoom.name))
                      .filter(t => t.name.toLowerCase().includes(forwardSearch.toLowerCase()))
                      .map(t => (
                        <div key={t.key} className="chat-fwd-row">
                          <span className="chat-fwd-avatar"><Icon as={t.icon} /></span>
                          <span className="chat-fwd-name">{t.name}<small>{t.type === 'household' ? 'Household' : 'Group'}</small></span>
                          <button
                            type="button"
                            className={`chat-fwd-send${forwardState[t.key] === 'sent' ? ' sent' : ''}`}
                            disabled={forwardState[t.key] === 'sending' || forwardState[t.key] === 'sent'}
                            onClick={() => forwardTo(t)}
                          >
                            {forwardState[t.key] === 'sent' ? <><Check size={14} /> Sent</>
                              : forwardState[t.key] === 'sending' ? 'Sending…'
                              : forwardState[t.key] === 'failed' ? 'Retry' : 'Send'}
                          </button>
                        </div>
                      ))}
                    {forwardTargets.length === 0 && <p className="chat-empty">Loading…</p>}
                  </div>
                </div>
              </div>
            )}

            {editingImage && (
              <ChatImageEditor
                key={editingImage.id}
                item={editingImage}
                onCancel={() => setEditingImageId(null)}
                onDone={(result) => { applyImageEdit(editingImage.id, result); setEditingImageId(null); }}
                onSend={(result) => sendPendingImages(applyImageEdit(editingImage.id, result))}
              />
            )}
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
      <MessageCircle size={24} strokeWidth={1.75} aria-hidden="true" />
      {unreadCount > 0 && (
        <span className="topbar-chat-badge">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}