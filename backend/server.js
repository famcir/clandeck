require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const app = express();

// ===== STARTUP CHECK: warn if a required variable is missing =====
['MYSQLHOST', 'MYSQLUSER', 'MYSQLPASSWORD', 'MYSQL_DATABASE', 'MYSQLPORT', 'ADMIN_KEY', 'ENDPOINT', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'RAILWAY_BUCKET_NAME'].forEach((name) => {
  if (!process.env[name]) console.error(`WARNING: environment variable ${name} is not set`);
});

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://clandeck.com',
    'https://www.clandeck.com',
    'https://famcir.github.io',
    'https://api.clandeck.com'
  ],
  credentials: true,
  allowedHeaders: ['Content-Type', 'x-admin-key', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));

// ===== DATABASE: all values come from environment variables only =====
const pool = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: Number(process.env.MYSQLPORT),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

app.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT NOW() as time');
    res.json({ status: 'Clandeck API v3 - Upload Fixed + Same ID + Email', db: 'connected', time: rows[0].time });
  } catch (e) {
    // Do not leak internal error details to the public
    console.error('Health check DB error:', e.message);
    res.json({ status: 'API Running', db: 'disconnected' });
  }
});

// ---- passwords: new passwords are stored hashed (scrypt, built into Node). Older plain-text ones still work. ----
const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
};
const checkPassword = (pw, stored) => {
  if (!stored) return false;
  if (String(stored).startsWith('scrypt$')) {
    const [, salt, hex] = String(stored).split('$');
    if (!salt || !hex) return false;
    const want = Buffer.from(hex, 'hex');
    const got = crypto.scryptSync(String(pw), salt, want.length);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }
  return String(stored) === String(pw);          // legacy plain-text account
};
const TEMP_LOGIN_DAYS = 7;
const isExpiredTemp = (u) => {
  if (!u.is_temp || !u.created_at) return false;
  const t = new Date(u.created_at).getTime();
  return Number.isFinite(t) && Date.now() - t > TEMP_LOGIN_DAYS * 86400000;
};

// ===== LOGIN TOKENS (signed with HMAC; no extra packages). Chat needs them so nobody can read another person's messages. =====
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.createHash('sha256').update(`clandeck|${process.env.MYSQLPASSWORD || ''}|${process.env.ADMIN_KEY || ''}`).digest('hex');
if (!process.env.AUTH_SECRET) console.error('WARNING: AUTH_SECRET is not set (add a long random value in Railway Variables). Using a value derived from other secrets for now.');
const signToken = (uid) => {
  const body = Buffer.from(JSON.stringify({ u: String(uid), exp: Date.now() + 30 * 24 * 3600 * 1000 })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url')}`;
};
const readToken = (t) => {
  try {
    const [body, sig] = String(t || '').split('.');
    if (!body || !sig) return null;
    const want = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p.u : null;
  } catch { return null; }
};
// route guard: needs "Authorization: Bearer <token>" (or ?token= for the live stream); sets req.home = the caller's profile
const requireAuth = async (req, res, next) => {
  try {
    const h = String(req.headers.authorization || '');
    const uid = readToken(h.startsWith('Bearer ') ? h.slice(7) : req.query.token);
    if (!uid) return res.status(401).json({ success: false, error: 'Please log out and log in again' });
    const home = await groupHome(uid);
    if (!home) return res.status(401).json({ success: false, error: 'Please log out and log in again' });
    req.uid = uid; req.home = home;
    next();
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

const handleLogin = async (req, res) => {
  let { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, msg: 'Username and password required' });
  username = String(username).trim(); password = String(password).trim();
  try {
    const [rows] = await pool.query(
      `SELECT id, name, mobile, email, photo_url, status, uname, password, is_temp, shared_profile_id, invited_by_user_id, created_at
       FROM users
       WHERE (id = ? OR uname = ? OR LOWER(uname) = LOWER(?) OR CAST(id AS CHAR) = ?)
       AND status = 'active' LIMIT 10`,
      [username, username, username, username]
    );
    const matches = rows.filter((u) => checkPassword(password, u.password));
    if (matches.length === 0) return res.status(401).json({ success: false, msg: 'Invalid username or password' });
    const user = matches[0];
    if (isExpiredTemp(user)) return res.status(401).json({ success: false, msg: 'This temporary login has expired. Ask your family member to send a new one.' });
    try {
      const [pExist] = await pool.query(`SELECT id FROM profiles WHERE owner_user_id = ? OR id = ? LIMIT 1`, [user.id, user.id]);
      if (pExist.length === 0) {
        await pool.query(`INSERT INTO profiles (id, owner_user_id, display_name, gender, show_in_deck, is_claimed, created_at) VALUES (?, ?, ?, 'Male', 1, 1, NOW())`, [user.id, user.id, user.name]);
      } else {
        await pool.query(`UPDATE profiles SET display_name = ? WHERE (owner_user_id = ? OR id = ?) AND (display_name='Hidden' OR display_name='' OR display_name IS NULL)`, [user.name, user.id, user.id]);
      }
      // first login with an invitation: this family member now owns their profile
      if (user.is_temp && user.shared_profile_id) {
        const [wasOpen] = await pool.query(`SELECT id FROM profiles WHERE id = ? AND is_claimed = 0 LIMIT 1`, [user.shared_profile_id]);
        await pool.query(`UPDATE profiles SET is_claimed = 1, owner_user_id = ? WHERE id = ? AND is_claimed = 0`, [user.id, user.shared_profile_id]);
        // only the FIRST login counts: the person who invited them gets the points for the new card
        if (wasOpen.length) { try { const inviter = user.invited_by_user_id ? await groupHome(String(user.invited_by_user_id)) : null; if (inviter) await awardCard(pool, inviter.id, user.shared_profile_id, 'Invited'); } catch (e) { console.error('points award (invite):', e.message); } }
      }
    } catch (e) { console.log('auto-create profile skipped:', e.message); }
    const userData = { id: user.id, name: user.name, uname: user.uname, username: user.uname || user.id, mobile: user.mobile, email: user.email, photo_url: user.photo_url, status: user.status, is_temp: user.is_temp ? 1 : 0 };
    res.json({ success: true, msg: `Welcome, ${user.name}!`, token: signToken(user.id), user: userData, id: userData.id, name: userData.name, uname: userData.uname, photo_url: userData.photo_url, is_temp: userData.is_temp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: 'Database error' });
  }
};

// ===== UPLOAD (base64 echo - to be moved to the bucket later) =====
app.post('/api/upload', async (req, res) => {
  try {
    const { image, photo, photo_url, file, base64 } = req.body;
    let finalUrl = image || photo || photo_url || file || base64;
    if (!finalUrl) return res.status(400).json({ success: false, error: 'No image data received' });
    res.json({ success: true, url: finalUrl, photo_url: finalUrl, message: 'Upload OK (base64 stored)' });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});
app.post('/api/profiles/upload', async (req, res) => {
  try {
    const { image, photo, photo_url, file } = req.body;
    const finalUrl = image || photo || photo_url || file;
    if (!finalUrl) return res.status(400).json({ success: false, error: 'No image' });
    res.json({ success: true, url: finalUrl, photo_url: finalUrl });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.post('/api/profiles/photo-upload', async (req, res) => {
  try {
    const { image, photo, photo_url } = req.body;
    const finalUrl = image || photo || photo_url;
    res.json({ success: true, url: finalUrl, photo_url: finalUrl });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/profiles/family-tree', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
    // exact=1: the id is a PROFILE id (viewing someone else), never fall back to "the profile claimed by this user id"
    const [myRows] = req.query.exact === '1'
      ? await pool.query(`SELECT * FROM profiles WHERE id = ? LIMIT 1`, [user_id])
      : await pool.query(`SELECT * FROM profiles WHERE id = ? OR (owner_user_id = ? AND is_claimed = 1) ORDER BY (id = ?) DESC LIMIT 1`, [user_id, user_id, user_id]);
    if (myRows.length === 0) return res.status(404).json({ success: false, error: 'Profile not found' });
    const myProfile = myRows[0]; const myProfileId = myProfile.id;
    const [relations] = await pool.query(`SELECT * FROM profile_relations WHERE owner_profile_id = ? ORDER BY CAST(spouse_group AS UNSIGNED) ASC, birth_order ASC`, [myProfileId]);
    let father = null, mother = null, siblings = [], spouses = [], children = [];
    for (let rel of relations) {
      const [pRows] = await pool.query(`SELECT * FROM profiles WHERE id = ? LIMIT 1`, [rel.related_profile_id]);
      if (pRows.length === 0) continue;
      const profile = pRows[0];
      if (rel.relation_type === 'Father') father = profile;
      else if (rel.relation_type === 'Mother') mother = profile;
      else if (rel.relation_type === 'Sibling') siblings.push(profile);
      else if (rel.relation_type === 'Spouse') { profile.spouse_group = rel.spouse_group; profile.spouse_number = rel.spouse_number; spouses.push(profile); }
      else if (rel.relation_type === 'Child') { profile.spouse_group = rel.spouse_group; profile.birth_order = rel.birth_order; children.push(profile); }
    }
    // Parents saved only in profiles.father_id / mother_id (no relation row) still show up
    if (!father && myProfile.father_id) { const [f] = await pool.query(`SELECT * FROM profiles WHERE id = ? LIMIT 1`, [myProfile.father_id]); father = f[0] || null; }
    if (!mother && myProfile.mother_id) { const [m] = await pool.query(`SELECT * FROM profiles WHERE id = ? LIMIT 1`, [myProfile.mother_id]); mother = m[0] || null; }
    res.json({ success: true, myProfile, family: { father, mother, siblings, spouses, children } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/profiles/auto-create', async (req, res) => {
  try {
    const { user_id, display_name, gender } = req.body;
    if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
    const [exists] = await pool.query(`SELECT * FROM profiles WHERE id = ? OR (owner_user_id = ? AND is_claimed = 1) ORDER BY (id = ?) DESC LIMIT 1`, [user_id, user_id, user_id]);
    if (exists.length > 0) return res.json({ success: true, data: exists[0] });
    let name = display_name;
    if (!name) { const [u] = await pool.query(`SELECT name FROM users WHERE id = ? LIMIT 1`, [user_id]); name = u[0]?.name || 'User'; }
    await pool.query(`INSERT INTO profiles (id, owner_user_id, display_name, gender, show_in_deck, is_claimed, created_at) VALUES (?, ?, ?, ?, 1, 1, NOW())`, [user_id, user_id, name, gender || 'Male']);
    const [rows] = await pool.query(`SELECT * FROM profiles WHERE id = ?`, [user_id]);
    res.json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ---------------------------------------------------------------------------------------------
// reconcileFamily: keeps every link in a family consistent, in BOTH directions, whatever order
// people were added in. Safe to run any number of times (it only adds what is missing).
//   * child  -> Father/Mother rows, and parent -> Child rows
//   * both parents of a child become spouses of each other, and the child sits under that marriage
//   * everyone who shares a parent is a Sibling of each other (both directions)
//   * every Spouse row has its mirror row
// ---------------------------------------------------------------------------------------------
// Every person connected to the seeds through relation rows or father/mother fields.
// skipId = a person we must NOT walk through (used to see who would be cut off if they were removed).
async function collectFamily(conn, seedIds, skipId = null) {
  const ids = new Set((seedIds || []).filter((i) => i && i !== skipId));
  let frontier = [...ids];
  while (frontier.length && ids.size < 1000) {
    const batch = frontier; frontier = [];
    const ph = batch.map(() => '?').join(',');
    const [rel] = await conn.query(`SELECT owner_profile_id AS a, related_profile_id AS b FROM profile_relations WHERE owner_profile_id IN (${ph}) OR related_profile_id IN (${ph})`, [...batch, ...batch]);
    const [prof] = await conn.query(`SELECT id, father_id, mother_id FROM profiles WHERE id IN (${ph}) OR father_id IN (${ph}) OR mother_id IN (${ph})`, [...batch, ...batch, ...batch]);
    const found = [];
    rel.forEach((r) => found.push(r.a, r.b));
    prof.forEach((p) => found.push(p.id, p.father_id, p.mother_id));
    found.filter((i) => i && i !== skipId).forEach((i) => { if (!ids.has(i)) { ids.add(i); frontier.push(i); } });
  }
  return ids;
}

// all ancestors (parents, grandparents ...) of a person, used to stop impossible links like "your child is your father"
async function ancestorsOf(conn, id) {
  const seen = new Set(); let frontier = [id];
  for (let depth = 0; depth < 40 && frontier.length; depth++) {
    const ph = frontier.map(() => '?').join(',');
    const [rows] = await conn.query(`SELECT father_id, mother_id FROM profiles WHERE id IN (${ph})`, frontier);
    frontier = [];
    rows.forEach((r) => [r.father_id, r.mother_id].forEach((p) => { if (p && !seen.has(p)) { seen.add(p); frontier.push(p); } }));
  }
  return seen;
}

async function reconcileFamily(conn, seedIds) {
  const ids = await collectFamily(conn, seedIds);
  const all = [...ids];
  if (!all.length) return { added: 0 };
  const ph = all.map(() => '?').join(',');
  const [profs] = await conn.query(`SELECT id, father_id, mother_id FROM profiles WHERE id IN (${ph})`, all);
  const known = new Set(profs.map((p) => p.id));
  let added = 0;

  const getRel = async (a, b, type) => {
    const [r] = await conn.query(`SELECT id, spouse_group FROM profile_relations WHERE owner_profile_id = ? AND related_profile_id = ? AND relation_type = ? LIMIT 1`, [a, b, type]);
    return r[0] || null;
  };
  const ensure = async (a, b, type, o = {}) => {
    const r = await getRel(a, b, type);
    if (!r) {
      await conn.query(
        `INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group, spouse_number, birth_order, created_at) VALUES (UUID(), ?, ?, ?, ?, ?, ?, NOW())`,
        [a, b, type, o.spouse_group ?? null, o.spouse_number ?? null, o.birth_order ?? null]
      );
      added++;
    } else if (o.spouse_group != null && r.spouse_group == null) {
      await conn.query(`UPDATE profile_relations SET spouse_group = ? WHERE id = ?`, [o.spouse_group, r.id]);
    }
  };
  const nextNo = async (pid) => {
    const [[r]] = await conn.query(`SELECT COALESCE(MAX(spouse_number), 0) AS n FROM profile_relations WHERE owner_profile_id = ? AND relation_type = 'Spouse'`, [pid]);
    return Number(r.n) + 1;
  };
  // makes sure A->B and B->A Spouse rows both exist; returns the marriage number each side uses
  const ensureCouple = async (a, b) => {
    let ra = await getRel(a, b, 'Spouse');
    if (!ra) { const n = await nextNo(a); await ensure(a, b, 'Spouse', { spouse_group: String(n), spouse_number: n }); ra = await getRel(a, b, 'Spouse'); }
    let rb = await getRel(b, a, 'Spouse');
    if (!rb) { const n = await nextNo(b); await ensure(b, a, 'Spouse', { spouse_group: String(n), spouse_number: n }); rb = await getRel(b, a, 'Spouse'); }
    return { ga: ra.spouse_group, gb: rb.spouse_group };
  };

  // 1) parent <-> child rows, 2) parents become spouses and the child sits under that marriage
  const doneCouples = new Map();
  for (const p of profs) {
    if (p.father_id && known.has(p.father_id)) { await ensure(p.id, p.father_id, 'Father'); await ensure(p.father_id, p.id, 'Child'); }
    if (p.mother_id && known.has(p.mother_id)) { await ensure(p.id, p.mother_id, 'Mother'); await ensure(p.mother_id, p.id, 'Child'); }
    if (p.father_id && p.mother_id && known.has(p.father_id) && known.has(p.mother_id)) {
      const key = p.father_id + '|' + p.mother_id;
      if (!doneCouples.has(key)) doneCouples.set(key, await ensureCouple(p.father_id, p.mother_id));
      const { ga, gb } = doneCouples.get(key);
      await ensure(p.father_id, p.id, 'Child', { spouse_group: ga });
      await ensure(p.mother_id, p.id, 'Child', { spouse_group: gb });
    }
  }
  // 3) everyone who shares a parent is a sibling of each other
  const byParent = new Map();
  for (const p of profs) for (const par of [p.father_id, p.mother_id]) {
    if (par) { if (!byParent.has(par)) byParent.set(par, []); byParent.get(par).push(p.id); }
  }
  for (const kids of byParent.values()) {
    for (const x of kids) for (const y of kids) if (x !== y) await ensure(x, y, 'Sibling');
  }
  // 4) every Spouse row has its mirror
  const [spRows] = await conn.query(`SELECT owner_profile_id AS a, related_profile_id AS b FROM profile_relations WHERE relation_type = 'Spouse' AND owner_profile_id IN (${ph})`, all);
  for (const r of spRows) {
    if (!(await getRel(r.b, r.a, 'Spouse'))) { const n = await nextNo(r.b); await ensure(r.b, r.a, 'Spouse', { spouse_group: String(n), spouse_number: n }); }
  }
  return { added };
}

// Checks and repairs the links of a whole family (run when Profile Edit opens; harmless to repeat)
app.post('/api/profiles/family-repair', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { owner_profile_id } = req.body || {};
    if (!owner_profile_id) { conn.release(); return res.status(400).json({ success: false, error: 'owner_profile_id required' }); }
    const [rows] = await conn.query(`SELECT id FROM profiles WHERE id = ? OR (owner_user_id = ? AND is_claimed = 1) ORDER BY (id = ?) DESC LIMIT 1`, [owner_profile_id, owner_profile_id, owner_profile_id]);
    if (!rows.length) { conn.release(); return res.status(404).json({ success: false, error: 'Profile not found' }); }
    await conn.beginTransaction();
    const out = await reconcileFamily(conn, [rows[0].id]);
    await conn.commit();
    res.json({ success: true, ...out });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    console.error('family-repair error:', e);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  } finally { try { conn.release(); } catch {} }
});

// ---------------------------------------------------------------------------------------------
// SEARCH: find a person who already exists, so they can be linked instead of creating a duplicate.
// Privacy: other people's profiles only appear when they have claimed an account and are public.
// Your own family members always appear. Email / phone only match when typed in full, never in part.
// ---------------------------------------------------------------------------------------------
app.get('/api/profiles/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const ownerRef = String(req.query.owner_profile_id || '').trim();
    if (q.length < 2) return res.json({ success: true, data: [] });
    const [orows] = await pool.query(`SELECT id, owner_user_id FROM profiles WHERE id = ? OR (owner_user_id = ? AND is_claimed = 1) ORDER BY (id = ?) DESC LIMIT 1`, [ownerRef, ownerRef, ownerRef]);
    if (!orows.length) return res.status(404).json({ success: false, error: 'Profile not found' });
    const me = orows[0];
    const like = `%${q.replace(/[%_\\]/g, '')}%`;
    const [rows] = await pool.query(
      `SELECT id, display_name, nickname, gender, location, dob, photo_compressed_url, photo_url, is_claimed, owner_user_id, visibility, email, mobile_number
         FROM profiles
        WHERE id <> ?
          AND (display_name LIKE ? OR nickname LIKE ? OR LOWER(email) = LOWER(?) OR mobile_number = ?)
          AND (owner_user_id = ? OR (is_claimed = 1 AND LOWER(COALESCE(visibility, 'public')) <> 'private'))
        ORDER BY (owner_user_id = ?) DESC, display_name
        LIMIT 25`,
      [me.id, like, like, q, q, me.owner_user_id, me.owner_user_id]
    );
    // leave out people who are already linked to this person
    const [rel] = await pool.query(`SELECT related_profile_id AS id FROM profile_relations WHERE owner_profile_id = ?`, [me.id]);
    const linked = new Set(rel.map((r) => r.id));
    const photo = (p) => {
      const u = p.photo_compressed_url || p.photo_url || '';
      return u.startsWith('blob:') || u.startsWith('data:') ? '' : u;
    };
    const keepLinked = String(req.query.include_linked || '') === '1';
    const data = rows.filter((p) => keepLinked || !linked.has(p.id)).slice(0, 10).map((p) => ({
      id: p.id, display_name: p.display_name, nickname: p.nickname || '', gender: p.gender || '',
      location: p.location || '', is_claimed: p.is_claimed ? 1 : 0, mine: p.owner_user_id === me.owner_user_id ? 1 : 0,
      photo: photo(p), exact: (p.email && p.email.toLowerCase() === q.toLowerCase()) || p.mobile_number === q ? 1 : 0,
    }));
    res.json({ success: true, data });
  } catch (e) {
    console.error('search error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------------------------------------------------------------------------------------------
// GROUPS: My Friends (made automatically), school, college and custom groups.
//   * a group belongs to the person who made it; the members are ordinary profiles
//   * removing someone from a group only removes them from the group (their profile stays)
//   * a person you created only for a group, with no family links and no login, is cleaned up when you remove them
// ---------------------------------------------------------------------------------------------
const GROUP_KINDS = ['friends', 'school', 'college', 'custom'];
// Uses YOUR existing tables profile_groups / profile_group_members. The first start only adds the columns that
// are still missing (owner_profile_id, kind, is_default, visibility); nothing existing is changed or removed.
// Rows that belong to the older design (no owner_profile_id) are simply ignored here.
const groupsReady = (async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS profile_groups (
      id VARCHAR(100) NOT NULL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description TEXT NULL,
      image_url TEXT NULL,
      owner_user_id VARCHAR(100) NOT NULL,
      privacy VARCHAR(20) NULL,
      status VARCHAR(20) NULL,
      member_count INT NULL,
      invite_code VARCHAR(20) NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS profile_group_members (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      group_id VARCHAR(36) NOT NULL,
      profile_id VARCHAR(36) NOT NULL,
      added_by VARCHAR(36) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (group_id, profile_id)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS profile_notifications (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      to_profile_id VARCHAR(36) NOT NULL,
      from_profile_id VARCHAR(36) NULL,
      kind VARCHAR(20) NOT NULL,
      group_id VARCHAR(36) NULL,
      relation_type VARCHAR(20) NULL,
      message TEXT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      responded_at DATETIME NULL
    )`);
    try { await pool.query(`CREATE INDEX idx_pn_to ON profile_notifications (to_profile_id)`); } catch { /* already there */ }
    // a member who has their own account must accept before they count as being in the group
    try { await pool.query(`ALTER TABLE profile_group_members ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'accepted'`); } catch { /* already there */ }
    // columns this feature needs (a failure here just means the column is already there)
    for (const col of [
      `owner_profile_id VARCHAR(36) NULL`,
      `kind VARCHAR(20) NOT NULL DEFAULT 'custom'`,
      `is_default TINYINT NOT NULL DEFAULT 0`,
      `visibility VARCHAR(10) NOT NULL DEFAULT 'private'`,   // 'private' = only me, 'family' = relatives can find these people by searching
    ]) { try { await pool.query(`ALTER TABLE profile_groups ADD COLUMN ${col}`); } catch { /* already there */ } }
    for (const ix of [
      `CREATE INDEX idx_pg_owner_profile ON profile_groups (owner_profile_id)`,
      `CREATE INDEX idx_pgm_profile ON profile_group_members (profile_id)`,
    ]) { try { await pool.query(ix); } catch { /* already there */ } }
  } catch (e) { console.error('group tables:', e.message); }
})();

const groupHome = async (ref) => {
  const [r] = await pool.query(`SELECT * FROM profiles WHERE id = ? OR (owner_user_id = ? AND is_claimed = 1) ORDER BY (id = ?) DESC LIMIT 1`, [ref, ref, ref]);
  return r[0] || null;
};
const cleanPhoto = (p) => { const u = p.photo_compressed_url || p.photo_url || ''; return u.startsWith('blob:') || u.startsWith('data:') ? '' : u; };
// one pending request per (person, group / relation); asks the person to accept or reject
const notifyPerson = async (to, from, kind, extra = {}) => {
  await groupsReady;
  if (kind !== 'info') {
    const [dup] = await pool.query(`SELECT id FROM profile_notifications WHERE to_profile_id = ? AND from_profile_id = ? AND kind = ? AND status = 'pending' AND COALESCE(group_id,'') = ? AND COALESCE(relation_type,'') = ? LIMIT 1`,
      [to, from, kind, extra.group_id || '', extra.relation_type || '']);
    if (dup.length) return;
  }
  await pool.query(`INSERT INTO profile_notifications (id, to_profile_id, from_profile_id, kind, group_id, relation_type, message, status) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)`,
    [to, from, kind, extra.group_id || null, extra.relation_type || null, extra.message || null, kind === 'info' ? 'info' : 'pending']);
};

const groupMemberOut = (p) => ({ id: p.id, display_name: p.display_name, nickname: p.nickname || '', gender: p.gender || '', photo_url: cleanPhoto(p), is_claimed: p.is_claimed ? 1 : 0, owner_user_id: p.owner_user_id });

const loadGroups = async (home) => {
  await groupsReady;
  let [gs] = await pool.query(`SELECT * FROM profile_groups WHERE owner_profile_id = ? ORDER BY is_default DESC, created_at, name`, [home.id]);
  if (!gs.some((g) => g.is_default)) {
    try {
      await pool.query(`INSERT INTO profile_groups (id, owner_user_id, owner_profile_id, name, kind, is_default) VALUES (UUID(), ?, ?, 'My Friends', 'friends', 1)`, [home.owner_user_id || home.id, home.id]);
    } catch { /* made by a parallel request */ }
    [gs] = await pool.query(`SELECT * FROM profile_groups WHERE owner_profile_id = ? ORDER BY is_default DESC, created_at, name`, [home.id]);
  }
  const ids = gs.map((g) => g.id);
  const byGroup = new Map(ids.map((i) => [i, []]));
  if (ids.length) {
    const [ms] = await pool.query(`SELECT group_id, profile_id, status FROM profile_group_members WHERE group_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at, id`, ids);
    const pids = [...new Set(ms.map((m) => m.profile_id))];
    const pmap = new Map();
    if (pids.length) {
      const [ps] = await pool.query(`SELECT id, display_name, nickname, gender, photo_compressed_url, photo_url, is_claimed, owner_user_id FROM profiles WHERE id IN (${pids.map(() => '?').join(',')})`, pids);
      ps.forEach((p) => pmap.set(p.id, p));
    }
    ms.forEach((m) => { const p = pmap.get(m.profile_id); if (p) byGroup.get(m.group_id).push({ ...groupMemberOut(p), status: m.status === 'pending' ? 'pending' : 'accepted' }); });
  }
  return gs.map((g) => ({ id: g.id, name: g.name, kind: g.kind, is_default: g.is_default ? 1 : 0, visibility: g.visibility === 'family' ? 'family' : 'private', members: byGroup.get(g.id) }));
};

// a person made only for a group: no login, no family links, not in any other group -> remove the profile too
const dropOrphan = async (pid, home) => {
  const [pr] = await pool.query(`SELECT id, is_claimed, owner_user_id FROM profiles WHERE id = ? LIMIT 1`, [pid]);
  const P = pr[0];
  if (!P || P.is_claimed || P.owner_user_id !== home.owner_user_id) return;
  const [u] = await pool.query(`SELECT id FROM users WHERE id = ? LIMIT 1`, [pid]);
  const [g] = await pool.query(`SELECT id FROM profile_group_members WHERE profile_id = ? LIMIT 1`, [pid]);
  const [r] = await pool.query(`SELECT id FROM profile_relations WHERE owner_profile_id = ? OR related_profile_id = ? LIMIT 1`, [pid, pid]);
  const [c] = await pool.query(`SELECT id FROM profiles WHERE father_id = ? OR mother_id = ? LIMIT 1`, [pid, pid]);
  if (!u.length && !g.length && !r.length && !c.length) await pool.query(`DELETE FROM profiles WHERE id = ?`, [pid]);
};

app.get('/api/groups', async (req, res) => {
  try {
    const home = await groupHome(String(req.query.home_id || ''));
    if (!home) return res.status(404).json({ success: false, error: 'Profile not found' });
    res.json({ success: true, data: await loadGroups(home) });
  } catch (e) { console.error('groups error:', e); res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/groups', async (req, res) => {
  try {
    await groupsReady;
    const home = await groupHome(String((req.body || {}).home_id || ''));
    if (!home) return res.status(404).json({ success: false, error: 'Profile not found' });
    const name = String((req.body || {}).name || '').trim().replace(/\s+/g, ' ');
    const kind = GROUP_KINDS.includes((req.body || {}).kind) ? req.body.kind : 'custom';
    if (!name) return res.status(400).json({ success: false, error: 'Please type a group name' });
    if (name.length > 60) return res.status(400).json({ success: false, error: 'Group name is too long (60 letters at most)' });
    const [cnt] = await pool.query(`SELECT COUNT(*) AS n FROM profile_groups WHERE owner_profile_id = ?`, [home.id]);
    if (Number(cnt[0].n) >= 30) return res.status(400).json({ success: false, error: 'You can have up to 30 groups' });
    const [same] = await pool.query(`SELECT id FROM profile_groups WHERE owner_profile_id = ? AND LOWER(name) = LOWER(?) LIMIT 1`, [home.id, name]);
    if (same.length) return res.status(409).json({ success: false, error: 'You already have a group with that name' });
    try {
      await pool.query(`INSERT INTO profile_groups (id, owner_user_id, owner_profile_id, name, kind, is_default) VALUES (UUID(), ?, ?, ?, ?, 0)`, [home.owner_user_id || home.id, home.id, name, kind]);
    } catch { return res.status(409).json({ success: false, error: 'You already have a group with that name' }); }
    res.json({ success: true, data: await loadGroups(home) });
  } catch (e) { console.error('group create error:', e); res.status(500).json({ success: false, error: e.message }); }
});

// body: home_id, name  (the default My Friends group keeps its name)
app.post('/api/groups/:id/rename', async (req, res) => {
  try {
    await groupsReady;
    const home = await groupHome(String((req.body || {}).home_id || ''));
    if (!home) return res.status(404).json({ success: false, error: 'Profile not found' });
    const [g] = await pool.query(`SELECT * FROM profile_groups WHERE id = ? AND owner_profile_id = ? LIMIT 1`, [req.params.id, home.id]);
    if (!g.length) return res.status(404).json({ success: false, error: 'Group not found' });
    if (g[0].is_default) return res.status(400).json({ success: false, error: 'The My Friends group cannot be renamed' });
    const name = String((req.body || {}).name || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 60) return res.status(400).json({ success: false, error: 'Please type a group name (60 letters at most)' });
    const [same] = await pool.query(`SELECT id FROM profile_groups WHERE owner_profile_id = ? AND LOWER(name) = LOWER(?) AND id <> ? LIMIT 1`, [home.id, name, g[0].id]);
    if (same.length) return res.status(409).json({ success: false, error: 'You already have a group with that name' });
    try { await pool.query(`UPDATE profile_groups SET name = ? WHERE id = ?`, [name, g[0].id]); }
    catch { return res.status(409).json({ success: false, error: 'You already have a group with that name' }); }
    res.json({ success: true, data: await loadGroups(home) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// body: home_id  (members are only taken out of the group; people you made just for it are cleaned up)
app.post('/api/groups/:id/delete', async (req, res) => {
  try {
    await groupsReady;
    const home = await groupHome(String((req.body || {}).home_id || ''));
    if (!home) return res.status(404).json({ success: false, error: 'Profile not found' });
    const [g] = await pool.query(`SELECT * FROM profile_groups WHERE id = ? AND owner_profile_id = ? LIMIT 1`, [req.params.id, home.id]);
    if (!g.length) return res.status(404).json({ success: false, error: 'Group not found' });
    if (g[0].is_default) return res.status(400).json({ success: false, error: 'The My Friends group cannot be deleted' });
    const [ms] = await pool.query(`SELECT profile_id FROM profile_group_members WHERE group_id = ?`, [g[0].id]);
    await pool.query(`DELETE FROM profile_group_members WHERE group_id = ?`, [g[0].id]);
    await pool.query(`DELETE FROM profile_groups WHERE id = ?`, [g[0].id]);
    for (const m of ms) await dropOrphan(m.profile_id, home);
    res.json({ success: true, data: await loadGroups(home) });
  } catch (e) { console.error('group delete error:', e); res.status(500).json({ success: false, error: e.message }); }
});

// body: home_id + EITHER profile_id (someone already on ClanDeck) OR display_name (+ gender) to make a new person
app.post('/api/groups/:id/members', async (req, res) => {
  try {
    await groupsReady;
    const b = req.body || {};
    const home = await groupHome(String(b.home_id || ''));
    if (!home) return res.status(404).json({ success: false, error: 'Profile not found' });
    const [g] = await pool.query(`SELECT * FROM profile_groups WHERE id = ? AND owner_profile_id = ? LIMIT 1`, [req.params.id, home.id]);
    if (!g.length) return res.status(404).json({ success: false, error: 'Group not found' });
    const [cnt] = await pool.query(`SELECT COUNT(*) AS n FROM profile_group_members WHERE group_id = ?`, [g[0].id]);
    if (Number(cnt[0].n) >= 500) return res.status(400).json({ success: false, error: 'A group can have up to 500 members' });

    let pid, needsOk = false;
    if (b.profile_id) {
      const [pr] = await pool.query(`SELECT id, owner_user_id, is_claimed, visibility FROM profiles WHERE id = ? LIMIT 1`, [b.profile_id]);
      const P = pr[0];
      if (!P) return res.status(404).json({ success: false, error: 'Person not found' });
      if (P.id === home.id) return res.status(400).json({ success: false, error: 'That is you' });
      const mine = P.owner_user_id === home.owner_user_id;
      const open = P.is_claimed && String(P.visibility || 'public').toLowerCase() !== 'private';
      if (!mine && !open) return res.status(403).json({ success: false, error: 'That profile is private' });
      pid = P.id;
      needsOk = !!P.is_claimed;   // a person with their own account must accept
    } else {
      const name = String(b.display_name || '').trim().replace(/\s+/g, ' ');
      if (!name) return res.status(400).json({ success: false, error: 'Please type a name' });
      if (name.length > 80) return res.status(400).json({ success: false, error: 'That name is too long' });
      const gender = b.gender === 'Female' ? 'Female' : 'Male';
      const [[u]] = await pool.query('SELECT UUID() AS uuid');
      pid = u.uuid;
      await pool.query(
        `INSERT INTO profiles (id, owner_user_id, display_name, gender, show_in_deck, is_claimed, created_by_user_id, created_at) VALUES (?, ?, ?, ?, 1, 0, ?, NOW())`,
        [pid, home.owner_user_id, name, gender, home.owner_user_id]
      );
    }
    const [dup] = await pool.query(`SELECT id FROM profile_group_members WHERE group_id = ? AND profile_id = ? LIMIT 1`, [g[0].id, pid]);
    if (dup.length) return res.status(409).json({ success: false, error: 'Already in this group' });
    await pool.query(`INSERT INTO profile_group_members (id, group_id, profile_id, added_by, status) VALUES (UUID(), ?, ?, ?, ?)`, [g[0].id, pid, home.id, needsOk ? 'pending' : 'accepted']);
    if (needsOk) await notifyPerson(pid, home.id, 'group_add', { group_id: g[0].id });
    res.json({ success: true, added: pid, data: await loadGroups(home) });
  } catch (e) { console.error('group add member error:', e); res.status(500).json({ success: false, error: e.message }); }
});

// body: home_id, profile_id
app.post('/api/groups/:id/members/remove', async (req, res) => {
  try {
    await groupsReady;
    const b = req.body || {};
    const home = await groupHome(String(b.home_id || ''));
    if (!home) return res.status(404).json({ success: false, error: 'Profile not found' });
    const [g] = await pool.query(`SELECT id FROM profile_groups WHERE id = ? AND owner_profile_id = ? LIMIT 1`, [req.params.id, home.id]);
    if (!g.length) return res.status(404).json({ success: false, error: 'Group not found' });
    await pool.query(`DELETE FROM profile_group_members WHERE group_id = ? AND profile_id = ?`, [g[0].id, b.profile_id]);
    await pool.query(`DELETE FROM profile_notifications WHERE kind = 'group_add' AND status = 'pending' AND group_id = ? AND to_profile_id = ?`, [g[0].id, b.profile_id]);
    await dropOrphan(b.profile_id, home);
    res.json({ success: true, data: await loadGroups(home) });
  } catch (e) { console.error('group remove member error:', e); res.status(500).json({ success: false, error: e.message }); }
});

// body: home_id, visibility ('private' = only me, 'family' = relatives can find these people by searching)
app.post('/api/groups/:id/visibility', async (req, res) => {
  try {
    await groupsReady;
    const home = await groupHome(String((req.body || {}).home_id || ''));
    if (!home) return res.status(404).json({ success: false, error: 'Profile not found' });
    const v = (req.body || {}).visibility === 'family' ? 'family' : 'private';
    const [g] = await pool.query(`SELECT id FROM profile_groups WHERE id = ? AND owner_profile_id = ? LIMIT 1`, [req.params.id, home.id]);
    if (!g.length) return res.status(404).json({ success: false, error: 'Group not found' });
    await pool.query(`UPDATE profile_groups SET visibility = ? WHERE id = ?`, [v, g[0].id]);
    res.json({ success: true, data: await loadGroups(home) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ---------------------------------------------------------------------------------------------
// SEARCH from the header: finds people in your family and people in groups
//   (your own groups, plus groups your relatives chose to share with their family).
// Every result carries the path from YOU to that person, so Line view can draw it:
//   Me > Sister > (College friends) > Arun
// ---------------------------------------------------------------------------------------------
app.get('/api/search', async (req, res) => {
  try {
    await groupsReady;
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ success: true, data: [] });
    const home = await groupHome(String(req.query.home_id || ''));
    if (!home) return res.status(404).json({ success: false, error: 'Profile not found' });
    const like = `%${q.replace(/[%_\\]/g, '')}%`;

    const fam = await collectFamily(pool, [home.id]);
    fam.add(home.id);
    const famIds = [...fam];
    const ph = (a) => a.map(() => '?').join(',');

    // how everybody connects to me: through family relations, and then also through my friends (group members) and THEIR families,
    // so "Meenu's father" is found as  Me > Sanu (friend) > Meenu (wife) > her father
    const rowsOf = new Map();
    const loadRels = async (ids) => {
      const need = ids.filter((id) => !rowsOf.has(id));
      if (!need.length) return;
      need.forEach((id) => rowsOf.set(id, []));
      const [rs] = await pool.query(`SELECT owner_profile_id AS a, related_profile_id AS b, relation_type AS t FROM profile_relations WHERE owner_profile_id IN (${ph(need)})`, need);
      rs.forEach((r) => rowsOf.get(r.a).push({ id: r.b, t: r.t }));
    };
    await loadRels(famIds);
    const prev = new Map([[home.id, null]]);
    const outside = new Set();      // reached through a group (friend), not through my own family
    for (let queue = [home.id]; queue.length;) {
      const next = [];
      for (const cur of queue) for (const e of rowsOf.get(cur) || []) if (!prev.has(e.id)) { prev.set(e.id, { from: cur, t: e.t }); next.push(e.id); }
      queue = next;
    }
    // group members: my groups, and groups a relative shared with the family
    const [grs] = await pool.query(`SELECT id, name, owner_profile_id, visibility FROM profile_groups WHERE owner_profile_id IN (${ph(famIds)})`, famIds);
    const okGroups = grs.filter((g) => g.owner_profile_id === home.id || g.visibility === 'family');
    let seeds = [];
    if (okGroups.length) {
      const [gms] = await pool.query(`SELECT group_id, profile_id FROM profile_group_members WHERE COALESCE(status,'accepted') <> 'pending' AND group_id IN (${ph(okGroups)})`, okGroups.map((g) => g.id));
      const gm = new Map(okGroups.map((g) => [g.id, g]));
      gms.forEach((m) => { const g = gm.get(m.group_id); if (g && !prev.has(m.profile_id)) { prev.set(m.profile_id, { from: g.owner_profile_id, t: g.name, g: true }); outside.add(m.profile_id); seeds.push(m.profile_id); } });
    }
    // ... and on from each friend into THEIR family (a few steps, so it stays quick)
    for (let depth = 0; depth < 4 && seeds.length && prev.size < 800; depth++) {
      await loadRels(seeds);
      const next = [];
      for (const cur of seeds) for (const e of rowsOf.get(cur) || []) if (!prev.has(e.id)) { prev.set(e.id, { from: cur, t: e.t }); outside.add(e.id); next.push(e.id); }
      seeds = next;
    }
    const pathTo = (id) => { const out = []; for (let c = id; prev.get(c); c = prev.get(c).from) out.unshift({ id: c, rel: prev.get(c).t }); return out; };
    const groupEdgeOf = (id) => { let found = null; for (let c = id; prev.get(c); c = prev.get(c).from) if (prev.get(c).g) found = prev.get(c); return found; };

    // every profile whose name matches. Private profiles stay hidden (unless they are in my own family or my own group)
    const [named] = await pool.query(`SELECT id, is_claimed, visibility FROM profiles WHERE (display_name LIKE ? OR nickname LIKE ?) AND id <> ? LIMIT 300`, [like, like, home.id]);
    const hits = new Map();   // person id -> { kind, path:[{id,rel}], group?, owner? }
    named.forEach((p) => {
      const isPrivate = String(p.visibility || 'public').toLowerCase() === 'private';
      if (prev.has(p.id)) {
        if (!outside.has(p.id)) { hits.set(p.id, { kind: 'family', path: pathTo(p.id) }); return; }
        const edge = groupEdgeOf(p.id);
        const myOwnFriend = edge && prev.get(p.id).g && edge.from === home.id;
        if (isPrivate && !myOwnFriend) return;
        hits.set(p.id, { kind: 'group', path: pathTo(p.id), group: edge ? edge.t : '', owner: edge ? edge.from : null });
      } else if (!isPrivate) {
        hits.set(p.id, { kind: 'member', path: [{ id: p.id, rel: p.is_claimed ? 'Member' : 'Profile' }], claimed: p.is_claimed ? 1 : 0 });
      }
    });

    const rank = (k) => (k === 'family' ? 0 : k === 'group' ? 1 : 2);
    const list = [...hits.entries()].sort((a, b) => rank(a[1].kind) - rank(b[1].kind) || a[1].path.length - b[1].path.length || (b[1].claimed || 0) - (a[1].claimed || 0)).slice(0, 20);
    const need = [...new Set(list.flatMap(([, h]) => h.path.map((x) => x.id)))];
    const pmap = new Map();
    if (need.length) {
      const [ps] = await pool.query(`SELECT id, display_name, nickname, gender, photo_compressed_url, photo_url, is_claimed, owner_user_id FROM profiles WHERE id IN (${ph(need)})`, need);
      ps.forEach((p) => pmap.set(p.id, groupMemberOut(p)));
    }
    const data = list.filter(([id]) => pmap.has(id)).map(([id, h]) => ({
      kind: h.kind,
      group: h.group || null,
      owner: h.owner ? (h.owner === home.id ? null : (pmap.get(h.owner) || {}).display_name || null) : null,
      person: pmap.get(id),
      path: h.path.filter((x) => pmap.has(x.id)).map((x) => ({ p: pmap.get(x.id), rel: x.rel })),
    }));
    res.json({ success: true, data });
  } catch (e) { console.error('search error:', e); res.status(500).json({ success: false, error: e.message }); }
});

// ----- CHAT lives in routes/chat.js (moved out of this file; behaviour unchanged) -----
const { chatOpenDirect } = require('./routes/chat')(app, { pool, requireAuth, crypto, collectFamily, notifyPerson, groupMemberOut });

// ---------------------------------------------------------------------------------------------
// NOTIFICATIONS: "Sarath added you to the group Cousins / as his Sibling"  ->  Accept or Reject
// ---------------------------------------------------------------------------------------------
app.get('/api/notifications', async (req, res) => {
  try {
    await groupsReady;
    const home = await groupHome(String(req.query.home_id || ''));
    if (!home) return res.status(404).json({ success: false, error: 'Profile not found' });
    // default: what needs attention (waiting requests + unread notices); all=1: the whole Notification wall (history too)
    const all = String(req.query.all || '') === '1';
    const [ns] = await pool.query(`SELECT * FROM profile_notifications WHERE to_profile_id = ? ${all ? '' : `AND status IN ('pending','info')`} ORDER BY created_at DESC LIMIT ${all ? 100 : 50}`, [home.id]);
    const pids = [...new Set(ns.map((n) => n.from_profile_id).filter(Boolean))];
    const pmap = new Map();
    if (pids.length) { const [ps] = await pool.query(`SELECT id, display_name, nickname, gender, photo_compressed_url, photo_url, is_claimed, owner_user_id FROM profiles WHERE id IN (${pids.map(() => '?').join(',')})`, pids); ps.forEach((p) => pmap.set(p.id, groupMemberOut(p))); }
    const gids = [...new Set(ns.map((n) => n.group_id).filter(Boolean))];
    const gmap = new Map();
    if (gids.length) { const [gs] = await pool.query(`SELECT id, name FROM profile_groups WHERE id IN (${gids.map(() => '?').join(',')})`, gids); gs.forEach((g) => gmap.set(g.id, g.name)); }
    res.json({ success: true, data: ns.filter((n) => n.kind !== 'group_add' || gmap.has(n.group_id) || n.status !== 'pending').map((n) => ({ id: n.id, kind: n.kind, status: n.status, from: pmap.get(n.from_profile_id) || null, group_name: gmap.get(n.group_id) || null, relation_type: n.relation_type, message: n.message, created_at: n.created_at, responded_at: n.responded_at })) });
  } catch (e) { console.error('notifications error:', e); res.status(500).json({ success: false, error: e.message }); }
});

// body: home_id, action = 'accept' | 'reject' | 'dismiss'

// ----- POINTS and NEWS live in routes/ (moved out of this file; behaviour unchanged) -----
const { awardCard, takeBackCard } = require('./routes/points')(app, { pool, groupHome, requireAuth });
require('./routes/news')(app);

app.post('/api/notifications/:id/respond', async (req, res) => {
  try {
    await groupsReady;
    const b = req.body || {};
    const home = await groupHome(String(b.home_id || ''));
    if (!home) return res.status(404).json({ success: false, error: 'Profile not found' });
    const [nr] = await pool.query(`SELECT * FROM profile_notifications WHERE id = ? AND to_profile_id = ? LIMIT 1`, [req.params.id, home.id]);
    const n = nr[0];
    if (!n) return res.status(404).json({ success: false, error: 'Notification not found' });
    const action = String(b.action || '');
    if (n.kind === 'info') {
      if (action !== 'dismiss') return res.status(400).json({ success: false, error: 'Nothing to accept here' });
      await pool.query(`UPDATE profile_notifications SET status = 'read', responded_at = NOW() WHERE id = ?`, [n.id]);   // stays on the wall as history
      return res.json({ success: true });
    }
    if (n.status !== 'pending') return res.status(409).json({ success: false, error: 'Already answered' });
    if (action !== 'accept' && action !== 'reject') return res.status(400).json({ success: false, error: 'action must be accept or reject' });
    const accept = action === 'accept';
    let about = '';
    if (n.kind === 'group_add') {
      const [g] = await pool.query(`SELECT name FROM profile_groups WHERE id = ? LIMIT 1`, [n.group_id]);
      about = g[0] ? `the group "${g[0].name}"` : 'a group';
      if (accept) await pool.query(`UPDATE profile_group_members SET status = 'accepted' WHERE group_id = ? AND profile_id = ?`, [n.group_id, home.id]);
      else await pool.query(`DELETE FROM profile_group_members WHERE group_id = ? AND profile_id = ?`, [n.group_id, home.id]);
    } else if (n.kind === 'family_add') {
      about = `as their ${n.relation_type || 'relative'}`;
      if (accept && n.from_profile_id) { try { await awardCard(pool, n.from_profile_id, home.id, n.relation_type); } catch (e) { console.error('points award:', e.message); } }
    } else if (n.kind === 'chat_request') {
      if (accept && n.from_profile_id) await chatOpenDirect(n.from_profile_id, home.id);
    }
    await pool.query(`UPDATE profile_notifications SET status = ?, responded_at = NOW() WHERE id = ?`, [accept ? 'accepted' : 'rejected', n.id]);
    // tell the person who added them
    if (n.from_profile_id) {
      const hint = !accept && n.kind === 'family_add' ? ' You can remove the link from Profile Edit (Remove link).' : '';
      const text = n.kind === 'chat_request'
        ? `${home.display_name} ${accept ? 'accepted' : 'declined'} your chat request.`
        : `${home.display_name} ${accept ? 'accepted' : 'declined'} being added ${n.kind === 'group_add' ? 'to ' : ''}${about}.${hint}`;
      await notifyPerson(n.from_profile_id, home.id, 'info', { message: text });
    }
    res.json({ success: true, accepted: accept });
  } catch (e) { console.error('notification respond error:', e); res.status(500).json({ success: false, error: e.message }); }
});

// groups made by other people that I accepted: shown in my own profile (their members are visible to me)
app.get('/api/groups/joined', async (req, res) => {
  try {
    await groupsReady;
    const home = await groupHome(String(req.query.home_id || ''));
    if (!home) return res.status(404).json({ success: false, error: 'Profile not found' });
    const [gs] = await pool.query(`SELECT g.* FROM profile_groups g JOIN profile_group_members m ON m.group_id = g.id WHERE m.profile_id = ? AND COALESCE(m.status,'accepted') <> 'pending' AND g.owner_profile_id <> ? ORDER BY g.name`, [home.id, home.id]);
    const out = [];
    for (const g of gs) {
      const [ms] = await pool.query(`SELECT profile_id FROM profile_group_members WHERE group_id = ? AND COALESCE(status,'accepted') <> 'pending' ORDER BY created_at, id`, [g.id]);
      const ids = [...new Set([g.owner_profile_id, ...ms.map((m) => m.profile_id)])].filter((i) => i && i !== home.id);
      const pmap = new Map();
      if (ids.length) { const [ps] = await pool.query(`SELECT id, display_name, nickname, gender, photo_compressed_url, photo_url, is_claimed, owner_user_id, visibility FROM profiles WHERE id IN (${ids.map(() => '?').join(',')})`, ids); ps.forEach((p) => pmap.set(p.id, p)); }
      const vis = (p) => !(p.is_claimed && String(p.visibility || 'public').toLowerCase() === 'private');
      out.push({ id: g.id, name: g.name, kind: g.kind, owner: pmap.get(g.owner_profile_id) ? groupMemberOut(pmap.get(g.owner_profile_id)) : null,
        members: ms.map((m) => pmap.get(m.profile_id)).filter((p) => p && p.id !== g.owner_profile_id && vis(p)).map(groupMemberOut) });
    }
    res.json({ success: true, data: out });
  } catch (e) { console.error('joined groups error:', e); res.status(500).json({ success: false, error: e.message }); }
});

// ---------------------------------------------------------------------------------------------
// VIEW another member's profile (read-only, safe fields only: no email, phone or password).
// A private profile is shown only to people in that person's family.
// ---------------------------------------------------------------------------------------------
app.get('/api/profiles/public/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM profiles WHERE id = ? LIMIT 1`, [req.params.id]);
    const P = rows[0];
    if (!P) return res.status(404).json({ success: false, error: 'Profile not found' });
    if (String(P.visibility || 'public').toLowerCase() === 'private') {
      const viewer = await groupHome(String(req.query.home_id || '')).catch(() => null);
      const fam = viewer ? await collectFamily(pool, [viewer.id]) : new Set();
      if (!viewer || (viewer.id !== P.id && !fam.has(P.id))) return res.status(403).json({ success: false, error: 'This profile is private' });
    }
    let uname = '';
    if (P.is_claimed) { try { const [u] = await pool.query(`SELECT uname FROM users WHERE id = ? OR id = ? LIMIT 1`, [P.id, P.owner_user_id]); uname = (u[0] && u[0].uname) || ''; } catch { /* no users row */ } }
    res.json({ success: true, data: {
      id: P.id, display_name: P.display_name, nickname: P.nickname || '', gender: P.gender || '', uname,
      dob: P.dob || null, location: P.location || '', bio: P.bio || '', is_alive: P.is_alive === 0 || P.is_alive === '0' ? 0 : 1, dod: P.dod || null,
      photo_url: cleanPhoto(P), photo_x: P.photo_x ?? 50, photo_y: P.photo_y ?? 50, photo_zoom: P.photo_zoom ?? 100, is_claimed: P.is_claimed ? 1 : 0,
    } });
  } catch (e) { console.error('public profile error:', e); res.status(500).json({ success: false, error: e.message }); }
});

// ---------------------------------------------------------------------------------------------
// REMOVE a family member. Call with confirm:false for a preview (nothing changes), confirm:true to do it.
//   * only people YOU added (and who have not claimed their own account) are really deleted
//   * a person who claimed their own account is only UNLINKED from this family, never deleted
//   * people who would be cut off from your family (only reachable through the removed person) are
//     removed too, but only the ones you added, and only after you have seen the list
//   * a parent cannot be removed while that would leave their children (who have siblings) with no parent
// ---------------------------------------------------------------------------------------------
app.post('/api/profiles/family-remove', async (req, res) => {
  const conn = await pool.getConnection();
  const done = () => { try { conn.release(); } catch {} };
  try {
    const { owner_profile_id, profile_id, home_id, confirm } = req.body || {};
    if (!owner_profile_id || !profile_id || !home_id) { done(); return res.status(400).json({ success: false, error: 'owner_profile_id, profile_id and home_id are required' }); }
    await conn.beginTransaction();
    const bail = async (status, msg) => { await conn.rollback(); done(); return res.status(status).json({ success: false, error: msg }); };
    const resolveP = async (ref) => {
      const [r] = await conn.query(`SELECT * FROM profiles WHERE id = ? OR (owner_user_id = ? AND is_claimed = 1) ORDER BY (id = ?) DESC LIMIT 1`, [ref, ref, ref]);
      return r[0] || null;
    };
    const home = await resolveP(home_id);
    const owner = await resolveP(owner_profile_id);
    const [xr] = await conn.query(`SELECT * FROM profiles WHERE id = ? LIMIT 1`, [profile_id]);
    const X = xr[0];
    if (!home || !owner || !X) return bail(404, 'Person not found');
    if (X.id === home.id) return bail(400, 'You cannot remove yourself');
    if (X.id === owner.id) return bail(400, 'Choose a family member to remove');

    const famAll = await collectFamily(conn, [home.id]);
    if (!famAll.has(X.id)) return bail(403, 'That person is not part of your family');
    const reach = await collectFamily(conn, [home.id], X.id);            // who stays connected without X
    const orphans = [...famAll].filter((i) => i !== X.id && !reach.has(i));

    const profMap = new Map();
    const loadProfiles = async (list) => {
      if (!list.length) return;
      const ph = list.map(() => '?').join(',');
      const [rows] = await conn.query(`SELECT id, display_name, is_claimed, owner_user_id, father_id, mother_id FROM profiles WHERE id IN (${ph})`, list);
      rows.forEach((r) => profMap.set(r.id, r));
    };
    await loadProfiles([X.id, ...orphans]);
    const mineToDelete = (p) => p && !p.is_claimed && p.owner_user_id === home.owner_user_id;

    const unlinkOnly = !!X.is_claimed;
    if (!unlinkOnly && !mineToDelete(X)) return bail(403, 'You can only delete people you added yourself');
    if (unlinkOnly) {
      const [direct] = await conn.query(`SELECT id FROM profile_relations WHERE (owner_profile_id = ? AND related_profile_id = ?) OR (owner_profile_id = ? AND related_profile_id = ?) LIMIT 1`, [owner.id, X.id, X.id, owner.id]);
      if (!direct.length && owner.father_id !== X.id && owner.mother_id !== X.id && X.father_id !== owner.id && X.mother_id !== owner.id) return bail(400, 'That person is not directly linked here');
      // a claimed person is a real account with their own family, so shared children must be dealt with first
      const [shared] = await conn.query(`SELECT display_name FROM profiles WHERE (father_id = ? AND mother_id = ?) OR (father_id = ? AND mother_id = ?)`, [owner.id, X.id, X.id, owner.id]);
      if (shared.length) return bail(409, `${X.display_name} is the other parent of ${shared.map((k) => k.display_name).join(', ')}. Remove the children first.`);
    }

    // who really gets deleted
    const deleteIds = unlinkOnly ? [] : [X.id, ...orphans.filter((i) => mineToDelete(profMap.get(i)))];
    const gone = new Set(deleteIds);
    // who loses their links but stays (claimed accounts, or people somebody else added)
    const detached = unlinkOnly ? [X.id] : orphans.filter((i) => !gone.has(i));

    // rule: never leave brothers / sisters without any parent
    const staying = [...famAll].filter((i) => !gone.has(i));
    if (staying.length) {
      const ph = staying.map(() => '?').join(',');
      const [kids] = await conn.query(`SELECT id, display_name, father_id, mother_id FROM profiles WHERE id IN (${ph}) AND (father_id = ? OR mother_id = ?)`, [...staying, X.id, X.id]);
      const blockedNames = [];
      for (const k of kids) {
        const keepsFather = k.father_id && k.father_id !== X.id && !gone.has(k.father_id);
        const keepsMother = k.mother_id && k.mother_id !== X.id && !gone.has(k.mother_id);
        if (keepsFather || keepsMother) continue;
        const [sib] = await conn.query(`SELECT related_profile_id AS id FROM profile_relations WHERE owner_profile_id = ? AND relation_type = 'Sibling'`, [k.id]);
        if (sib.some((s) => !gone.has(s.id))) blockedNames.push(k.display_name);
      }
      if (blockedNames.length) return bail(409, `Remove the brothers and sisters first (${blockedNames.join(', ')}), because they would be left with no parent`);
    }

    const nameOf = (id) => (profMap.get(id) || {}).display_name || 'Unknown';
    const plan = {
      action: unlinkOnly ? 'unlink' : 'delete',
      person: { id: X.id, name: X.display_name },
      delete: deleteIds.map((i) => ({ id: i, name: nameOf(i) })),
      detach: detached.filter((i) => i !== X.id).map((i) => ({ id: i, name: nameOf(i) })),
    };
    if (!confirm) { await conn.rollback(); done(); return res.json({ success: true, preview: true, ...plan }); }

    if (unlinkOnly) {
      await conn.query(`DELETE FROM profile_relations WHERE (owner_profile_id = ? AND related_profile_id = ?) OR (owner_profile_id = ? AND related_profile_id = ?)`, [owner.id, X.id, X.id, owner.id]);
      await conn.query(`UPDATE profiles SET father_id = NULL WHERE id = ? AND father_id = ?`, [owner.id, X.id]);
      await conn.query(`UPDATE profiles SET mother_id = NULL WHERE id = ? AND mother_id = ?`, [owner.id, X.id]);
      await conn.query(`UPDATE profiles SET father_id = NULL WHERE id = ? AND father_id = ?`, [X.id, owner.id]);
      await conn.query(`UPDATE profiles SET mother_id = NULL WHERE id = ? AND mother_id = ?`, [X.id, owner.id]);
    } else {
      for (const id of deleteIds) {
        await conn.query(`DELETE FROM profile_relations WHERE owner_profile_id = ? OR related_profile_id = ?`, [id, id]);
        await conn.query(`UPDATE profiles SET father_id = NULL WHERE father_id = ?`, [id]);
        await conn.query(`UPDATE profiles SET mother_id = NULL WHERE mother_id = ?`, [id]);
        await conn.query(`DELETE FROM profiles WHERE id = ?`, [id]);
      }
    }
    await reconcileFamily(conn, [home.id, owner.id].filter((i) => !gone.has(i)));
    await conn.commit();
    done();
    try { await takeBackCard(pool, X.id); } catch (e) { console.error('points take-back:', e.message); }   // points drop automatically

    // photos of deleted people leave the bucket too (best effort, never blocks the answer)
    for (const id of deleteIds) {
      for (const f of ['compressed.jpg', 'original.jpg']) {
        try { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `${id}/profileimg/${f}` })); } catch { /* ignore */ }
      }
    }
    res.json({ success: true, removed: true, ...plan });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    console.error('family-remove error:', e);
    done();
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
});

// ---------------------------------------------------------------------------------------------
// INVITE: give a family member you added a TEMPORARY login, to share by WhatsApp / SMS.
//   * the login id is the same as the profile id, so they land straight on their own family tree
//   * the password is shown once and stored hashed; it works for TEMP_LOGIN_DAYS days
//   * asking again for the same person makes a fresh password (until they set their own)
// ---------------------------------------------------------------------------------------------
const makeTempPassword = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';          // no 0/o/1/l/i to avoid mistakes when typing
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
};

app.post('/api/profiles/invite', async (req, res) => {
  try {
    const { profile_id, home_id } = req.body || {};
    const mobile = String((req.body || {}).mobile || '').replace(/\D/g, '');
    if (!profile_id || !home_id) return res.status(400).json({ success: false, error: 'profile_id and home_id are required' });

    const [hr] = await pool.query(`SELECT * FROM profiles WHERE id = ? OR (owner_user_id = ? AND is_claimed = 1) ORDER BY (id = ?) DESC LIMIT 1`, [home_id, home_id, home_id]);
    const [pr] = await pool.query(`SELECT * FROM profiles WHERE id = ? LIMIT 1`, [profile_id]);
    if (!hr.length || !pr.length) return res.status(404).json({ success: false, error: 'Person not found' });
    const home = hr[0], P = pr[0];
    if (P.id === home.id) return res.status(400).json({ success: false, error: 'That is you' });

    const fam = await collectFamily(pool, [home.id]);
    let allowed = fam.has(P.id);
    if (!allowed) {   // a friend from one of my groups (no family link) can be given a login too
      try {
        const [gs] = await pool.query(`SELECT id FROM profile_groups WHERE owner_profile_id = ?`, [home.id]);
        if (gs.length) {
          const [m] = await pool.query(`SELECT id FROM profile_group_members WHERE profile_id = ? AND group_id IN (${gs.map(() => '?').join(',')}) LIMIT 1`, [P.id, ...gs.map((g) => g.id)]);
          allowed = m.length > 0;
        }
      } catch { /* group tables not set up yet */ }
    }
    if (!allowed) return res.status(403).json({ success: false, error: 'That person is not in your family or your groups' });

    const [ur] = await pool.query(`SELECT id, uname, is_temp, invited_by_user_id FROM users WHERE id = ? LIMIT 1`, [P.id]);
    const u = ur[0] || null;
    const mine = P.owner_user_id === home.owner_user_id || (u && u.invited_by_user_id === home.owner_user_id);
    if (!mine) return res.status(403).json({ success: false, error: 'You can only invite people you added yourself' });
    if (u && !u.is_temp) return res.status(409).json({ success: false, error: `${P.display_name} already has their own login` });
    if (P.is_claimed && !u) return res.status(409).json({ success: false, error: `${P.display_name} already has an account` });

    const password = makeTempPassword();
    let uname;
    if (u) {
      uname = u.uname;
      await pool.query(`UPDATE users SET password = ?, created_at = NOW(), status = 'active' WHERE id = ?`, [hashPassword(password), P.id]);
    } else {
      const base = (String(P.display_name || 'user').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().split(/\s+/)[0] || 'user').slice(0, 14);
      for (let i = 0; i < 20; i++) {
        const cand = `${base}.${crypto.randomInt(1000, 10000)}`;
        const [t] = await pool.query(`SELECT id FROM users WHERE LOWER(uname) = ? OR id = ? LIMIT 1`, [cand, cand]);
        if (!t.length) { uname = cand; break; }
      }
      if (!uname) return res.status(500).json({ success: false, error: 'Could not make a username, please try again' });
      // mobile / email are unique in the users table: only use them when nobody else has them
      const free = async (col, val) => {
        if (!val) return null;
        const [t] = await pool.query(`SELECT id FROM users WHERE ${col} = ? LIMIT 1`, [val]);
        return t.length ? null : val;
      };
      const mob = await free('mobile', mobile || P.mobile_number || null);
      const mail = await free('email', P.email || null);
      await pool.query(
        `INSERT INTO users (id, name, mobile, email, password, status, invited_by_user_id, created_at, uname, shared_profile_id, is_temp)
         VALUES (?, ?, ?, ?, ?, 'active', ?, NOW(), ?, ?, 1)`,
        [P.id, P.display_name, mob, mail, hashPassword(password), home.owner_user_id, uname, P.id]
      );
    }
    if (mobile && !P.mobile_number) await pool.query(`UPDATE profiles SET mobile_number = ? WHERE id = ? AND (mobile_number IS NULL OR mobile_number = '')`, [mobile, P.id]);
    res.json({ success: true, username: uname, password, valid_days: TEMP_LOGIN_DAYS, name: P.display_name, renewed: !!u });
  } catch (e) {
    console.error('invite error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// does this login still use a temporary password? (the pages show a "set your own" reminder)
app.get('/api/account/status/:id', async (req, res) => {
  try {
    const [r] = await pool.query(`SELECT is_temp FROM users WHERE id = ? LIMIT 1`, [req.params.id]);
    res.json({ success: true, is_temp: r.length && r[0].is_temp ? 1 : 0 });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// the invited person chooses their own username / password (needs the current one, like a login)
app.post('/api/account/set-credentials', async (req, res) => {
  try {
    const { user_id, current_password } = req.body || {};
    const newU = String((req.body || {}).new_uname || '').trim();
    const newP = String((req.body || {}).new_password || '');
    if (!user_id || !current_password) return res.status(400).json({ success: false, error: 'Current password required' });
    if (!newU && !newP) return res.status(400).json({ success: false, error: 'Enter a new username or password' });
    const [rows] = await pool.query(`SELECT id, uname, password, is_temp, status FROM users WHERE id = ? LIMIT 1`, [user_id]);
    const u = rows[0];
    if (!u || u.status !== 'active' || !checkPassword(String(current_password).trim(), u.password)) return res.status(401).json({ success: false, error: 'Current password is wrong' });
    if (newU) {
      if (!/^[a-zA-Z0-9._-]{3,30}$/.test(newU)) return res.status(400).json({ success: false, error: 'Username: 3-30 letters, numbers, . _ -' });
      const [t] = await pool.query(`SELECT id FROM users WHERE (LOWER(uname) = LOWER(?) OR id = ?) AND id <> ? LIMIT 1`, [newU, newU, u.id]);
      if (t.length) return res.status(409).json({ success: false, error: 'That username is taken, try another' });
    }
    if (newP) {
      if (newP.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
      if (newP === String(current_password).trim()) return res.status(400).json({ success: false, error: 'Choose a different password' });
    }
    await pool.query(`UPDATE users SET uname = ?, password = ?, is_temp = 0 WHERE id = ?`, [newU || u.uname, newP ? hashPassword(newP) : u.password, u.id]);
    res.json({ success: true, uname: newU || u.uname });
  } catch (e) {
    console.error('set-credentials error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/profiles/family-add', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { owner_profile_id, display_name, gender, relation_type, spouse_id, existing_profile_id } = req.body;
    const TYPES = ['Father', 'Mother', 'Spouse', 'Sibling', 'Child'];
    const fail = async (status, msg) => { await conn.rollback(); return res.status(status).json({ success: false, error: msg }); };

    if (!owner_profile_id || !TYPES.includes(relation_type) || (!existing_profile_id && !(display_name && String(display_name).trim()))) {
      return fail(400, 'Name and a valid relation are required');
    }
    const name = String(display_name || '').trim();

    // The person we are adding family TO (can be you, or any family member you added before)
    const [ownerRows] = await conn.query(
      `SELECT * FROM profiles WHERE id = ? OR (owner_user_id = ? AND is_claimed = 1) ORDER BY (id = ?) DESC LIMIT 1`,
      [owner_profile_id, owner_profile_id, owner_profile_id]
    );
    if (ownerRows.length === 0) throw new Error('Owner not found');
    const owner = ownerRows[0];
    const ownerId = owner.id;

    // linking a person who already exists (found by search) instead of creating a new one
    let existing = null;
    if (existing_profile_id) {
      const [er] = await conn.query(`SELECT * FROM profiles WHERE id = ? LIMIT 1`, [existing_profile_id]);
      if (!er.length) return fail(404, 'That person was not found');
      existing = er[0];
      if (existing.id === ownerId) return fail(400, 'A person cannot be linked to themselves');
      const [already] = await conn.query(`SELECT id FROM profile_relations WHERE (owner_profile_id = ? AND related_profile_id = ?) OR (owner_profile_id = ? AND related_profile_id = ?) LIMIT 1`, [ownerId, existing.id, existing.id, ownerId]);
      if (already.length || owner.father_id === existing.id || owner.mother_id === existing.id || existing.father_id === ownerId || existing.mother_id === ownerId) {
        return fail(409, `${existing.display_name} is already in this family`);
      }
    }
    const [[uuidRow]] = await conn.query('SELECT UUID() AS uuid');
    const newId = existing ? existing.id : uuidRow.uuid;

    const addProfile = (g, fatherId, motherId) => existing ? Promise.resolve() : conn.query(
      `INSERT INTO profiles (id, owner_user_id, display_name, gender, father_id, mother_id, show_in_deck, is_claimed, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, NOW())`,
      [newId, owner.owner_user_id, name, g, fatherId || null, motherId || null, owner.owner_user_id]
    );
    // profile_relations.id has no default value, so every row gets its own UUID()
    const addRel = async (a, b, type, o = {}) => {
      const [ex] = await conn.query(`SELECT id FROM profile_relations WHERE owner_profile_id = ? AND related_profile_id = ? AND relation_type = ? LIMIT 1`, [a, b, type]);
      if (ex.length) return;                                    // never create a duplicate link
      return conn.query(
        `INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group, spouse_number, birth_order, created_at)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, NOW())`,
        [a, b, type, o.spouse_group ?? null, o.spouse_number ?? null, o.birth_order ?? null]
      );
    };

    // ----- helpers for linking parents as spouses of each other -----
    const nextSpouseNo = async (pid) => {
      const [[r]] = await conn.query(`SELECT COALESCE(MAX(spouse_number), 0) AS n FROM profile_relations WHERE owner_profile_id = ? AND relation_type = 'Spouse'`, [pid]);
      return Number(r.n) + 1;
    };
    const spouseGroupOf = async (a, b) => {
      const [r] = await conn.query(`SELECT spouse_group FROM profile_relations WHERE owner_profile_id = ? AND related_profile_id = ? AND relation_type = 'Spouse' LIMIT 1`, [a, b]);
      return r.length ? r[0].spouse_group : null;
    };
    // Makes A and B spouses of each other (if they are not yet) and puts their shared children under that marriage
    const linkParents = async (aId, bId, childIds) => {
      let ga = await spouseGroupOf(aId, bId);
      let gb = await spouseGroupOf(bId, aId);
      if (ga === null || gb === null) {
        const nA = await nextSpouseNo(aId); const nB = await nextSpouseNo(bId);
        ga = String(nA); gb = String(nB);
        await addRel(aId, bId, 'Spouse', { spouse_group: ga, spouse_number: nA });
        await addRel(bId, aId, 'Spouse', { spouse_group: gb, spouse_number: nB });
      }
      for (const cid of childIds) {
        await conn.query(`UPDATE profile_relations SET spouse_group = ? WHERE owner_profile_id = ? AND related_profile_id = ? AND relation_type = 'Child' AND spouse_group IS NULL`, [ga, aId, cid]);
        await conn.query(`UPDATE profile_relations SET spouse_group = ? WHERE owner_profile_id = ? AND related_profile_id = ? AND relation_type = 'Child' AND spouse_group IS NULL`, [gb, bId, cid]);
      }
    };

    if (relation_type === 'Father' || relation_type === 'Mother') {
      const isFather = relation_type === 'Father';
      const col = isFather ? 'father_id' : 'mother_id';
      const otherParentId = isFather ? owner.mother_id : owner.father_id;
      if (owner[col]) return fail(409, `${relation_type} is already added`);
      if (existing) {
        const want = isFather ? 'Male' : 'Female';
        if (existing.gender && existing.gender !== want) return fail(400, `${existing.display_name} is ${existing.gender}, so cannot be added as ${relation_type}`);
        if ((await ancestorsOf(conn, existing.id)).has(ownerId)) return fail(400, `${existing.display_name} is your descendant, so cannot be your ${relation_type}`);
        if (!existing.gender) await conn.query(`UPDATE profiles SET gender = ? WHERE id = ?`, [want, existing.id]);
      }
      await addProfile(isFather ? 'Male' : 'Female', null, null); // gender is fixed by the relation
      await conn.query(`UPDATE profiles SET ${col} = ? WHERE id = ?`, [newId, ownerId]);
      await addRel(ownerId, newId, relation_type);
      await addRel(newId, ownerId, 'Child');
      // existing siblings share this new parent too
      const [sibs] = await conn.query(`SELECT related_profile_id AS id FROM profile_relations WHERE owner_profile_id = ? AND relation_type = 'Sibling'`, [ownerId]);
      for (const sb of sibs) {
        await conn.query(`UPDATE profiles SET ${col} = ? WHERE id = ? AND ${col} IS NULL`, [newId, sb.id]);
        await addRel(sb.id, newId, relation_type);
        await addRel(newId, sb.id, 'Child');
      }
      // when both parents exist they become spouses of each other, so each parent's own page shows the children under the spouse
      if (otherParentId) await linkParents(newId, otherParentId, [ownerId, ...sibs.map(sb => sb.id)]);

    } else if (relation_type === 'Spouse') {
      const n = await nextSpouseNo(ownerId);
      await addProfile(gender || (owner.gender === 'Female' ? 'Male' : 'Female'), null, null);
      await addRel(ownerId, newId, 'Spouse', { spouse_group: String(n), spouse_number: n });
      await addRel(newId, ownerId, 'Spouse', { spouse_group: '1', spouse_number: 1 }); // for the new spouse, the owner is the first

    } else if (relation_type === 'Child') {
      const [mySpouses] = await conn.query(
        `SELECT related_profile_id AS id, spouse_group FROM profile_relations WHERE owner_profile_id = ? AND relation_type = 'Spouse' ORDER BY CAST(spouse_group AS UNSIGNED)`,
        [ownerId]
      );
      if (mySpouses.length === 0) return fail(400, 'Add a spouse first, then add children');
      // the spouse is chosen by the person; with only one spouse it is picked automatically
      const chosen = spouse_id ? mySpouses.find(sp => sp.id === spouse_id) : (mySpouses.length === 1 ? mySpouses[0] : null);
      if (!chosen) return fail(400, spouse_id ? 'Please choose one of the spouses' : 'Please select the spouse this child belongs to');
      const spouseId = chosen.id;
      const ownerIsFemale = owner.gender === 'Female';
      const fatherId = ownerIsFemale ? spouseId : ownerId;
      const motherId = ownerIsFemale ? ownerId : spouseId;
      const [olderKids] = await conn.query(
        `SELECT related_profile_id AS id FROM profile_relations WHERE owner_profile_id = ? AND relation_type = 'Child' AND spouse_group = ?`,
        [ownerId, chosen.spouse_group]
      );
      const order = olderKids.length + 1;
      if (existing) {
        if ((existing.father_id && existing.father_id !== fatherId) || (existing.mother_id && existing.mother_id !== motherId)) {
          return fail(409, `${existing.display_name} already has other parents`);
        }
        if ((await ancestorsOf(conn, ownerId)).has(existing.id)) return fail(400, `${existing.display_name} is your ancestor, so cannot be your child`);
        await conn.query(`UPDATE profiles SET father_id = ?, mother_id = ? WHERE id = ?`, [fatherId, motherId, existing.id]);
      }
      await addProfile(gender || 'Male', fatherId, motherId);
      await addRel(ownerId, newId, 'Child', { spouse_group: chosen.spouse_group, birth_order: order });
      const spouseSideGroup = await spouseGroupOf(spouseId, ownerId);
      await addRel(spouseId, newId, 'Child', { spouse_group: spouseSideGroup ?? '1', birth_order: order });
      await addRel(newId, fatherId, 'Father');
      await addRel(newId, motherId, 'Mother');
      // the new child and the earlier children of this couple are siblings
      for (const k of olderKids) {
        await addRel(newId, k.id, 'Sibling', { birth_order: order });
        await addRel(k.id, newId, 'Sibling');
      }

    } else if (relation_type === 'Sibling') {
      if (!owner.father_id && !owner.mother_id) return fail(400, 'Add a parent first, then add siblings');
      const [[cnt]] = await conn.query(`SELECT COUNT(*) AS c FROM profile_relations WHERE owner_profile_id = ? AND relation_type = 'Sibling'`, [ownerId]);
      const order = Number(cnt.c) + 1;
      if (existing) {
        if ((existing.father_id && owner.father_id && existing.father_id !== owner.father_id) || (existing.mother_id && owner.mother_id && existing.mother_id !== owner.mother_id)) {
          return fail(409, `${existing.display_name} has different parents, so cannot be added as a sibling`);
        }
        const anc = await ancestorsOf(conn, ownerId);
        if (anc.has(existing.id)) return fail(400, `${existing.display_name} is your ancestor, so cannot be your sibling`);
        await conn.query(`UPDATE profiles SET father_id = COALESCE(father_id, ?), mother_id = COALESCE(mother_id, ?) WHERE id = ?`, [owner.father_id || null, owner.mother_id || null, existing.id]);
      }
      await addProfile(gender || 'Male', owner.father_id, owner.mother_id);
      await addRel(ownerId, newId, 'Sibling', { birth_order: order });
      await addRel(newId, ownerId, 'Sibling');
      let fatherGroup = null, motherGroup = null;
      if (owner.father_id && owner.mother_id) {
        fatherGroup = await spouseGroupOf(owner.father_id, owner.mother_id);
        motherGroup = await spouseGroupOf(owner.mother_id, owner.father_id);
      }
      if (owner.father_id) { await addRel(owner.father_id, newId, 'Child', { spouse_group: fatherGroup }); await addRel(newId, owner.father_id, 'Father'); }
      if (owner.mother_id) { await addRel(owner.mother_id, newId, 'Child', { spouse_group: motherGroup }); await addRel(newId, owner.mother_id, 'Mother'); }
      const [sibs] = await conn.query(`SELECT related_profile_id AS id FROM profile_relations WHERE owner_profile_id = ? AND relation_type = 'Sibling' AND related_profile_id <> ?`, [ownerId, newId]);
      for (const sb of sibs) {
        await addRel(sb.id, newId, 'Sibling');
        await addRel(newId, sb.id, 'Sibling');
      }
    }

    // make sure every parent / sibling / spouse link is mirrored on the other people too
    await reconcileFamily(conn, [ownerId, newId]);

    await conn.commit();
    if (existing && existing.is_claimed) {
      try {
        const actor = req.body.home_id ? await groupHome(String(req.body.home_id)) : null;
        const fromId = (actor && actor.id) || ownerId;
        if (fromId !== existing.id) await notifyPerson(existing.id, fromId, 'family_add', { relation_type, message: ownerId !== fromId ? owner.display_name : null });
      } catch (e) { console.error('family notify:', e.message); }
    }
    const [newProfileRows] = await pool.query(`SELECT * FROM profiles WHERE id = ?`, [newId]);
    res.json({ success: true, data: newProfileRows[0] });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    console.error('family-add error:', e);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  } finally { conn.release(); }
});

// (the old open DELETE /api/profiles/:id route was removed: it let anyone delete any profile. Use /api/profiles/family-remove)

app.get('/api/family', async (req, res) => {
  try {
    const { user_id } = req.query;
    const [rows] = await pool.query(`SELECT * FROM profiles WHERE owner_user_id = ? OR id = ?`, [user_id, user_id]);
    res.json({ success: true, data: rows });
  } catch (e) { res.json({ success: true, data: [] }); }
});

// ===== ADMIN AUTH: key is REQUIRED, comes only from the environment, header only =====
const ADMIN_KEY = process.env.ADMIN_KEY;
const adminAuth = (req, res, next) => {
  const key = req.headers['x-admin-key'];
  if (!ADMIN_KEY || !key || key !== ADMIN_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
};

app.get('/api/admin/all-tables', adminAuth, async (req, res) => {
  try {
    const [tablesRaw] = await pool.query('SHOW TABLES');
    const tableNames = tablesRaw.map(t => Object.values(t)[0]);
    const result = {};
    for (const tName of tableNames) {
      try {
        const [countRes] = await pool.query(`SELECT COUNT(*) as count FROM \`${tName}\``);
        const [colsDetail] = await pool.query(`SHOW COLUMNS FROM \`${tName}\``);
        const [rows] = await pool.query(`SELECT * FROM \`${tName}\` ORDER BY id DESC LIMIT 50`);
        result[tName] = { totalCount: countRes[0].count, columns: colsDetail.map(c => c.Field), columnsDetail: colsDetail, rows: rows };
      } catch (e) {
        result[tName] = { totalCount: 0, columns: [], columnsDetail: [], rows: [] };
      }
    }
    res.json(result);
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const [usersCount] = await pool.query('SELECT COUNT(*) as count FROM users');
    const [latestUsers] = await pool.query('SELECT id, uname, name, email, mobile, status, created_at FROM users ORDER BY id DESC LIMIT 20');
    const [tables] = await pool.query('SHOW TABLES');
    res.json({ success: true, counts: { users: usersCount[0].count }, latestUsers, tables: tables.map(t => Object.values(t)[0]) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Users list for the Admin page ("User details"): who they are and how they log in.
// Passwords saved hashed (scrypt) can NOT be turned back into text, so they are reported as hashed.
// Only old plain-text passwords are shown, and only to someone who holds the admin key.
app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, uname, name, email, mobile, status, is_temp, password, created_at FROM users ORDER BY created_at DESC, id DESC LIMIT 2000');
    const data = rows.map((u) => {
      const pw = u.password == null ? '' : String(u.password);
      const kind = !pw ? 'none' : pw.startsWith('scrypt$') ? 'hashed' : 'plain';
      return { id: u.id, uname: u.uname || '', name: u.name || '', email: u.email || '', mobile: u.mobile || '', status: u.status || '', is_temp: u.is_temp ? 1 : 0, created_at: u.created_at, password_kind: kind, password: kind === 'plain' ? pw : '' };
    });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Admin: give a user a NEW temporary password (the old one cannot be read, only replaced).
// The new password is shown once to the admin, stored hashed, and the person is asked to choose their own at next login.
app.post('/api/admin/users/:id/reset-password', adminAuth, async (req, res) => {
  try {
    const [u] = await pool.query('SELECT id, uname, name FROM users WHERE id = ? LIMIT 1', [String(req.params.id)]);
    if (!u.length) return res.status(404).json({ success: false, message: 'User not found' });
    const password = makeTempPassword();
    await pool.query(`UPDATE users SET password = ?, is_temp = 1, created_at = NOW(), status = 'active' WHERE id = ?`, [hashPassword(password), u[0].id]);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, username: u[0].uname || '', name: u[0].name || '', password, valid_days: TEMP_LOGIN_DAYS });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

function getTree(dir, depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return [];
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    return items.filter(f => {
      if (['node_modules', '.git', 'dist', 'build', '.next', 'uploads', '.vercel', '.railway'].includes(f.name)) return false;
      if (f.name.startsWith('.')) return false;
      if (['bin', 'boot', 'dev', 'etc', 'lib', 'lib64', 'proc', 'sbin', 'sys', 'usr', 'var', 'tmp', 'run'].includes(f.name) && depth === 0 && dir === '/') return false;
      return true;
    }).map(f => {
      const full = path.join(dir, f.name);
      try {
        if (f.isDirectory()) {
          return { name: f.name, type: 'folder', path: full, children: getTree(full, depth + 1, maxDepth) };
        } else {
          const stat = fs.statSync(full);
          return { name: f.name, type: 'file', path: full, size: `${(stat.size / 1024).toFixed(1)} KB` };
        }
      } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

app.get('/api/admin/file-structure', adminAuth, (req, res) => {
  try {
    const deployedRoot = __dirname;
    const tree = { name: 'clandeck-project (Deployed)', type: 'folder', source: 'deployed', rootPath: deployedRoot, path: deployedRoot, children: getTree(deployedRoot, 0, 4) };
    res.json(tree);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/local-file-structure', adminAuth, (req, res) => {
  try {
    const possibleRoot = path.join(__dirname, '..');
    const hasPkg = fs.existsSync(path.join(possibleRoot, 'package.json')) || fs.existsSync(path.join(possibleRoot, 'frontend', 'package.json')) || fs.existsSync(path.join(__dirname, 'package.json'));
    const localRoot = hasPkg ? possibleRoot : __dirname;
    const tree = { name: 'clandeck-project (Local)', type: 'folder', source: 'local', rootPath: localRoot, path: localRoot, children: getTree(localRoot, 0, 6) };
    res.json(tree);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', handleLogin);
app.post('/api/auth/login', handleLogin);

// (removed: public /api/test-users route - it exposed user data)

// ===== PROFILE APIS - SAME ID + EMAIL FIELD =====
app.get('/api/profile/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const [rows] = await pool.query(
      `SELECT p.*, u.email as user_email, u.mobile as user_mobile, u.name as user_name, u.photo_url as user_photo 
       FROM profiles p 
       LEFT JOIN users u ON u.id = p.id 
       WHERE p.id = ? OR (p.owner_user_id = ? AND p.is_claimed = 1)
       ORDER BY (p.id = ?) DESC
       LIMIT 1`,
      [id, id, id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Profile not found' });
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    console.error('GET profile error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/profile/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = req.params.id;
    const { display_name, name, nickname, gender, dob, email, mobile_number, mobile, visibility, show_in_deck, is_alive, dod, location, bio, photo_url,
      photo_original_url, photo_compressed_url, photo_bucket_key, photo_x, photo_y, photo_zoom } = req.body;
    const finalName = display_name || name;
    const finalMobile = mobile || mobile_number;
    const finalEmail = email;
    await conn.query(`UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), mobile = COALESCE(?, mobile), photo_url = COALESCE(?, photo_url) WHERE id = ?`, [finalName, finalEmail, finalMobile, photo_url, id]);
    await conn.query(
      `UPDATE profiles SET 
        display_name = COALESCE(?, display_name),
        nickname = COALESCE(?, nickname),
        gender = COALESCE(?, gender),
        dob = ?,
        mobile_number = COALESCE(?, mobile_number),
        email = COALESCE(?, email),
        visibility = COALESCE(?, visibility),
        show_in_deck = COALESCE(?, show_in_deck),
        is_alive = COALESCE(?, is_alive),
        dod = ?,
        location = COALESCE(?, location),
        bio = COALESCE(?, bio),
        photo_url = COALESCE(?, photo_url),
        updated_at = NOW()
       WHERE id = ? OR (owner_user_id = ? AND is_claimed = 1)`,
      [finalName, nickname, gender, dob || null, finalMobile, finalEmail, visibility, show_in_deck, is_alive, dod || null, location, bio, photo_url, id, id]
    );
    // Photo position fields: saved only if these columns exist in the profiles table
    const photoExtras = { photo_original_url, photo_compressed_url, photo_bucket_key, photo_x, photo_y, photo_zoom };
    const [profileCols] = await conn.query('SHOW COLUMNS FROM profiles');
    const existingCols = new Set(profileCols.map(c => c.Field));
    for (const [col, val] of Object.entries(photoExtras)) {
      if (val === undefined || val === null || !existingCols.has(col)) continue;
      await conn.query(`UPDATE profiles SET \`${col}\` = ? WHERE id = ? OR (owner_user_id = ? AND is_claimed = 1)`, [val, id, id]);
    }
    await conn.commit();
    const [updated] = await pool.query(`SELECT p.*, u.email as user_email, u.mobile as user_mobile FROM profiles p LEFT JOIN users u ON u.id = p.id WHERE p.id = ? LIMIT 1`, [id]);
    res.json({ success: true, message: 'Saved to both tables + photo', data: updated[0] });
  } catch (e) {
    await conn.rollback();
    console.error('PUT profile error:', e);
    res.status(500).json({ success: false, error: e.message });
  } finally {
    conn.release();
  }
});

// ===== PROFILE PHOTOS IN THE RAILWAY BUCKET =====
// Layout inside the bucket:  <userId>/profileimg/compressed.jpg  and  <userId>/profileimg/original.jpg
// Uploading again writes to the SAME file names, so the old image is replaced (no duplicates).
// (A bucket has no real folders: "<userId>/profileimg/" is a key prefix, created automatically on first upload.)
const s3 = new S3Client({
  region: process.env.REGION || 'auto',
  endpoint: process.env.ENDPOINT,
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID || '',
    secretAccessKey: process.env.SECRET_ACCESS_KEY || ''
  }
});
const BUCKET = process.env.RAILWAY_BUCKET_NAME;
const PUBLIC_API_URL = process.env.PUBLIC_API_URL || 'https://api.clandeck.com';
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const jpegDataUrlToBuffer = (dataUrl) => {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  return buf.length > 0 && buf.length <= MAX_IMAGE_BYTES ? buf : null;
};

app.post('/api/profile/:id/photo', async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!SAFE_ID.test(id)) return res.status(400).json({ success: false, error: 'Invalid id' });

    // The id can be a user (your own profile) or a family member's profile
    const [u] = await pool.query('SELECT id FROM users WHERE id = ? UNION SELECT id FROM profiles WHERE id = ? LIMIT 1', [id, id]);
    if (u.length === 0) return res.status(404).json({ success: false, error: 'Profile not found' });

    const { compressed, original } = req.body;
    const compressedBuf = jpegDataUrlToBuffer(compressed);
    if (!compressedBuf) return res.status(400).json({ success: false, error: 'Invalid or too large compressed image' });
    let originalBuf = null;
    if (original) {
      originalBuf = jpegDataUrlToBuffer(original);
      if (!originalBuf) return res.status(400).json({ success: false, error: 'Invalid or too large original image' });
    }

    if (req.body.kind === 'cover') {                       // top banner picture: one file, replaced on every upload
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${id}/cover/cover.jpg`, Body: compressedBuf, ContentType: 'image/jpeg' }));
      return res.json({ success: true, cover_url: `${PUBLIC_API_URL}/api/photos/${id}/cover.jpg?v=${Date.now()}` });
    }
    const prefix = `${id}/profileimg`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${prefix}/compressed.jpg`, Body: compressedBuf, ContentType: 'image/jpeg' }));
    if (originalBuf) {
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${prefix}/original.jpg`, Body: originalBuf, ContentType: 'image/jpeg' }));
    }

    const v = Date.now(); // changes the URL so browsers show the new image right away
    res.json({
      success: true,
      compressed_url: `${PUBLIC_API_URL}/api/photos/${id}/compressed.jpg?v=${v}`,
      original_url: originalBuf ? `${PUBLIC_API_URL}/api/photos/${id}/original.jpg?v=${v}` : null,
      bucket_key: prefix
    });
  } catch (e) {
    console.error('Photo upload error:', e);
    res.status(500).json({ success: false, error: 'Photo upload failed' });
  }
});

app.get('/api/photos/:id/:file', async (req, res) => {
  const { id, file } = req.params;
  if (!SAFE_ID.test(id) || !['compressed.jpg', 'original.jpg', 'cover.jpg'].includes(file)) return res.status(404).end();
  try {
    const key = file === 'cover.jpg' ? `${id}/cover/cover.jpg` : `${id}/profileimg/${file}`;
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': file === 'cover.jpg' ? 'public, max-age=300' : 'public, max-age=31536000, immutable' });
    // Plain <img> requests carry no Origin header, so the cors middleware adds nothing; allow reading the picture
    // on a canvas later (re-cropping) without a stale cached copy blocking it.
    if (!res.get('Access-Control-Allow-Origin')) res.set('Access-Control-Allow-Origin', '*');
    out.Body.pipe(res);
  } catch (e) {
    res.status(404).end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Clandeck API v3 - Running on ${PORT}`));