require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(cors({
  origin: ['http://localhost:5173','http://localhost:3000','https://clandeck.com','https://www.clandeck.com','https://famcir.github.io','https://clandeck.vercel.app','https://api.clandeck.com'],
  credentials: true,
  allowedHeaders: ['Content-Type','x-admin-key','Authorization']
}));
app.use(express.json({ limit: '10mb' }));

const pool = mysql.createPool({
  host: process.env.MYSQLHOST || 'altaria.proxy.rlwy.net',
  user: process.env.MYSQLUSER || 'root',
  password: process.env.MYSQLPASSWORD || 'ddkkKLwrUPaXHqxNjhwsRMzzbsMwOTqAb',
  database: process.env.MYSQLDATABASE || 'railway',
  port: process.env.MYSQLPORT || 36114,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

app.get('/', async (req, res) => {
  try { const [rows] = await pool.query('SELECT NOW() as time'); res.json({ status: 'Clandeck API v3 - Upload Fixed + Same ID + Email', db: 'connected', time: rows[0].time }); }
  catch (e) { res.json({ status: 'API Running', db: 'disconnected', error: e.message }); }
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
      if(pExist.length===0){
        await pool.query(`INSERT INTO profiles (id, owner_user_id, display_name, name, gender, show_in_deck, is_claimed, created_at) VALUES (?, ?, ?, ?, 'Male', 1, 1, NOW())`, [user.id, user.id, user.name, user.name]);
      } else {
        await pool.query(`UPDATE profiles SET display_name = ?, name = ? WHERE (owner_user_id = ? OR id = ?) AND (display_name='Hidden' OR display_name='' OR display_name IS NULL)`, [user.name, user.name, user.id, user.id]);
      }
    } catch(e){ console.log('auto-create profile skipped:', e.message); }
    const userData = { id: user.id, name: user.name, uname: user.uname, username: user.uname || user.id, mobile: user.mobile, email: user.email, photo_url: user.photo_url, status: user.status };
    res.json({ success: true, msg: `Welcome, ${user.name}!`, user: userData, id: userData.id, name: userData.name, uname: userData.uname, photo_url: userData.photo_url });
  } catch (err) { console.error(err); res.status(500).json({ success: false, msg: 'Database error', error: err.message }); }
};

// ===== UPLOAD FIX - FIXES YOUR ERROR =====
app.post('/api/upload', async (req, res) => {
  try {
    const { image, photo, photo_url, file, base64 } = req.body;
    let finalUrl = image || photo || photo_url || file || base64;
    if (!finalUrl) return res.status(400).json({ success: false, error: 'No image data received' });
    // Return as URL - frontend will save this to photo_url
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
    if(!finalUrl) return res.status(400).json({ success:false, error:'No image' });
    res.json({ success: true, url: finalUrl, photo_url: finalUrl });
  } catch(e){ res.status(500).json({ success:false, error:e.message }); }
});
app.post('/api/profiles/photo-upload', async (req, res) => {
  try {
    const { image, photo, photo_url } = req.body;
    const finalUrl = image || photo || photo_url;
    res.json({ success: true, url: finalUrl, photo_url: finalUrl });
  } catch(e){ res.status(500).json({ success:false, error:e.message }); }
});

app.get('/api/profiles/family-tree', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
    const [myRows] = await pool.query(`SELECT * FROM profiles WHERE owner_user_id = ? OR id = ? LIMIT 1`, [user_id, user_id]);
    if (myRows.length === 0) return res.status(404).json({ success: false, error: 'Profile not found' });
    const myProfile = myRows[0]; const myProfileId = myProfile.id;
    const [relations] = await pool.query(`SELECT * FROM profile_relations WHERE owner_profile_id = ? ORDER BY spouse_group ASC, birth_order ASC`, [myProfileId]);
    let father = null, mother = null, siblings = [], spouses = [], children = [];
    for (let rel of relations) {
      const [pRows] = await pool.query(`SELECT * FROM profiles WHERE id = ? LIMIT 1`, [rel.related_profile_id]);
      if (pRows.length === 0) continue;
      const profile = pRows[0];
      if (rel.relation_type === 'Father') father = profile;
      else if (rel.relation_type === 'Mother') mother = profile;
      else if (rel.relation_type === 'Sibling') siblings.push(profile);
      else if (rel.relation_type === 'Spouse') { profile.spouse_group = rel.spouse_group; profile.spouse_number = rel.spouse_number; spouses.push(profile); }
      else if (rel.relation_type === 'Child') { children.push(profile); }
    }
    res.json({ success: true, myProfile, family: { father, mother, siblings, spouses, children } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/profiles/auto-create', async (req, res) => {
  try {
    const { user_id, display_name, gender } = req.body;
    if(!user_id) return res.status(400).json({ success:false, error:'user_id required' });
    const [exists] = await pool.query(`SELECT * FROM profiles WHERE owner_user_id = ? OR id = ? LIMIT 1`, [user_id, user_id]);
    if(exists.length>0) return res.json({ success:true, data: exists[0] });
    let name = display_name; if(!name){ const [u] = await pool.query(`SELECT name FROM users WHERE id = ? LIMIT 1`, [user_id]); name = u[0]?.name || 'User'; }
    await pool.query(`INSERT INTO profiles (id, owner_user_id, display_name, name, gender, show_in_deck, is_claimed, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, NOW())`, [user_id, user_id, name, name, gender||'Male']);
    const [rows] = await pool.query(`SELECT * FROM profiles WHERE id = ?`, [user_id]);
    res.json({ success:true, data: rows[0] });
  } catch(e){ res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/profiles/family-add', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let { owner_profile_id, display_name, gender, relation_type, father_id, mother_id, spouse_id, birth_order } = req.body;
    if (!owner_profile_id || !display_name || !relation_type) return res.status(400).json({ success: false, error: 'required' });
    let [ownerRows] = await conn.query(`SELECT * FROM profiles WHERE id = ? OR owner_user_id = ? LIMIT 1`, [owner_profile_id, owner_profile_id]);
    if (ownerRows.length === 0) throw new Error('Owner not found');
    owner_profile_id = ownerRows[0].id; const owner = ownerRows[0];
    const [uuidRow] = await conn.query(`SELECT UUID() as uuid`); const genId = uuidRow[0].uuid;
    let newProfileId = genId;
    if (relation_type === 'Father' || relation_type === 'Mother') {
      await conn.query(`INSERT INTO profiles (id, owner_user_id, display_name, name, gender, show_in_deck, is_claimed, created_at) VALUES (?, ?, ?, ?, ?, 1, 0, NOW())`, [genId, owner.owner_user_id, display_name, display_name, gender || (relation_type==='Father'?'Male':'Female')]);
      if (relation_type === 'Father') await conn.query(`UPDATE profiles SET father_id = ? WHERE id = ?`, [newProfileId, owner_profile_id]); else await conn.query(`UPDATE profiles SET mother_id = ? WHERE id = ?`, [newProfileId, owner_profile_id]);
      await conn.query(`INSERT INTO profile_relations (owner_profile_id, related_profile_id, relation_type, created_at) VALUES (?, ?, ?, NOW())`, [owner_profile_id, newProfileId, relation_type]);
      await conn.query(`INSERT INTO profile_relations (owner_profile_id, related_profile_id, relation_type, created_at) VALUES (?, ?, ?, NOW())`, [newProfileId, owner_profile_id, 'Child']);
    } else if (relation_type === 'Spouse') {
      const [maxGroup] = await conn.query(`SELECT MAX(spouse_group) as maxg FROM profile_relations WHERE owner_profile_id = ? AND relation_type='Spouse'`, [owner_profile_id]);
      const spouse_group = (maxGroup[0].maxg || 0) + 1;
      await conn.query(`INSERT INTO profiles (id, owner_user_id, display_name, name, gender, show_in_deck, is_claimed, created_at) VALUES (?, ?, ?, ?, ?, 1, 0, NOW())`, [genId, owner.owner_user_id, display_name, display_name, gender]);
      await conn.query(`INSERT INTO profile_relations (owner_profile_id, related_profile_id, relation_type, spouse_group, spouse_number, created_at) VALUES (?, ?, 'Spouse', ?, ?, NOW())`, [owner_profile_id, newProfileId, spouse_group, spouse_group]);
      await conn.query(`INSERT INTO profile_relations (owner_profile_id, related_profile_id, relation_type, spouse_group, spouse_number, created_at) VALUES (?, ?, 'Spouse', ?, ?, NOW())`, [newProfileId, owner_profile_id, spouse_group, spouse_group]);
    } else {
      await conn.query(`INSERT INTO profiles (id, owner_user_id, display_name, name, gender, father_id, mother_id, show_in_deck, is_claimed, birth_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, NOW())`, [genId, owner.owner_user_id, display_name, display_name, gender, father_id||null, mother_id||null, birth_order||1]);
    }
    await conn.commit();
    const [newProfileRows] = await pool.query(`SELECT * FROM profiles WHERE id = ?`, [newProfileId]);
    res.json({ success: true, data: newProfileRows[0] });
  } catch (e) { await conn.rollback(); res.status(500).json({ success: false, error: e.message }); } finally { conn.release(); }
});

app.delete('/api/profiles/:id', async (req, res) => { try { const id = req.params.id; await pool.query(`DELETE FROM profile_relations WHERE owner_profile_id = ? OR related_profile_id = ?`, [id, id]); await pool.query(`DELETE FROM profiles WHERE id = ?`, [id]); res.json({ success:true }); } catch(e){ res.status(500).json({ success:false, error:e.message }); } });
app.get('/api/family', async (req, res) => { try { const { user_id } = req.query; const [rows] = await pool.query(`SELECT * FROM profiles WHERE owner_user_id = ? OR id = ?`, [user_id, user_id]); res.json({ success: true, data: rows }); } catch (e) { res.json({ success: true, data: [] }); } });

const ADMIN_KEY = process.env.ADMIN_KEY || "clandeck_2026_admin";
const adminAuth = (req, res, next) => { const key = req.headers["x-admin-key"] || req.query.key; if (!key) return next(); if (key !== ADMIN_KEY) return res.status(401).json({ success: false, message: "Unauthorized" }); next(); };

app.get('/api/admin/all-tables', adminAuth, async (req, res) => { try { const [tablesRaw] = await pool.query('SHOW TABLES'); const tableNames = tablesRaw.map(t => Object.values(t)[0]); const result = {}; for (const tName of tableNames) { try { const [countRes] = await pool.query(`SELECT COUNT(*) as count FROM \`${tName}\``); const [colsDetail] = await pool.query(`SHOW COLUMNS FROM \`${tName}\``); const [rows] = await pool.query(`SELECT * FROM \`${tName}\` ORDER BY id DESC LIMIT 50`); result[tName] = { totalCount: countRes[0].count, columns: colsDetail.map(c => c.Field), columnsDetail: colsDetail, rows: rows }; } catch (e) { result[tName] = { totalCount: 0, columns: [], columnsDetail: [], rows: [] }; } } res.json(result); } catch (err) { res.status(500).json({ success: false, message: err.message }); } });
app.get('/api/admin/stats', adminAuth, async (req, res) => { try { const [usersCount] = await pool.query('SELECT COUNT(*) as count FROM users'); const [latestUsers] = await pool.query('SELECT id, uname, name, email, mobile, status, created_at FROM users ORDER BY id DESC LIMIT 20'); const [tables] = await pool.query('SHOW TABLES'); res.json({ success: true, counts: { users: usersCount[0].count }, latestUsers, tables: tables.map(t => Object.values(t)[0]) }); } catch (err) { res.status(500).json({ success: false, message: err.message }); } });

function getTree(dir, depth=0, maxDepth=4){
  if(depth>maxDepth) return [];
  try{
    const items = fs.readdirSync(dir, {withFileTypes:true});
    return items.filter(f => {
      if(['node_modules','.git','dist','build','.next','uploads','.vercel','.railway'].includes(f.name)) return false;
      if(f.name.startsWith('.')) return false;
      if(['bin','boot','dev','etc','lib','lib64','proc','sbin','sys','usr','var','tmp','run'].includes(f.name) && depth===0 && dir==='/') return false;
      return true;
    }).map(f=>{
      const full = path.join(dir, f.name);
      try{
        if(f.isDirectory()){
          return { name: f.name, type:'folder', path: full, children: getTree(full, depth+1, maxDepth) };
        } else {
          const stat = fs.statSync(full);
          return { name: f.name, type:'file', path: full, size: `${(stat.size/1024).toFixed(1)} KB` };
        }
      }catch{ return null; }
    }).filter(Boolean);
  }catch{ return []; }
}

app.get('/api/admin/file-structure', adminAuth, (req,res)=>{
  try{
    const deployedRoot = __dirname;
    const tree = { name: 'clandeck-project (Deployed)', type: 'folder', source:'deployed', rootPath: deployedRoot, path: deployedRoot, children: getTree(deployedRoot,0,4) };
    res.json(tree);
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/admin/local-file-structure', adminAuth, (req,res)=>{
  try{
    const possibleRoot = path.join(__dirname, '..');
    const hasPkg = fs.existsSync(path.join(possibleRoot, 'package.json')) || fs.existsSync(path.join(possibleRoot, 'frontend', 'package.json')) || fs.existsSync(path.join(__dirname, 'package.json'));
    const localRoot = hasPkg ? possibleRoot : __dirname;
    const tree = { name: 'clandeck-project (Local)', type: 'folder', source:'local', rootPath: localRoot, path: localRoot, children: getTree(localRoot,0,6) };
    res.json(tree);
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/login', handleLogin); 
app.post('/api/auth/login', handleLogin);
app.get('/api/test-users', async (req, res) => { try { const [rows] = await pool.query('SELECT id, uname, name, status FROM users LIMIT 5'); res.json({ success: true, count: rows.length, users: rows }); } catch (e) { res.status(500).json({ error: e.message }); } });

// ===== FIXED PROFILE APIS - SAME ID + EMAIL FIELD =====
app.get('/api/profile/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const [rows] = await pool.query(
      `SELECT p.*, u.email as user_email, u.mobile as user_mobile, u.name as user_name, u.photo_url as user_photo 
       FROM profiles p 
       LEFT JOIN users u ON u.id = p.id 
       WHERE p.id = ? OR p.owner_user_id = ? 
       LIMIT 1`,
      [id, id]
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
    const { display_name, name, nickname, gender, dob, email, mobile_number, mobile, visibility, show_in_deck, is_alive, dod, location, bio, photo_url } = req.body;
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
       WHERE id = ? OR owner_user_id = ?`,
      [finalName, nickname, gender, dob || null, finalMobile, finalEmail, visibility, show_in_deck, is_alive, dod || null, location, bio, photo_url, id, id]
    );
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Clandeck API v3 - Upload Fixed - Running on ${PORT}`));