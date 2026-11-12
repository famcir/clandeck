require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

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

const handleLogin = async (req, res) => {
  let { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, msg: 'Username and password required' });
  username = String(username).trim(); password = String(password).trim();
  try {
    const [rows] = await pool.query(
      `SELECT id, name, mobile, email, photo_url, status, uname, password 
       FROM users 
       WHERE (id = ? OR uname = ? OR LOWER(uname) = LOWER(?) OR CAST(id AS CHAR) = ?) 
       AND password = ? AND status = 'active' LIMIT 1`,
      [username, username, username, username, password]
    );
    if (rows.length === 0) return res.status(401).json({ success: false, msg: 'Invalid username or password' });
    const user = rows[0];
    try {
      const [pExist] = await pool.query(`SELECT id FROM profiles WHERE owner_user_id = ? OR id = ? LIMIT 1`, [user.id, user.id]);
      if (pExist.length === 0) {
        await pool.query(`INSERT INTO profiles (id, owner_user_id, display_name, gender, show_in_deck, is_claimed, created_at) VALUES (?, ?, ?, 'Male', 1, 1, NOW())`, [user.id, user.id, user.name]);
      } else {
        await pool.query(`UPDATE profiles SET display_name = ? WHERE (owner_user_id = ? OR id = ?) AND (display_name='Hidden' OR display_name='' OR display_name IS NULL)`, [user.name, user.id, user.id]);
      }
    } catch (e) { console.log('auto-create profile skipped:', e.message); }
    const userData = { id: user.id, name: user.name, uname: user.uname, username: user.uname || user.id, mobile: user.mobile, email: user.email, photo_url: user.photo_url, status: user.status };
    res.json({ success: true, msg: `Welcome, ${user.name}!`, user: userData, id: userData.id, name: userData.name, uname: userData.uname, photo_url: userData.photo_url });
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
    const [myRows] = await pool.query(`SELECT * FROM profiles WHERE id = ? OR (owner_user_id = ? AND is_claimed = 1) ORDER BY (id = ?) DESC LIMIT 1`, [user_id, user_id, user_id]);
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

app.post('/api/profiles/family-add', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { owner_profile_id, display_name, gender, relation_type, spouse_id } = req.body;
    const TYPES = ['Father', 'Mother', 'Spouse', 'Sibling', 'Child'];
    const fail = async (status, msg) => { await conn.rollback(); return res.status(status).json({ success: false, error: msg }); };

    if (!owner_profile_id || !display_name || !String(display_name).trim() || !TYPES.includes(relation_type)) {
      return fail(400, 'Name and a valid relation are required');
    }
    const name = String(display_name).trim();

    // The person we are adding family TO (can be you, or any family member you added before)
    const [ownerRows] = await conn.query(
      `SELECT * FROM profiles WHERE id = ? OR (owner_user_id = ? AND is_claimed = 1) ORDER BY (id = ?) DESC LIMIT 1`,
      [owner_profile_id, owner_profile_id, owner_profile_id]
    );
    if (ownerRows.length === 0) throw new Error('Owner not found');
    const owner = ownerRows[0];
    const ownerId = owner.id;

    const [[uuidRow]] = await conn.query('SELECT UUID() AS uuid');
    const newId = uuidRow.uuid;

    const addProfile = (g, fatherId, motherId) => conn.query(
      `INSERT INTO profiles (id, owner_user_id, display_name, gender, father_id, mother_id, show_in_deck, is_claimed, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, NOW())`,
      [newId, owner.owner_user_id, name, g, fatherId || null, motherId || null, owner.owner_user_id]
    );
    // profile_relations.id has no default value, so every row gets its own UUID()
    const addRel = (a, b, type, o = {}) => conn.query(
      `INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group, spouse_number, birth_order, created_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, NOW())`,
      [a, b, type, o.spouse_group ?? null, o.spouse_number ?? null, o.birth_order ?? null]
    );

    if (relation_type === 'Father' || relation_type === 'Mother') {
      const isFather = relation_type === 'Father';
      const col = isFather ? 'father_id' : 'mother_id';
      if (owner[col]) return fail(409, `${relation_type} is already added`);
      await addProfile(gender || (isFather ? 'Male' : 'Female'), null, null);
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

    } else if (relation_type === 'Spouse') {
      const [[mx]] = await conn.query(`SELECT COALESCE(MAX(spouse_number), 0) AS n FROM profile_relations WHERE owner_profile_id = ? AND relation_type = 'Spouse'`, [ownerId]);
      const n = Number(mx.n) + 1;
      await addProfile(gender || (owner.gender === 'Female' ? 'Male' : 'Female'), null, null);
      await addRel(ownerId, newId, 'Spouse', { spouse_group: String(n), spouse_number: n });
      await addRel(newId, ownerId, 'Spouse', { spouse_group: '1', spouse_number: 1 }); // for the new spouse, you are their first

    } else if (relation_type === 'Child') {
      if (!spouse_id) return fail(400, 'Add a spouse first, then add children');
      const [rel] = await conn.query(
        `SELECT spouse_group FROM profile_relations WHERE owner_profile_id = ? AND related_profile_id = ? AND relation_type = 'Spouse' LIMIT 1`,
        [ownerId, spouse_id]
      );
      if (rel.length === 0) return fail(400, 'Please choose one of the spouses');
      const ownerIsFemale = owner.gender === 'Female';
      const fatherId = ownerIsFemale ? spouse_id : ownerId;
      const motherId = ownerIsFemale ? ownerId : spouse_id;
      const [[cnt]] = await conn.query(
        `SELECT COUNT(*) AS c FROM profile_relations WHERE owner_profile_id = ? AND relation_type = 'Child' AND spouse_group = ?`,
        [ownerId, rel[0].spouse_group]
      );
      const order = Number(cnt.c) + 1;
      await addProfile(gender || 'Male', fatherId, motherId);
      await addRel(ownerId, newId, 'Child', { spouse_group: rel[0].spouse_group, birth_order: order });
      const [srel] = await conn.query(
        `SELECT spouse_group FROM profile_relations WHERE owner_profile_id = ? AND related_profile_id = ? AND relation_type = 'Spouse' LIMIT 1`,
        [spouse_id, ownerId]
      );
      await addRel(spouse_id, newId, 'Child', { spouse_group: srel[0]?.spouse_group ?? '1', birth_order: order });
      await addRel(newId, fatherId, 'Father');
      await addRel(newId, motherId, 'Mother');

    } else if (relation_type === 'Sibling') {
      if (!owner.father_id && !owner.mother_id) return fail(400, 'Add a parent first, then add siblings');
      const [[cnt]] = await conn.query(`SELECT COUNT(*) AS c FROM profile_relations WHERE owner_profile_id = ? AND relation_type = 'Sibling'`, [ownerId]);
      const order = Number(cnt.c) + 1;
      await addProfile(gender || 'Male', owner.father_id, owner.mother_id);
      await addRel(ownerId, newId, 'Sibling', { birth_order: order });
      await addRel(newId, ownerId, 'Sibling');
      if (owner.father_id) { await addRel(owner.father_id, newId, 'Child'); await addRel(newId, owner.father_id, 'Father'); }
      if (owner.mother_id) { await addRel(owner.mother_id, newId, 'Child'); await addRel(newId, owner.mother_id, 'Mother'); }
      const [sibs] = await conn.query(`SELECT related_profile_id AS id FROM profile_relations WHERE owner_profile_id = ? AND relation_type = 'Sibling' AND related_profile_id <> ?`, [ownerId, newId]);
      for (const sb of sibs) {
        await addRel(sb.id, newId, 'Sibling');
        await addRel(newId, sb.id, 'Sibling');
      }
    }

    await conn.commit();
    const [newProfileRows] = await pool.query(`SELECT * FROM profiles WHERE id = ?`, [newId]);
    res.json({ success: true, data: newProfileRows[0] });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    console.error('family-add error:', e);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  } finally { conn.release(); }
});

app.delete('/api/profiles/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await pool.query(`DELETE FROM profile_relations WHERE owner_profile_id = ? OR related_profile_id = ?`, [id, id]);
    await pool.query(`DELETE FROM profiles WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

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

    const [u] = await pool.query('SELECT id FROM users WHERE id = ? LIMIT 1', [id]);
    if (u.length === 0) return res.status(404).json({ success: false, error: 'User not found' });

    const { compressed, original } = req.body;
    const compressedBuf = jpegDataUrlToBuffer(compressed);
    if (!compressedBuf) return res.status(400).json({ success: false, error: 'Invalid or too large compressed image' });
    let originalBuf = null;
    if (original) {
      originalBuf = jpegDataUrlToBuffer(original);
      if (!originalBuf) return res.status(400).json({ success: false, error: 'Invalid or too large original image' });
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
  if (!SAFE_ID.test(id) || !['compressed.jpg', 'original.jpg'].includes(file)) return res.status(404).end();
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${id}/profileimg/${file}` }));
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' });
    out.Body.pipe(res);
  } catch (e) {
    res.status(404).end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Clandeck API v3 - Running on ${PORT}`));