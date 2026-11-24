// POINTS ("cards in deck"): rules, ledger tables, award / take-back and the points routes.
// Moved out of server.js unchanged. Needs: the express app, the db pool, groupHome (finds a profile) and requireAuth.
module.exports = function points(app, { pool, groupHome, requireAuth }) {
  // ---------------------------------------------------------------------------------------------
  // POINTS ("cards in deck"). One card = one person who accepted being connected to someone.
  //   * the person who adds (and is accepted) gets 1 point
  //   * whoever brought the adder in gets half (0.5), the next up 0.25, 0.125 ... never less than 0.10, the chain never stops
  //   * removing a card takes back, from everyone above, the points that card and everyone under it earned them
  //   * points are public; nothing is ever edited, every change is a new ledger row (award / removed / claim)
  // ---------------------------------------------------------------------------------------------
  const POINTS_MIN = 0.10;
  const r3 = (n) => Math.round(Number(n) * 1000) / 1000;
  const pointsReady = (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS deck_cards (
        card_profile_id VARCHAR(36) NOT NULL PRIMARY KEY,
        brought_by VARCHAR(36) NOT NULL,
        relation_type VARCHAR(20) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS points_ledger (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        profile_id VARCHAR(36) NOT NULL,
        card_profile_id VARCHAR(36) NULL,
        points DECIMAL(10,3) NOT NULL,
        kind VARCHAR(10) NOT NULL,
        note VARCHAR(200) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      for (const ix of [`CREATE INDEX idx_dc_by ON deck_cards (brought_by)`, `CREATE INDEX idx_pl_profile ON points_ledger (profile_id)`, `CREATE INDEX idx_pl_card ON points_ledger (card_profile_id)`]) { try { await pool.query(ix); } catch { /* already there */ } }
    } catch (e) { console.error('points tables:', e.message); }
  })();

  // the people who brought `startId` in, nearest first (adder, the one who brought the adder, ...)
  const chainUp = async (q, startId) => {
    const out = []; const seen = new Set(); let cur = startId;
    while (cur && !seen.has(cur) && out.length < 500) {
      seen.add(cur); out.push(cur);
      const [r] = await q.query(`SELECT brought_by FROM deck_cards WHERE card_profile_id = ? LIMIT 1`, [cur]);
      cur = r.length ? r[0].brought_by : null;
    }
    return out;
  };
  // everyone brought in under `rootId`, at any depth
  const subtreeOf = async (q, rootId) => {
    const seen = new Set(); let frontier = [rootId];
    while (frontier.length && seen.size < 20000) {
      const [rows] = await q.query(`SELECT card_profile_id AS id FROM deck_cards WHERE brought_by IN (${frontier.map(() => '?').join(',')})`, frontier);
      frontier = [];
      for (const r of rows) if (r.id !== rootId && !seen.has(r.id)) { seen.add(r.id); frontier.push(r.id); }
    }
    return seen;
  };
  // `cardId` accepted being connected by `adderId`: make the card and hand out the points
  const awardCard = async (q, adderId, cardId, relation) => {
    await pointsReady;
    if (!adderId || !cardId || adderId === cardId) return { skipped: 'same person' };
    const [have] = await q.query(`SELECT card_profile_id FROM deck_cards WHERE card_profile_id = ? LIMIT 1`, [cardId]);
    if (have.length) return { skipped: 'already a card' };
    const chain = await chainUp(q, adderId);
    if (chain.includes(cardId)) return { skipped: 'would loop' };          // A brought B, B cannot bring A back
    await q.query(`INSERT INTO deck_cards (card_profile_id, brought_by, relation_type) VALUES (?, ?, ?)`, [cardId, adderId, relation || null]);
    const awards = [];
    let pts = 1;
    for (const who of chain) {
      const v = r3(Math.max(pts, POINTS_MIN));
      await q.query(`INSERT INTO points_ledger (id, profile_id, card_profile_id, points, kind, note) VALUES (UUID(), ?, ?, ?, 'award', ?)`, [who, cardId, v, relation || null]);
      awards.push({ profile_id: who, points: v });
      pts = pts / 2;
    }
    return { awards };
  };
  // the relation with `cardId` was removed: take back what it (and everyone under it) earned for people ABOVE it
  const takeBackCard = async (q, cardId) => {
    await pointsReady;
    const [have] = await q.query(`SELECT card_profile_id FROM deck_cards WHERE card_profile_id = ? LIMIT 1`, [cardId]);
    if (!have.length) return { removed: 0 };
    const branch = await subtreeOf(q, cardId);
    const inBranch = new Set([cardId, ...branch]);
    const ids = [...inBranch];
    const [rows] = await q.query(`SELECT profile_id, card_profile_id, SUM(points) AS total FROM points_ledger WHERE card_profile_id IN (${ids.map(() => '?').join(',')}) AND kind IN ('award','removed') GROUP BY profile_id, card_profile_id`, ids);
    let n = 0;
    for (const r of rows) {
      if (inBranch.has(r.profile_id)) continue;                                // people inside the branch keep their own points
      const t = r3(r.total);
      if (t <= 0) continue;
      await q.query(`INSERT INTO points_ledger (id, profile_id, card_profile_id, points, kind, note) VALUES (UUID(), ?, ?, ?, 'removed', 'relation removed')`, [r.profile_id, r.card_profile_id, -t]);
      n++;
    }
    await q.query(`DELETE FROM deck_cards WHERE card_profile_id = ?`, [cardId]);   // the removed person starts their own branch again
    return { removed: n };
  };
  const pointsOf = async (q, profileId) => {
    await pointsReady;
    const [[t]] = await q.query(`SELECT COALESCE(SUM(points), 0) AS balance, COALESCE(SUM(CASE WHEN kind = 'award' THEN points ELSE 0 END), 0) AS earned, COALESCE(SUM(CASE WHEN kind = 'claim' THEN points ELSE 0 END), 0) AS claimed FROM points_ledger WHERE profile_id = ?`, [profileId]);
    const cards = (await subtreeOf(q, profileId)).size;
    return { points: r3(t.balance), earned: r3(t.earned), claimed: r3(-t.claimed), cards };
  };

  // anyone can see anyone's cards and points (it motivates people to grow their deck)
  app.get('/api/points/:ref', async (req, res) => {
    try {
      const P = await groupHome(String(req.params.ref));
      if (!P) return res.status(404).json({ success: false, error: 'Profile not found' });
      res.json({ success: true, profile_id: P.id, name: P.display_name, ...(await pointsOf(pool, P.id)) });
    } catch (e) { console.error('points error:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });
  // my own ledger: what I earned, what was taken back, what I claimed
  app.get('/api/me/points/ledger', requireAuth, async (req, res) => {
    try {
      await pointsReady;
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 200);
      const [rows] = await pool.query(`SELECT l.id, l.points, l.kind, l.note, l.created_at, l.card_profile_id, p.display_name AS card_name FROM points_ledger l LEFT JOIN profiles p ON p.id = l.card_profile_id WHERE l.profile_id = ? ORDER BY l.created_at DESC, l.id DESC LIMIT ${limit}`, [req.home.id]);
      res.json({ success: true, ...(await pointsOf(pool, req.home.id)), entries: rows.map((r) => ({ id: r.id, points: r3(r.points), kind: r.kind, note: r.note || '', card_name: r.card_name || '', created_at: r.created_at })) });
    } catch (e) { console.error('ledger error:', e.message); res.status(500).json({ success: false, error: e.message }); }
  });

  return { awardCard, takeBackCard, pointsOf, pointsReady };
};