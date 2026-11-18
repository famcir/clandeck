import React, { useState, useEffect, useRef, useCallback } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'https://api.clandeck.com';

// ---- small helpers -------------------------------------------------------------------------------------------
const parseTime = (d) => {
  if (!d) return null;
  const raw = String(d);
  const t = new Date(raw.includes('T') || raw.endsWith('Z') ? raw : raw.replace(' ', 'T') + 'Z');   // the server stores UTC
  return Number.isNaN(t.getTime()) ? null : t;
};
const clock = (d) => { const t = parseTime(d); return t ? t.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''; };
const dayLabel = (d) => {
  const t = parseTime(d); if (!t) return '';
  const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (t.toDateString() === today.toDateString()) return 'Today';
  if (t.toDateString() === y.toDateString()) return 'Yesterday';
  return t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const shortWhen = (d) => {
  const t = parseTime(d); if (!t) return '';
  return t.toDateString() === new Date().toDateString() ? clock(d) : t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

function Avatar({ p, name, size = 38, group = false, online = false }) {
  const [bad, setBad] = useState(false);
  const url = p && p.photo_url && !bad ? p.photo_url : '';
  const label = (name || (p && p.display_name) || '?').trim().charAt(0).toUpperCase();
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <div style={{ width: size, height: size, borderRadius: group ? 10 : 9, overflow: 'hidden', background: group ? '#1a1a1a' : '#c9ad83', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: size * 0.4 }}>
        {url ? <img src={url} alt="" onError={() => setBad(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : label}
      </div>
      {online && <span title="Online" style={{ position: 'absolute', top: -3, right: -3, width: 11, height: 11, background: '#2fb344', border: '2px solid white', borderRadius: '50%' }} />}
    </div>
  );
}

// green dot = online, grey dot = offline
function Status({ online, text }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: online ? '#1f8a37' : '#8a7a65' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: online ? '#2fb344' : '#c8c0b2', display: 'inline-block' }} />
      {text || (online ? 'Online' : 'Offline')}
    </span>
  );
}

export default function ChatSystem({ self, allProfiles = [], groups = [], onClose, onUnread }) {
  const token = (() => { try { return localStorage.getItem('token') || ''; } catch { return ''; } })();
  const meKey = self?.id || self?.uname || '';
  const [treePeople, setTreePeople] = useState([]);

  const [view, setView] = useState('list');            // 'list' | 'new' | 'thread'
  const [convs, setConvs] = useState([]);
  const [people, setPeople] = useState([]);            // family + group-mates I can chat with now
  const [joined, setJoined] = useState([]);            // groups made by others that I accepted
  const [active, setActive] = useState(null);          // open conversation summary
  const [messages, setMessages] = useState([]);
  const [who, setWho] = useState({});                  // profile id -> person (for names in groups)
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [needLogin, setNeedLogin] = useState(!token);
  const [online, setOnline] = useState(new Set());
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);              // search results from anyone on ClanDeck
  const [meId, setMeId] = useState('');                // my PROFILE id (the chat identity)
  const endRef = useRef(null);
  const activeRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => { activeRef.current = active; }, [active]);

  const api = useCallback(async (path, opts = {}) => {
    const res = await fetch(`${API_URL}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
    });
    let j = {};
    try { j = await res.json(); } catch { /* not json */ }
    if (res.status === 401) { setNeedLogin(true); throw new Error('Please log out and log in again'); }
    if (!res.ok || j.success === false) throw new Error(j.error || 'Something went wrong');
    return j;
  }, [token]);

  // ---- loading -----------------------------------------------------------------------------------------------
  const loadConvs = useCallback(async () => {
    try {
      const j = await api('/api/chat/conversations');
      setConvs(j.data); if (j.me) setMeId(j.me);
      if (onUnread) onUnread(j.data.reduce((n, c) => n + (c.unread || 0), 0));
    } catch { /* shown by needLogin when it matters */ }
  }, [api, onUnread]);

  useEffect(() => {
    if (needLogin) return;
    loadConvs();
    api('/api/chat/people').then((j) => setPeople(j.data)).catch(() => {});

  }, [needLogin]); // eslint-disable-line

  // the names of family and groups load even before the fresh login (no token needed)
  useEffect(() => {
    if (meKey) fetch(`${API_URL}/api/profiles/family-tree?user_id=${encodeURIComponent(meKey)}`).then((r) => r.json()).then((j) => {
      if (!j.success) return;
      const f = j.family || {};
      const list = [f.father, f.mother, ...(f.siblings || []), ...(f.spouses || []), ...(f.children || [])].filter(Boolean);
      setTreePeople(list.map((p) => ({ ...p, relation_label: p === f.father ? 'Father' : p === f.mother ? 'Mother' : (f.siblings || []).includes(p) ? 'Sibling' : (f.spouses || []).includes(p) ? 'Spouse' : 'Child' })));
    }).catch(() => {});
    if (meKey) fetch(`${API_URL}/api/groups/joined?home_id=${encodeURIComponent(meKey)}`).then((r) => r.json()).then((j) => { if (j.success) setJoined(j.data); }).catch(() => {});
  }, [meKey]); // eslint-disable-line

  // who is online (checked every 10 seconds)
  useEffect(() => {
    if (needLogin) return undefined;
    const ids = [...new Set([...people.map((p) => p.id), ...convs.map((c) => c.other && c.other.id)].filter(Boolean))];
    if (!ids.length) return undefined;
    const check = () => api(`/api/chat/online?ids=${encodeURIComponent(ids.join(','))}`).then((j) => setOnline(new Set(j.data))).catch(() => {});
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, [people, convs.length, needLogin]); // eslint-disable-line

  // live messages
  const openLoad = useCallback(async (conv) => {
    try {
      const j = await api(`/api/chat/messages?conversation_id=${encodeURIComponent(conv.id)}`);
      setMessages(j.data); setWho((w) => ({ ...w, ...j.people })); setHasMore(!!j.has_more);
      api('/api/chat/read', { method: 'POST', body: JSON.stringify({ conversation_id: conv.id }) }).then(loadConvs).catch(() => {});
    } catch (e) { setNotice(e.message); }
  }, [api, loadConvs]);

  useEffect(() => {
    if (needLogin || typeof EventSource === 'undefined') return undefined;
    const es = new EventSource(`${API_URL}/api/chat/stream?token=${encodeURIComponent(token)}`);
    es.addEventListener('message', (ev) => {
      try {
        const { conversation_id: cid, message } = JSON.parse(ev.data);
        const cur = activeRef.current;
        if (cur && cur.id === cid) {
          setMessages((m) => (m.some((x) => x.id === message.id) ? m : [...m, message]));
          api('/api/chat/read', { method: 'POST', body: JSON.stringify({ conversation_id: cid }) }).catch(() => {});
        }
        loadConvs();
      } catch { /* ignore a broken event */ }
    });
    const safety = setInterval(loadConvs, 30000);     // in case the live link dropped quietly
    return () => { es.close(); clearInterval(safety); };
  }, [needLogin, token]); // eslint-disable-line

  useEffect(() => { if (endRef.current) endRef.current.scrollIntoView({ block: 'end' }); }, [messages.length, view]);

  // search everyone on ClanDeck (they must accept a chat request first unless they are family / in a shared group)
  useEffect(() => {
    const term = q.trim();
    if (view !== 'new' || term.length < 2 || !meKey) { setFound([]); return undefined; }
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const j = await (await fetch(`${API_URL}/api/profiles/search?q=${encodeURIComponent(term)}&owner_profile_id=${encodeURIComponent(meKey)}&include_linked=1`)).json();
        if (!dead && j.success) setFound(j.data.filter((p) => p.is_claimed));
      } catch { if (!dead) setFound([]); }
    }, 300);
    return () => { dead = true; clearTimeout(t); };
  }, [q, view, meKey]);

  // ---- actions -----------------------------------------------------------------------------------------------
  const openConv = async (conv) => {
    setNotice(''); setActive(conv); setMessages([]); setView('thread'); setHasMore(false);
    await openLoad(conv);
  };
  const startWith = async (person) => {
    setNotice('');
    if (needLogin) { setNotice('Log out and log in once, then you can start chatting.'); return; }
    if (person.noLogin) { setNotice(`${person.display_name} does not have a ClanDeck login yet. Invite them from your Deck first.`); return; }
    try {
      const j = await api('/api/chat/open', { method: 'POST', body: JSON.stringify({ profile_id: person.id }) });
      if (j.needs_request) { setNotice(`Request sent to ${j.name || person.display_name}. You can chat as soon as they accept.`); return; }
      await loadConvs(); setQ(''); openConv(j.conversation);
    } catch (e) { setNotice(e.message); }
  };
  const startGroup = async (g) => {
    setNotice('');
    if (needLogin) { setNotice('Log out and log in once, then you can open group chats.'); return; }
    try {
      const j = await api('/api/chat/open', { method: 'POST', body: JSON.stringify({ group_id: g.id }) });
      await loadConvs(); openConv(j.conversation);
    } catch (e) { setNotice(e.message); }
  };
  const older = async () => {
    if (!messages.length) return;
    try {
      const j = await api(`/api/chat/messages?conversation_id=${encodeURIComponent(active.id)}&before=${messages[0].id}`);
      const keep = listRef.current ? listRef.current.scrollHeight : 0;
      setMessages((m) => [...j.data, ...m]); setWho((w) => ({ ...w, ...j.people })); setHasMore(!!j.has_more);
      requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight - keep; });
    } catch (e) { setNotice(e.message); }
  };
  const send = async () => {
    const text = draft.trim();
    if (!text || sending || !active) return;
    setSending(true); setNotice('');
    try {
      const j = await api('/api/chat/send', { method: 'POST', body: JSON.stringify({ conversation_id: active.id, body: text }) });
      setDraft('');
      setMessages((m) => (m.some((x) => x.id === j.message.id) ? m : [...m, j.message]));
      loadConvs();
    } catch (e) { setNotice(e.message); }
    setSending(false);
  };
  const back = () => { setActive(null); setView('list'); setNotice(''); loadConvs(); };

  // ---- pieces ------------------------------------------------------------------------------------------------
  const shownView = needLogin ? 'new' : view;      // before the fresh login the names are still listed, so you can see who is there
  const iAm = (m) => (meId ? m.sender_profile_id === meId : false);
  const activeOnline = active && active.other && online.has(active.other.id);
  const needle = q.trim().toLowerCase();
  const apiIds = new Set(people.map((p) => p.id));
  const fromDeck = [...(allProfiles || []), ...treePeople].filter((p, i, arr) => p && arr.findIndex((x) => x.id === p.id) === i)
    .filter((p) => p && p.id && p.display_name && p.id !== meKey && !(p.is_claimed && p.owner_user_id === meKey) && !apiIds.has(p.id))
    .map((p) => ({ id: p.id, display_name: p.display_name, photo_url: p.photo_compressed_url || p.photo_url || '', via: p.computed_relation || p.relation_label || 'Family', noLogin: !p.is_claimed, is_claimed: !!p.is_claimed }));
  const contacts = [...people, ...fromDeck].sort((a, b) => (online.has(b.id) - online.has(a.id)) || (!!a.noLogin - !!b.noLogin) || a.display_name.localeCompare(b.display_name));
  const shownPeople = contacts.filter((p) => !needle || p.display_name.toLowerCase().includes(needle));
  const knownIds = new Set(contacts.map((p) => p.id));
  const shownFound = found.filter((p) => !knownIds.has(p.id));
  const allGroups = [...groups.map((g) => ({ id: g.id, name: g.name, note: 'My group', count: Array.isArray(g.members) ? g.members.length + 1 : 0 })), ...joined.map((g) => ({ id: g.id, name: g.name, note: `by ${g.owner ? g.owner.display_name : 'someone'}`, count: g.members.length + (g.owner ? 1 : 0) }))]
    .filter((g, i, a) => g.id && a.findIndex((x) => x.id === g.id) === i);

  const head = { height: 54, background: '#efe8d3', borderBottom: '1px solid #e9e2d6', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', flexShrink: 0 };
  const round = (dark) => ({ width: 30, height: 30, borderRadius: '50%', border: dark ? 'none' : '1px solid #d8c5a3', background: dark ? '#111' : '#fff', color: dark ? '#fff' : '#111', cursor: 'pointer', fontSize: 12, flexShrink: 0, fontFamily: 'inherit', padding: 0 });
  const small = { fontSize: 10, color: '#8a7a65' };

  return (
    <div className="cs-wrap">
      <style>{`
        .cs-wrap { position: fixed; z-index: 9999; right: 16px; bottom: 86px; font-family: inherit; }
        .cs-box { width: 370px; height: 540px; max-height: calc(100vh - 110px); background: #fffefb; border: 1px solid #e9e2d6; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.2); display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box; position: relative; }
        .cs-box button, .cs-box input, .cs-box textarea { font-family: inherit; }
        .cs-row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; width: 100%; border: none; background: none; text-align: left; cursor: pointer; box-sizing: border-box; }
        .cs-row:hover { background: #f8f5f0; }
        @media (max-width: 650px) {
          .cs-wrap { inset: 0; right: 0; bottom: 0; background: rgba(0,0,0,.3); display: flex; align-items: flex-end; }
          .cs-box { width: 100%; height: 92dvh; max-height: 92dvh; border-radius: 18px 18px 0 0; }
        }
      `}</style>
      <div className="cs-box">
        {/* ---------- header ---------- */}
        <div style={head}>
          {shownView === 'thread' && active ? (
            <>
              <button type="button" onClick={back} style={round(false)} aria-label="Back to chats">←</button>
              <Avatar p={active.other} name={active.title} size={34} group={active.kind === 'group'} online={!!activeOnline} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active.title}</div>
                <div>{active.kind === 'group' ? <span style={small}>{active.member_count} members{active.online_count ? ` · ${active.online_count} online` : ''}</span> : <Status online={!!activeOnline} />}</div>
              </div>
              <button type="button" disabled title="Voice and video calls are coming soon" style={{ ...round(false), opacity: 0.4, cursor: 'not-allowed' }}>📹</button>
            </>
          ) : shownView === 'new' ? (
            <>
              {!needLogin && <button type="button" onClick={() => { setView('list'); setQ(''); setNotice(''); }} style={round(false)} aria-label="Back to chats">←</button>}
              <div style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{needLogin ? '💬 Chats' : 'New chat'}</div>
            </>
          ) : (
            <>
              <div style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>💬 Chats</div>
              <button type="button" onClick={() => { setView('new'); setNotice(''); }} style={{ ...round(true), width: 'auto', padding: '0 14px', height: 30, borderRadius: 20, fontWeight: 600, fontSize: 11 }}>＋ New chat</button>
            </>
          )}
          <button type="button" onClick={onClose} style={round(true)} aria-label="Close chat">✕</button>
        </div>

        {needLogin && (
          <div style={{ padding: '10px 14px', background: '#fff8e1', borderBottom: '1px solid #f1dc9a', fontSize: 12, color: '#5a4a35', flexShrink: 0 }}>
            🔐 Chat is private, so it needs a fresh login. Please <b>log out and log in once</b>, then chat with the people below.
          </div>
        )}

        {/* ---------- chat list ---------- */}
        {!needLogin && shownView === 'list' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {convs.length === 0 && (
              <div style={{ padding: '36px 24px', textAlign: 'center', color: '#8a7a65', fontSize: 13 }}>
                <div style={{ fontSize: 34, marginBottom: 8 }}>💬</div>
                No chats yet.<br />Tap <b>＋ New chat</b> to message your family or a group.
              </div>
            )}
            {convs.map((c) => (
              <button key={c.id} type="button" className="cs-row" onClick={() => openConv(c)}>
                <Avatar p={c.other} name={c.title} group={c.kind === 'group'} online={!!(c.other && online.has(c.other.id))} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: c.unread ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.kind === 'group' ? '👥 ' : ''}{c.title}</span>
                    {c.kind === 'group' ? (c.online_count > 0 ? <Status online text={`${c.online_count} online`} /> : null) : <Status online={!!(c.other && online.has(c.other.id))} />}
                    <span style={{ ...small, flexShrink: 0 }}>{c.last_message ? shortWhen(c.last_message.created_at) : ''}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ flex: 1, fontSize: 12, color: c.unread ? '#1a1a1a' : '#8a7a65', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.last_message ? c.last_message.body : 'Say hello 👋'}</span>
                    {c.unread > 0 && <span style={{ background: '#d33', color: 'white', borderRadius: 10, minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box', fontSize: 10, fontWeight: 700, lineHeight: '18px', textAlign: 'center', flexShrink: 0 }}>{c.unread > 99 ? '99+' : c.unread}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ---------- new chat ---------- */}
        {shownView === 'new' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div style={{ padding: '10px 14px 4px' }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search family, friends, anyone on ClanDeck" aria-label="Search people"
                style={{ width: '100%', boxSizing: 'border-box', height: 36, background: '#f8f5f0', border: '1px solid #e9e2d6', borderRadius: 20, padding: '0 14px', fontSize: 12, outline: 'none' }} />
            </div>
            {notice && <div style={{ margin: '6px 14px', padding: '8px 12px', background: '#fff8e1', border: '1px solid #f1dc9a', borderRadius: 10, fontSize: 12 }}>{notice}</div>}

            {shownPeople.length > 0 && <div style={{ ...small, fontWeight: 700, padding: '10px 14px 2px', letterSpacing: 1 }}>FAMILY &amp; FRIENDS</div>}
            {shownPeople.map((p) => (
              <button key={p.id} type="button" className="cs-row" onClick={() => startWith(p)} style={p.noLogin || needLogin ? { opacity: 0.85 } : undefined}>
                <Avatar p={p} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.display_name}</div>
                  <div style={small}>{p.via}</div>
                </div>
                {p.noLogin ? <span style={{ fontSize: 10, color: '#8a7a65', flexShrink: 0 }}>No login yet</span> : needLogin ? null : <Status online={online.has(p.id)} />}
              </button>
            ))}
            {contacts.length === 0 && !needle && <div style={{ ...small, padding: '10px 14px', fontSize: 12 }}>No family or group friends yet. Add them from your Deck, or search above.</div>}

            {!needLogin && shownFound.length > 0 && <div style={{ ...small, fontWeight: 700, padding: '10px 14px 2px', letterSpacing: 1 }}>OTHER MEMBERS (they must accept first)</div>}
            {!needLogin && shownFound.map((p) => (
              <button key={p.id} type="button" className="cs-row" onClick={() => startWith(p)}>
                <Avatar p={{ photo_url: p.photo }} name={p.display_name} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.display_name}</div>
                  <div style={small}>{p.location || 'ClanDeck member'}</div>
                </div>
                <span style={{ fontSize: 10, color: '#8a7a65' }}>Send request</span>
              </button>
            ))}

            {allGroups.length > 0 && <div style={{ ...small, fontWeight: 700, padding: '12px 14px 2px', letterSpacing: 1 }}>GROUP CHATS</div>}
            {allGroups.filter((g) => !needle || g.name.toLowerCase().includes(needle)).map((g) => (
              <button key={g.id} type="button" className="cs-row" onClick={() => startGroup(g)}>
                <Avatar name={g.name} size={34} group />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                  <div style={small}>{g.note}{g.count ? ` · ${g.count} members` : ''}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ---------- conversation ---------- */}
        {!needLogin && shownView === 'thread' && active && (
          <>
            <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 12, background: '#fcfaf6', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {hasMore && <button type="button" onClick={older} style={{ alignSelf: 'center', border: '1px solid #d8c5a3', background: '#fff', borderRadius: 14, padding: '4px 12px', fontSize: 11, cursor: 'pointer' }}>Load older messages</button>}
              {messages.length === 0 && <div style={{ textAlign: 'center', color: '#aaa', fontSize: 12, marginTop: 30 }}>No messages yet. Say hello 👋</div>}
              {messages.map((m, i) => {
                const mine = iAm(m);
                const newDay = i === 0 || dayLabel(messages[i - 1].created_at) !== dayLabel(m.created_at);
                const sender = who[m.sender_profile_id];
                return (
                  <React.Fragment key={m.id}>
                    {newDay && <div style={{ alignSelf: 'center', fontSize: 10, color: '#8a7a65', background: '#efe8d3', borderRadius: 10, padding: '2px 10px', margin: '6px 0' }}>{dayLabel(m.created_at)}</div>}
                    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                      <div style={{ maxWidth: '78%', padding: '7px 11px', borderRadius: 12, borderBottomRightRadius: mine ? 3 : 12, borderBottomLeftRadius: mine ? 12 : 3, fontSize: 13, lineHeight: '18px', background: mine ? '#111' : '#fff', color: mine ? '#fff' : '#1a1a1a', border: mine ? 'none' : '1px solid #e9e2d6', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                        {active.kind === 'group' && !mine && sender && <div style={{ fontSize: 10, fontWeight: 700, color: '#a07b3c', marginBottom: 2 }}>{sender.display_name}</div>}
                        {m.body}
                        <div style={{ fontSize: 9, opacity: 0.6, textAlign: 'right', marginTop: 2 }}>{clock(m.created_at)}</div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
              <div ref={endRef} />
            </div>
            {notice && <div style={{ padding: '6px 12px', background: '#fdecea', color: '#b3261e', fontSize: 12 }}>{notice}</div>}
            <div style={{ padding: 8, borderTop: '1px solid #e9e2d6', display: 'flex', alignItems: 'flex-end', gap: 6, background: '#fff', flexShrink: 0 }}>
              <button type="button" disabled title="Photos and files are coming soon" style={{ ...round(false), opacity: 0.4, cursor: 'not-allowed', borderRadius: 8 }}>📎</button>
              <button type="button" disabled title="Voice notes are coming soon" style={{ ...round(false), opacity: 0.4, cursor: 'not-allowed', borderRadius: 8 }}>🎙️</button>
              <textarea value={draft} rows={1} maxLength={2000} placeholder="Type a message…" aria-label="Message"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                style={{ flex: 1, minWidth: 0, resize: 'none', maxHeight: 90, background: '#f8f5f0', border: '1px solid #e9e2d6', borderRadius: 18, padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              <button type="button" onClick={send} disabled={sending || !draft.trim()} aria-label="Send" style={{ ...round(true), width: 36, height: 36, opacity: sending || !draft.trim() ? 0.5 : 1 }}>➤</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}