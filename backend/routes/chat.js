// CHAT: one-to-one and group text chat, live through Server-Sent Events.
// Moved out of server.js unchanged. Needs the express app plus the shared helpers listed below.
module.exports = function chat(app, { pool, requireAuth, crypto, collectFamily, notifyPerson, groupMemberOut }) {
  // ---------------------------------------------------------------------------------------------
  // CHAT: one-to-one and group text chat, live through Server-Sent Events (no extra packages).
  //  - family and people who share a group can chat straight away; anyone else must send a request (shows in the bell)
  //  - every route needs the login token
  // ---------------------------------------------------------------------------------------------
  const chatReady = (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS chat_conversations (
        id VARCHAR(36) NOT NULL PRIMARY KEY, kind VARCHAR(10) NOT NULL, direct_key VARCHAR(140) NULL, group_id VARCHAR(100) NULL,
        created_by VARCHAR(64) NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_message_at DATETIME NULL, last_message_id BIGINT NULL)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS chat_members (
        conversation_id VARCHAR(36) NOT NULL, profile_id VARCHAR(64) NOT NULL, last_read_id BIGINT NOT NULL DEFAULT 0,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (conversation_id, profile_id))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS chat_messages (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, conversation_id VARCHAR(36) NOT NULL, sender_profile_id VARCHAR(64) NOT NULL,
        body TEXT NOT NULL, kind VARCHAR(10) NOT NULL DEFAULT 'text', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
      for (const q of [
        `CREATE UNIQUE INDEX uq_chat_direct ON chat_conversations (direct_key)`,
        `CREATE UNIQUE INDEX uq_chat_group ON chat_conversations (group_id)`,
        `CREATE INDEX idx_chat_msg_conv ON chat_messages (conversation_id, id)`,
        `CREATE INDEX idx_chat_member_profile ON chat_members (profile_id)`,
      ]) { try { await pool.query(q); } catch { /* already there */ } }
    } catch (e) { console.error('chat tables:', e.message); }
  })();

  // live connections: profile id -> open streams
  const chatClients = new Map();
  const chatPush = (profileIds, event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    profileIds.forEach((pid) => (chatClients.get(pid) || []).forEach((r) => { try { r.write(msg); } catch { /* connection closed */ } }));
  };
  app.get('/api/chat/stream', requireAuth, (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders && res.flushHeaders();
    res.write(': connected\n\n');
    const pid = req.home.id;
    if (!chatClients.has(pid)) chatClients.set(pid, new Set());
    chatClients.get(pid).add(res);
    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25000);
    req.on('close', () => { clearInterval(beat); const set = chatClients.get(pid); if (set) { set.delete(res); if (!set.size) chatClients.delete(pid); } });
  });

  const chatPeople = async (ids) => {
    const out = new Map();
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return out;
    const [ps] = await pool.query(`SELECT id, display_name, nickname, gender, photo_compressed_url, photo_url, is_claimed, owner_user_id FROM profiles WHERE id IN (${list.map(() => '?').join(',')})`, list);
    ps.forEach((p) => out.set(p.id, groupMemberOut(p)));
    return out;
  };
  // groups a person owns or has accepted
  const chatGroupIds = async (pid) => {
    const [own] = await pool.query(`SELECT id FROM profile_groups WHERE owner_profile_id = ?`, [pid]);
    const [mem] = await pool.query(`SELECT group_id AS id FROM profile_group_members WHERE profile_id = ? AND COALESCE(status,'accepted') <> 'pending'`, [pid]);
    return new Set([...own, ...mem].map((r) => r.id));
  };
  const directKey = (a, b) => [a, b].sort().join(':');
  const chatFind = async (a, b) => { const [r] = await pool.query(`SELECT * FROM chat_conversations WHERE direct_key = ? LIMIT 1`, [directKey(a, b)]); return r[0] || null; };
  // 'ok' = may chat now, 'request' = needs the other person to accept, 'no_account' = nobody to receive it
  const chatAccess = async (home, other) => {
    if (!other.is_claimed) return 'no_account';
    if (await chatFind(home.id, other.id)) return 'ok';
    const fam = await collectFamily(pool, [home.id]);
    if (fam.has(other.id)) return 'ok';
    const [mine, theirs] = await Promise.all([chatGroupIds(home.id), chatGroupIds(other.id)]);
    for (const g of mine) if (theirs.has(g)) return 'ok';
    return 'request';
  };
  const chatOpenDirect = async (aId, bId) => {
    await chatReady;
    let conv = await chatFind(aId, bId);
    if (conv) return conv;
    const id = crypto.randomUUID();
    try {
      await pool.query(`INSERT INTO chat_conversations (id, kind, direct_key, created_by) VALUES (?, 'direct', ?, ?)`, [id, directKey(aId, bId), aId]);
      await pool.query(`INSERT INTO chat_members (conversation_id, profile_id) VALUES (?, ?), (?, ?)`, [id, aId, id, bId]);
    } catch (e) { conv = await chatFind(aId, bId); if (conv) return conv; throw e; }
    return chatFind(aId, bId);
  };
  // keep a group's chat members equal to the group's accepted members who have a login; returns the allowed ids (null if the group is gone)
  const chatSyncGroup = async (conv) => {
    const [g] = await pool.query(`SELECT id, owner_profile_id FROM profile_groups WHERE id = ? LIMIT 1`, [conv.group_id]);
    if (!g[0]) return null;
    const [ms] = await pool.query(`SELECT m.profile_id AS id FROM profile_group_members m JOIN profiles p ON p.id = m.profile_id WHERE m.group_id = ? AND COALESCE(m.status,'accepted') <> 'pending' AND p.is_claimed = 1`, [conv.group_id]);
    const allowed = new Set([g[0].owner_profile_id, ...ms.map((m) => m.id)].filter(Boolean));
    const [cur] = await pool.query(`SELECT profile_id FROM chat_members WHERE conversation_id = ?`, [conv.id]);
    const have = new Set(cur.map((c) => c.profile_id));
    for (const pid of allowed) if (!have.has(pid)) await pool.query(`INSERT INTO chat_members (conversation_id, profile_id) VALUES (?, ?)`, [conv.id, pid]);
    for (const pid of have) if (!allowed.has(pid)) await pool.query(`DELETE FROM chat_members WHERE conversation_id = ? AND profile_id = ?`, [conv.id, pid]);
    return allowed;
  };
  const chatMembership = async (convId, pid) => {
    await chatReady;
    const [c] = await pool.query(`SELECT * FROM chat_conversations WHERE id = ? LIMIT 1`, [convId]);
    const conv = c[0];
    if (!conv) return null;
    if (conv.kind === 'group') { const allowed = await chatSyncGroup(conv); if (!allowed || !allowed.has(pid)) return null; }
    else { const [m] = await pool.query(`SELECT 1 AS x FROM chat_members WHERE conversation_id = ? AND profile_id = ? LIMIT 1`, [convId, pid]); if (!m.length) return null; }
    return conv;
  };
  const chatSummary = async (conv, home) => {
    const [mems] = await pool.query(`SELECT profile_id, last_read_id FROM chat_members WHERE conversation_id = ?`, [conv.id]);
    const mine = mems.find((m) => m.profile_id === home.id);
    const people = await chatPeople(mems.map((m) => m.profile_id));
    let last = null;
    if (conv.last_message_id) { const [lm] = await pool.query(`SELECT id, sender_profile_id, body, created_at FROM chat_messages WHERE id = ? LIMIT 1`, [conv.last_message_id]); last = lm[0] || null; }
    const [u] = await pool.query(`SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = ? AND id > ? AND sender_profile_id <> ?`, [conv.id, mine ? mine.last_read_id : 0, home.id]);
    let title = '', other = null;
    if (conv.kind === 'group') { const [g] = await pool.query(`SELECT name FROM profile_groups WHERE id = ? LIMIT 1`, [conv.group_id]); title = g[0] ? g[0].name : 'Group'; }
    else { const o = mems.find((m) => m.profile_id !== home.id); other = o ? people.get(o.profile_id) || null : null; title = other ? other.display_name : 'Chat'; }
    return { id: conv.id, kind: conv.kind, title, group_id: conv.group_id || null, other, member_count: mems.length, online_count: mems.filter((m) => m.profile_id !== home.id && chatClients.has(m.profile_id)).length, unread: Number(u[0].n) || 0,
      last_message: last ? { id: last.id, sender_profile_id: last.sender_profile_id, body: last.body, created_at: last.created_at } : null,
      last_message_at: conv.last_message_at || conv.created_at };
  };

  // start (or open) a chat: { profile_id } for one person, { group_id } for a group
  app.post('/api/chat/open', requireAuth, async (req, res) => {
    try {
      await chatReady;
      const b = req.body || {};
      const home = req.home;
      if (b.group_id) {
        const [g] = await pool.query(`SELECT id, owner_profile_id FROM profile_groups WHERE id = ? LIMIT 1`, [String(b.group_id)]);
        if (!g[0]) return res.status(404).json({ success: false, error: 'Group not found' });
        if (!(await chatGroupIds(home.id)).has(g[0].id)) return res.status(403).json({ success: false, error: 'You are not in this group' });
        let [c] = await pool.query(`SELECT * FROM chat_conversations WHERE group_id = ? LIMIT 1`, [g[0].id]);
        if (!c[0]) {
          try { await pool.query(`INSERT INTO chat_conversations (id, kind, group_id, created_by) VALUES (?, 'group', ?, ?)`, [crypto.randomUUID(), g[0].id, home.id]); } catch { /* created at the same moment */ }
          [c] = await pool.query(`SELECT * FROM chat_conversations WHERE group_id = ? LIMIT 1`, [g[0].id]);
        }
        const allowed = await chatSyncGroup(c[0]);
        if (!allowed || !allowed.has(home.id)) return res.status(403).json({ success: false, error: 'Only members with a ClanDeck login can join the group chat' });
        return res.json({ success: true, conversation: await chatSummary(c[0], home) });
      }
      const [o] = await pool.query(`SELECT * FROM profiles WHERE id = ? LIMIT 1`, [String(b.profile_id || '')]);
      const other = o[0];
      if (!other || other.id === home.id) return res.status(400).json({ success: false, error: 'Choose someone else to chat with' });
      const access = await chatAccess(home, other);
      if (access === 'no_account') return res.status(400).json({ success: false, error: `${other.display_name} does not have a ClanDeck login yet. Invite them first.` });
      if (access === 'request') {
        await notifyPerson(other.id, home.id, 'chat_request');
        return res.json({ success: true, needs_request: true, name: other.display_name });
      }
      const conv = await chatOpenDirect(home.id, other.id);
      res.json({ success: true, conversation: await chatSummary(conv, home) });
    } catch (e) { console.error('chat open error:', e); res.status(500).json({ success: false, error: e.message }); }
  });

  app.get('/api/chat/conversations', requireAuth, async (req, res) => {
    try {
      await chatReady;
      const home = req.home;
      const [mine] = await pool.query(`SELECT c.* FROM chat_conversations c JOIN chat_members m ON m.conversation_id = c.id WHERE m.profile_id = ? ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT 100`, [home.id]);
      const out = [];
      for (const c of mine) {
        if (c.kind === 'group') { const allowed = await chatSyncGroup(c); if (!allowed || !allowed.has(home.id)) continue; }
        out.push(await chatSummary(c, home));
      }
      res.json({ success: true, data: out, me: home.id });
    } catch (e) { console.error('chat list error:', e); res.status(500).json({ success: false, error: e.message }); }
  });

  // messages of one chat: newest 50 by default; ?before=<id> for older ones, ?after=<id> for newer ones
  app.get('/api/chat/messages', requireAuth, async (req, res) => {
    try {
      const conv = await chatMembership(String(req.query.conversation_id || ''), req.home.id);
      if (!conv) return res.status(403).json({ success: false, error: 'You are not in this chat' });
      const after = Number(req.query.after) || 0, before = Number(req.query.before) || 0;
      let rows;
      if (after) [rows] = await pool.query(`SELECT id, sender_profile_id, body, kind, created_at FROM chat_messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC LIMIT 200`, [conv.id, after]);
      else {
        [rows] = await pool.query(`SELECT id, sender_profile_id, body, kind, created_at FROM chat_messages WHERE conversation_id = ? ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT 50`, before ? [conv.id, before] : [conv.id]);
        rows.reverse();
      }
      const [mems] = await pool.query(`SELECT profile_id FROM chat_members WHERE conversation_id = ?`, [conv.id]);
      const people = await chatPeople([...mems.map((m) => m.profile_id), ...rows.map((r) => r.sender_profile_id)]);
      res.json({ success: true, data: rows, people: Object.fromEntries(people), has_more: !after && rows.length === 50 });
    } catch (e) { console.error('chat messages error:', e); res.status(500).json({ success: false, error: e.message }); }
  });

  const chatRate = new Map();
  app.post('/api/chat/send', requireAuth, async (req, res) => {
    try {
      const home = req.home;
      const body = String((req.body || {}).body || '').replace(/\r\n/g, '\n').trim();
      if (!body) return res.status(400).json({ success: false, error: 'Write something first' });
      if (body.length > 2000) return res.status(400).json({ success: false, error: 'Message is too long (2000 letters at most)' });
      const now = Date.now();
      const recent = (chatRate.get(home.id) || []).filter((t) => now - t < 10000);
      if (recent.length >= 20) return res.status(429).json({ success: false, error: 'You are sending too fast. Wait a moment.' });
      chatRate.set(home.id, [...recent, now]);
      const conv = await chatMembership(String((req.body || {}).conversation_id || ''), home.id);
      if (!conv) return res.status(403).json({ success: false, error: 'You are not in this chat' });
      const [r] = await pool.query(`INSERT INTO chat_messages (conversation_id, sender_profile_id, body) VALUES (?, ?, ?)`, [conv.id, home.id, body]);
      const [m] = await pool.query(`SELECT id, conversation_id, sender_profile_id, body, kind, created_at FROM chat_messages WHERE id = ? LIMIT 1`, [r.insertId]);
      const msg = m[0];
      await pool.query(`UPDATE chat_conversations SET last_message_at = NOW(), last_message_id = ? WHERE id = ?`, [msg.id, conv.id]);
      await pool.query(`UPDATE chat_members SET last_read_id = ? WHERE conversation_id = ? AND profile_id = ?`, [msg.id, conv.id, home.id]);
      const [mems] = await pool.query(`SELECT profile_id FROM chat_members WHERE conversation_id = ?`, [conv.id]);
      chatPush(mems.map((x) => x.profile_id), 'message', { conversation_id: conv.id, message: msg });
      res.json({ success: true, message: msg });
    } catch (e) { console.error('chat send error:', e); res.status(500).json({ success: false, error: e.message }); }
  });

  app.post('/api/chat/read', requireAuth, async (req, res) => {
    try {
      const conv = await chatMembership(String((req.body || {}).conversation_id || ''), req.home.id);
      if (!conv) return res.status(403).json({ success: false, error: 'You are not in this chat' });
      const [l] = await pool.query(`SELECT MAX(id) AS id FROM chat_messages WHERE conversation_id = ?`, [conv.id]);
      await pool.query(`UPDATE chat_members SET last_read_id = ? WHERE conversation_id = ? AND profile_id = ? AND last_read_id < ?`, [l[0].id || 0, conv.id, req.home.id, l[0].id || 0]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // people I may chat with right now: family and group-mates who have a login
  app.get('/api/chat/people', requireAuth, async (req, res) => {
    try {
      const home = req.home;
      const via = new Map();   // profile id -> where I know them from
      const fam = await collectFamily(pool, [home.id]);
      fam.forEach((id) => via.set(id, 'Family'));
      const gids = [...(await chatGroupIds(home.id))];
      if (gids.length) {
        const ph = gids.map(() => '?').join(',');
        const [gs] = await pool.query(`SELECT id, name, owner_profile_id FROM profile_groups WHERE id IN (${ph})`, gids);
        const gname = new Map(gs.map((g) => [g.id, g.name]));
        const [ms] = await pool.query(`SELECT group_id, profile_id FROM profile_group_members WHERE group_id IN (${ph}) AND COALESCE(status,'accepted') <> 'pending'`, gids);
        gs.forEach((g) => { if (g.owner_profile_id && !via.has(g.owner_profile_id)) via.set(g.owner_profile_id, g.name); });
        ms.forEach((m) => { if (!via.has(m.profile_id)) via.set(m.profile_id, gname.get(m.group_id) || 'Group'); });
      }
      via.delete(home.id);
      const ids = [...via.keys()];
      const people = ids.length ? await chatPeople(ids) : new Map();
      const out = ids.map((id) => people.get(id)).filter((p) => p && p.is_claimed).map((p) => ({ ...p, via: via.get(p.id) }));
      res.json({ success: true, data: out.slice(0, 300) });
    } catch (e) { console.error('chat people error:', e); res.status(500).json({ success: false, error: e.message }); }
  });

  // which of these people are online right now (they have the chat open somewhere)
  app.get('/api/chat/online', requireAuth, (req, res) => {
    const ids = String(req.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 300);
    res.json({ success: true, data: ids.filter((id) => chatClients.has(id)) });
  });

  app.get('/api/chat/unread', requireAuth, async (req, res) => {
    try {
      await chatReady;
      const [u] = await pool.query(`SELECT COUNT(*) AS n FROM chat_messages m JOIN chat_members cm ON cm.conversation_id = m.conversation_id AND cm.profile_id = ? WHERE m.id > cm.last_read_id AND m.sender_profile_id <> ?`, [req.home.id, req.home.id]);
      res.json({ success: true, total: Number(u[0].n) || 0 });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  return { chatOpenDirect, chatReady };
};