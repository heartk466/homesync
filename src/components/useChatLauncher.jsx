import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import ChatDrawer from './ChatDrawer';

/**
 * Gives TopBar everything it needs for the chat button:
 *   - unread       live count of unread messages (updates without opening the chat)
 *   - toggle()     open / close the drawer
 *   - drawer       the <ChatDrawer/> element (rendered by TopBar so it covers the whole screen)
 *
 * It loads the user's households itself, so any screen that shows the TopBar
 * gets the same chat button without extra wiring.
 */
export default function useChatLauncher({ chatUser, profile, enabled = true }) {
  const userId = chatUser?.id;
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [allHouseholds, setAllHouseholds] = useState([]);
  const roomIdsRef = useRef(new Set());
  // Lets the realtime handler (subscribed once) see whether the drawer is open.
  const openRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);

  // Households the user belongs to (the drawer's "Household" tab)
  useEffect(() => {
    if (!enabled || !userId) return undefined;
    let cancelled = false;
    (async () => {
      const { data: memberRows } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('user_id', userId)
        .eq('status', 'active');
      const ids = (memberRows || []).map((r) => r.household_id);
      if (!ids.length) { if (!cancelled) setAllHouseholds([]); return; }
      const { data } = await supabase.from('households').select('*').in('id', ids);
      if (!cancelled) setAllHouseholds(data || []);
    })();
    return () => { cancelled = true; };
  }, [enabled, userId]);

  // Total unread across every household + group chat the user is in
  const refreshUnread = useCallback(async () => {
    if (!enabled || !userId) return;
    try {
      const { data: gm } = await supabase.from('group_members').select('group_id').eq('user_id', userId);
      const groupIds = (gm || []).map((r) => r.group_id);
      const hhIds = allHouseholds.map((h) => h.id);

      const queries = [];
      if (hhIds.length) queries.push(supabase.from('chat_rooms').select('id').eq('type', 'household').in('ref_id', hhIds));
      if (groupIds.length) queries.push(supabase.from('chat_rooms').select('id').eq('type', 'group').in('ref_id', groupIds));
      const results = await Promise.all(queries);
      const roomIds = results.flatMap((r) => (r.data || []).map((x) => x.id));
      roomIdsRef.current = new Set(roomIds);
      if (!roomIds.length) { setUnread(0); return; }

      const { data: reads } = await supabase
        .from('chat_reads')
        .select('room_id, last_read')
        .eq('user_id', userId)
        .in('room_id', roomIds);
      const readMap = Object.fromEntries((reads || []).map((r) => [r.room_id, r.last_read]));

      const counts = await Promise.all(roomIds.map(async (rid) => {
        let q = supabase
          .from('chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('room_id', rid)
          .neq('sender_id', userId);
        if (readMap[rid]) q = q.gt('created_at', readMap[rid]);
        const { count } = await q;
        return count || 0;
      }));
      setUnread(counts.reduce((a, b) => a + b, 0));
    } catch (err) {
      console.error('Chat unread count failed:', err);
    }
  }, [enabled, userId, allHouseholds]);

  // First count, then keep it fresh: new messages, tab focus, and a slow poll as a fallback
  useEffect(() => {
    if (!enabled || !userId) return undefined;
    const firstCount = setTimeout(refreshUnread, 0);

    const channel = supabase
      .channel(`chat-unread-${userId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const m = payload.new;
        if (!m || m.sender_id === userId) return;
        if (roomIdsRef.current.has(m.room_id)) {
          if (!openRef.current) setUnread((n) => n + 1);
        } else {
          refreshUnread(); // a room we haven't counted yet
        }
      })
      .subscribe();

    const onVisible = () => { if (document.visibilityState === 'visible') refreshUnread(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(refreshUnread, 60000);

    return () => {
      clearTimeout(firstCount);
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [enabled, userId, refreshUnread]);

  const close = useCallback(() => {
    setOpen(false);
    setTimeout(refreshUnread, 500); // reading a chat updates chat_reads
  }, [refreshUnread]);

  const toggle = useCallback(() => {
    if (open) close();
    else setOpen(true);
  }, [open, close]);

  const drawer = enabled && userId ? (
    <ChatDrawer
      isOpen={open}
      onClose={close}
      currentUser={chatUser}
      profile={profile}
      allHouseholds={allHouseholds}
    />
  ) : null;

  return { unread, open, toggle, drawer };
}