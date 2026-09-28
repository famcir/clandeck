import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import multer from 'multer';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// --- DB ---
let pool;
const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("❌ MYSQL_URL missing!");
} else {
  try {
    pool = mysql.createPool(dbUrl);
    pool.getConnection().then(c => { console.log("✅ DB Connected!"); c.release(); }).catch(err => console.error("❌ DB Failed:", err.message));
  } catch (err) { console.error("Pool error:", err.message); }
}

// --- S3 CLIENT ---
const BUCKET_NAME = process.env.RAILWAY_BUCKET_NAME || process.env.BUCKET_NAME || "clandeckbucket-kbeh97nv8b";
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.ENDPOINT,
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
});

const upload = multer({ storage: multer.memoryStorage() });

// --- API ROUTES ---
app.get('/api', (req, res) => res.json({ status: 'ok', message: 'Clandeck Backend Running!' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', db: pool? 'pool exists' : 'no pool', bucket: BUCKET_NAME }));

app.post('/api/register', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not configured" });
  const { id, name, email, password, uname } = req.body;
  const finalUname = uname || email;
  try {
    try { await pool.query("ALTER TABLE users ADD COLUMN uname VARCHAR(255) UNIQUE"); } catch(e) {}
    await pool.execute("INSERT INTO users (id, name, email, uname, password, status) VALUES (?,?,?,?,?,?)", [id, name, email || finalUname, finalUname, password, 'active']);
    res.json({ message: "User created!", id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/share-temp-user', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  const { id, name, email, password, profile_id, invited_by_user_id, uname } = req.body;
  const finalUname = uname || email;
  try {
    try { await pool.query("ALTER TABLE users ADD COLUMN uname VARCHAR(255)"); } catch(e) {}
    try { await pool.query("ALTER TABLE users ADD COLUMN invited_by_user_id VARCHAR(255)"); } catch(e) {}
    try { await pool.query("ALTER TABLE users ADD COLUMN shared_profile_id VARCHAR(255)"); } catch(e) {}
    try { await pool.query("ALTER TABLE users ADD COLUMN is_temp TINYINT DEFAULT 0"); } catch(e) {}

    // === OWNERSHIP CHECK - Sarala case ===
    if (profile_id) {
      try {
        const [pRows] = await pool.query("SELECT id, display_name, owner_user_id, is_claimed FROM profiles WHERE id=?", [profile_id]);
        const p = pRows[0];
        if (p) {
          const isClaimed = p.is_claimed === 1 || (p.owner_user_id && p.owner_user_id === p.id);
          const isOwnedByOther = p.owner_user_id && p.owner_user_id!== invited_by_user_id && p.owner_user_id!== profile_id;
          if ((isClaimed && p.owner_user_id) || isOwnedByOther) {
            return res.status(403).json({ error: `${p.display_name} take its Ownership, not Possible to create new user credentials` });
          }
        }
        const [uRows] = await pool.query("SELECT id FROM users WHERE id=? LIMIT 1", [profile_id]);
        if (uRows.length > 0) {
          const [pNameRows] = await pool.query("SELECT display_name FROM profiles WHERE id=?", [profile_id]);
          const dName = pNameRows[0]?.display_name || name || 'User';
          return res.status(403).json({ error: `${dName} take its Ownership, not Possible to create new user credentials` });
        }
      } catch (chkErr) {
        console.log("ownership check skip:", chkErr.message);
      }
    }

    await pool.execute(
      "INSERT INTO users (id, name, email, uname, password, status, invited_by_user_id, shared_profile_id, is_temp) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, name, email || finalUname, finalUname, password || 'pw1234', 'active', invited_by_user_id, profile_id || null, 1]
    );
    res.json({ success: true, username: finalUname, password: password || 'pw1234' });
  } catch (err) {
    if (err.message.includes('Duplicate')) {
      try {
        await pool.execute("UPDATE users SET password=?, invited_by_user_id=?, shared_profile_id=?, uname=? WHERE email=? OR uname=?", [password || 'pw1234', invited_by_user_id, profile_id || null, finalUname, email, finalUname]);
        return res.json({ success: true, username: finalUname, password: password || 'pw1234', reused: true });
      } catch(e2) { return res.status(500).json({ error: e2.message }); }
    }
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  const { email, password, uname } = req.body;
  const loginId = uname || email;
  try {
    try { await pool.query("ALTER TABLE users ADD COLUMN uname VARCHAR(255)"); } catch(e) {}
    try { await pool.query("ALTER TABLE users ADD COLUMN shared_profile_id VARCHAR(255)"); } catch(e) {}
    try { await pool.query("ALTER TABLE users ADD COLUMN is_temp TINYINT DEFAULT 0"); } catch(e) {}
    try { await pool.query("ALTER TABLE users ADD COLUMN invited_by_user_id VARCHAR(255)"); } catch(e) {}
    const [rows] = await pool.execute("SELECT id, name, email, uname, shared_profile_id, is_temp FROM users WHERE (uname=? OR email=?) AND password=?", [loginId, loginId, password]);
    if (rows.length === 0) return res.status(400).json({ error: "Wrong username or password" });
    res.json({ message: "Login success", id: rows[0].id, name: rows[0].name, email: rows[0].email, uname: rows[0].uname, shared_profile_id: rows[0].shared_profile_id, is_temp: rows[0].is_temp, token: "token-" + rows[0].id });
  } catch (err) { res.status(500).json({ error: "DB Error: " + err.message }); }
});

app.post('/api/claim-account', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  const { userId, newUname, newPassword } = req.body;
  if (!userId ||!newUname ||!newPassword) return res.status(400).json({error: "Missing fields"});
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("SET FOREIGN_KEY_CHECKS=0");
    const [rows] = await conn.query("SELECT id, shared_profile_id FROM users WHERE id=?", [userId]);
    if (rows.length===0) throw new Error("User not found");
    const sharedProfileId = rows[0].shared_profile_id;
    if (!sharedProfileId) throw new Error("No shared_profile_id to claim");
    if (rows[0].id === sharedProfileId) {
      await conn.query("SET FOREIGN_KEY_CHECKS=1");
      await conn.rollback();
      return res.json({success: true, id: rows[0].id, message: "Already claimed"});
    }
    const newId = sharedProfileId;
    const [unameCheck] = await conn.query("SELECT id FROM users WHERE uname=? AND id!=?", [newUname, userId]);
    if (unameCheck.length>0) throw new Error("Username already taken");
    await conn.query("UPDATE users SET id=?, uname=?, email=?, password=?, is_temp=0, shared_profile_id=NULL WHERE id=?", [newId, newUname, newUname, newPassword, userId]);
    await conn.query("UPDATE profiles SET owner_user_id=?, is_claimed=1 WHERE id=?", [newId, sharedProfileId]);
    await conn.query("SET FOREIGN_KEY_CHECKS=1");
    await conn.commit();
    res.json({success: true, id: newId, uname: newUname});
  } catch(e){
    try { await conn.query("SET FOREIGN_KEY_CHECKS=1"); } catch {}
    await conn.rollback();
    console.error("claim error", e.message);
    res.status(500).json({error: e.message});
  } finally { conn.release(); }
});

// NEW: Ownership check support for Deck.jsx Share button
app.get('/api/users', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { profile_id, shared_profile_id } = req.query;
    if (profile_id) {
      const [rows] = await pool.query("SELECT id, name, email, uname, shared_profile_id, is_temp, invited_by_user_id FROM users WHERE id=? OR shared_profile_id=?", [profile_id, profile_id]);
      const [pRows] = await pool.query("SELECT id, display_name, owner_user_id, is_claimed FROM profiles WHERE id=?", [profile_id]);
      if (rows.length > 0 || (pRows[0]?.owner_user_id && pRows[0]?.is_claimed)) {
        return res.json({ is_owned: true, owner_user_id: pRows[0]?.owner_user_id, profile: pRows[0], users: rows });
      }
      return res.json([]);
    }
    if (shared_profile_id) {
      const [rows] = await pool.query("SELECT id FROM users WHERE shared_profile_id=?", [shared_profile_id]);
      return res.json(rows);
    }
    const [rows] = await pool.query("SELECT id, name, email, uname FROM users LIMIT 100");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const [rows] = await pool.execute("SELECT id, name, email, uname, photo_url FROM users WHERE id=?", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// NEW: Mango basket count - claimed logic
app.get('/api/basket/:userId', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { userId } = req.params;
    try { await pool.query("ALTER TABLE profiles ADD COLUMN created_by_user_id VARCHAR(255)"); } catch(e) {}
    try { await pool.query("ALTER TABLE profiles ADD COLUMN is_claimed TINYINT DEFAULT 0"); } catch(e) {}
    try { await pool.query("ALTER TABLE profiles ADD COLUMN owner_user_id VARCHAR(255)"); } catch(e) {}

    const [totalRows] = await pool.query(
      `SELECT COUNT(*) as total FROM profiles WHERE (created_by_user_id=? OR (created_by_user_id IS NULL AND owner_user_id=?)) AND id!=?`,
      [userId, userId, userId]
    );
    const [claimedRows] = await pool.query(
      `SELECT COUNT(*) as claimed FROM profiles WHERE (created_by_user_id=? OR (created_by_user_id IS NULL AND owner_user_id=?)) AND is_claimed=1 AND id!=?`,
      [userId, userId, userId]
    );
    const [unclaimedRows] = await pool.query(
      `SELECT COUNT(*) as unclaimed FROM profiles WHERE (created_by_user_id=? OR (created_by_user_id IS NULL AND owner_user_id=?)) AND (is_claimed=0 OR is_claimed IS NULL) AND id!=?`,
      [userId, userId, userId]
    );

    res.json({
      userId,
      totalCreated: totalRows[0]?.total || 0,
      claimed: claimedRows[0]?.claimed || 0,
      unclaimed: unclaimedRows[0]?.unclaimed || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { photo_url, name, full_name } = req.body;
    const displayName = full_name || name;
    if (photo_url) {
      try { await pool.execute("UPDATE users SET photo_url=?, name=? WHERE id=?", [photo_url, displayName, req.params.id]); }
      catch (e) { await pool.execute("UPDATE users SET name=? WHERE id=?", [displayName, req.params.id]); }
    } else if (displayName) {
      await pool.execute("UPDATE users SET name=? WHERE id=?", [displayName, req.params.id]);
    }
    res.json({ success: true, photo_url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/profiles', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { owner_user_id, search } = req.query;

    if (search && search.trim().length > 0) {
      const s = search.trim().toLowerCase();
      const likeAny = `%${s}%`;
      const likeStart = `${s}%`;
      const [rows] = await pool.query(
        `SELECT * FROM profiles
         WHERE LOWER(display_name) LIKE?
         ORDER BY CASE WHEN LOWER(display_name) LIKE? THEN 0 ELSE 1 END,
         display_name ASC LIMIT 30`,
        [likeAny, likeStart]
      );
      if (owner_user_id) {
        const owned = rows.filter(r => r.owner_user_id === owner_user_id);
        const others = rows.filter(r => r.owner_user_id!== owner_user_id);
        return res.json([...owned,...others].slice(0,30));
      }
      return res.json(rows);
    }

    if (!owner_user_id) return res.json([]);

    const [owned] = await pool.query('SELECT * FROM profiles WHERE owner_user_id =?', [owner_user_id]);
    let self = owned.find(p => p.id === owner_user_id);
    if (!self) {
      const [sRows] = await pool.query('SELECT * FROM profiles WHERE id=?', [owner_user_id]);
      self = sRows[0];
    }
    if (!self) return res.json(owned);
    const [allProfiles] = await pool.query('SELECT * FROM profiles');
    const [spouseRelations] = await pool.query(`SELECT * FROM profile_relations WHERE relation_type='Spouse' AND (owner_profile_id=? OR related_profile_id=?)`, [self.id, self.id]);
    const spouseIds = spouseRelations.map(r => r.owner_profile_id === self.id? r.related_profile_id : r.owner_profile_id);
    const familyParentIds = [self.id,...spouseIds];
    const father = allProfiles.find(p => p.id === self.father_id);
    const mother = allProfiles.find(p => p.id === self.mother_id);
    const spouses = allProfiles.filter(p => spouseIds.includes(p.id));
    const children = allProfiles.filter(p => {
      if (p.id === self.id) return false;
      if (spouseIds.includes(p.id)) return false;
      return familyParentIds.includes(p.father_id) || familyParentIds.includes(p.mother_id);
    });
    const siblings = allProfiles.filter(p => {
      if (p.id === self.id) return false;
      if (spouseIds.includes(p.id)) return false;
      if (children.find(c=>c.id===p.id)) return false;
      if (!self.father_id &&!self.mother_id) return false;
      if (self.father_id && self.mother_id) return p.father_id === self.father_id && p.mother_id === self.mother_id;
      if (self.father_id) return p.father_id === self.father_id;
      if (self.mother_id) return p.mother_id === self.mother_id;
      return false;
    });
    const result = [];
    result.push({...self, relation_label: 'Self', computed_relation: 'Self'});
    if (father) result.push({...father, relation_label: 'Father', computed_relation: 'Father'});
    if (mother) result.push({...mother, relation_label: 'Mother', computed_relation: 'Mother'});
    spouses.forEach(s => result.push({...s, relation_label: 'Spouse', computed_relation: 'Spouse'}));
    siblings.forEach(s => result.push({...s, relation_label: 'Sibling', computed_relation: 'Sibling'}));
    children.forEach(c => result.push({...c, relation_label: 'Child', computed_relation: 'Child'}));
    res.json(result);
  } catch(e){ res.status(500).json({error: e.message}) }
});

app.get('/api/profiles/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const [rows] = await pool.query('SELECT * FROM profiles WHERE id =?', [req.params.id]);
    res.json(rows[0] || {});
  } catch(e){ res.status(500).json({error: e.message}) }
});

app.get('/api/family-tree/:profileId', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { profileId } = req.params;
    const [selfRows] = await pool.query('SELECT * FROM profiles WHERE id=?', [profileId]);
    const self = selfRows[0];
    if (!self) return res.json([]);
    const [allProfiles] = await pool.query('SELECT * FROM profiles');
    const [spouseRelations] = await pool.query(`SELECT * FROM profile_relations WHERE relation_type='Spouse' AND (owner_profile_id=? OR related_profile_id=?)`, [profileId, profileId]);
    const spouseIds = spouseRelations.map(r => r.owner_profile_id === profileId? r.related_profile_id : r.owner_profile_id);
    const familyParentIds = [profileId,...spouseIds];
    const father = allProfiles.find(p => p.id === self.father_id);
    const mother = allProfiles.find(p => p.id === self.mother_id);
    const spouses = allProfiles.filter(p => spouseIds.includes(p.id));
    const children = allProfiles.filter(p => {
      if (p.id === profileId) return false;
      if (spouseIds.includes(p.id)) return false;
      return familyParentIds.includes(p.father_id) || familyParentIds.includes(p.mother_id);
    });
    const siblings = allProfiles.filter(p => {
      if (p.id === profileId) return false;
      if (spouseIds.includes(p.id)) return false;
      if (children.find(c=>c.id===p.id)) return false;
      if (!self.father_id &&!self.mother_id) return false;
      if (self.father_id && self.mother_id) return p.father_id === self.father_id && p.mother_id === self.mother_id;
      if (self.father_id) return p.father_id === self.father_id;
      if (self.mother_id) return p.mother_id === self.mother_id;
      return false;
    });
    const result = [];
    result.push({...self, relation_label: 'Self', computed_relation: 'Self'});
    if (father) result.push({...father, relation_label: 'Father', computed_relation: 'Father'});
    if (mother) result.push({...mother, relation_label: 'Mother', computed_relation: 'Mother'});
    spouses.forEach(s => result.push({...s, relation_label: 'Spouse', computed_relation: 'Spouse'}));
    siblings.forEach(s => result.push({...s, relation_label: 'Sibling', computed_relation: 'Sibling'}));
    children.forEach(c => result.push({...c, relation_label: 'Child', computed_relation: 'Child'}));
    res.json(result);
  } catch (e) {
    console.error('family-tree error', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/profiles/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { display_name, dob, photo_url, is_claimed, bio, location, gender, father_id, mother_id } = req.body;
    await pool.query(`UPDATE profiles SET display_name=COALESCE(?,display_name), dob=COALESCE(?,dob), photo_url=COALESCE(?,photo_url), is_claimed=COALESCE(?,is_claimed), bio=COALESCE(?,bio), location=COALESCE(?,location), gender=COALESCE(?,gender), father_id=COALESCE(?,father_id), mother_id=COALESCE(?,mother_id) WHERE id=?`, [display_name, dob, photo_url, is_claimed, bio, location, gender, father_id, mother_id, req.params.id]);
    res.json({ success: true });
  } catch(e){ res.status(500).json({error: e.message}) }
});

app.post('/api/profiles/link', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  const conn = await pool.getConnection();
  try {
    const { my_profile_id, existing_profile_id, relation } = req.body;
    if (!my_profile_id ||!existing_profile_id ||!relation) return res.status(400).json({error:"my_profile_id, existing_profile_id, relation required"});
    await conn.beginTransaction();
    const [meRows] = await conn.query('SELECT * FROM profiles WHERE id=?', [my_profile_id]);
    const me = meRows[0];
    if (!me) throw new Error("my_profile not found");
    if (relation === 'Father') {
      await conn.query('UPDATE profiles SET father_id=? WHERE id=?', [existing_profile_id, my_profile_id]);
    } else if (relation === 'Mother') {
      await conn.query('UPDATE profiles SET mother_id=? WHERE id=?', [existing_profile_id, my_profile_id]);
    } else if (relation === 'Child') {
      if (me.gender === 'Female') {
        await conn.query('UPDATE profiles SET mother_id=? WHERE id=?', [my_profile_id, existing_profile_id]);
      } else {
        await conn.query('UPDATE profiles SET father_id=? WHERE id=?', [my_profile_id, existing_profile_id]);
      }
    } else if (relation === 'Sibling') {
      await conn.query('UPDATE profiles SET father_id=?, mother_id=? WHERE id=?', [me.father_id, me.mother_id, existing_profile_id]);
      const rel1 = `rel_${Date.now()}_${Math.random().toString(36).substr(2,3)}`;
      const rel2 = `rel_${Date.now()+1}_${Math.random().toString(36).substr(2,3)}`;
      try {
        await conn.execute(`INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type) VALUES (?,?,?,?), (?,?,?,?)`, [rel1, my_profile_id, existing_profile_id, 'Sibling', rel2, existing_profile_id, my_profile_id, 'Sibling']);
      } catch(e) {
        await conn.execute(`INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?), (?,?,?,?,?)`, [rel1, my_profile_id, existing_profile_id, 'Sibling', null, rel2, existing_profile_id, my_profile_id, 'Sibling', null]);
      }
    } else if (relation === 'Spouse') {
      const rel1 = `rel_${Date.now()}_${Math.random().toString(36).substr(2,3)}`;
      const rel2 = `rel_${Date.now()+1}_${Math.random().toString(36).substr(2,3)}`;
      await conn.execute(`INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?), (?,?,?,?,?)`, [rel1, my_profile_id, existing_profile_id, 'Spouse', null, rel2, existing_profile_id, my_profile_id, 'Spouse', null]);
    }
    await conn.commit();
    res.json({ success: true, linked: true, relation });
  } catch(e){
    await conn.rollback();
    res.status(500).json({error:e.message});
  } finally { conn.release(); }
});

app.post('/api/profiles/merge', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  const conn = await pool.getConnection();
  try {
    const { keepId, duplicateId } = req.body;
    if (!keepId ||!duplicateId) return res.status(400).json({error:"keepId and duplicateId required"});
    if (keepId === duplicateId) return res.status(400).json({error:"same id"});
    await conn.beginTransaction();
    await conn.query("SET FOREIGN_KEY_CHECKS=0");
    await conn.query('UPDATE profiles SET father_id=? WHERE father_id=?', [keepId, duplicateId]);
    await conn.query('UPDATE profiles SET mother_id=? WHERE mother_id=?', [keepId, duplicateId]);
    await conn.query('UPDATE profile_relations SET owner_profile_id=? WHERE owner_profile_id=?', [keepId, duplicateId]);
    await conn.query('UPDATE profile_relations SET related_profile_id=? WHERE related_profile_id=?', [keepId, duplicateId]);
    await conn.query('UPDATE users SET shared_profile_id=? WHERE shared_profile_id=?', [keepId, duplicateId]);
    await conn.query('DELETE FROM profiles WHERE id=?', [duplicateId]);
    await conn.query("SET FOREIGN_KEY_CHECKS=1");
    await conn.commit();
    res.json({ success: true, keepId, mergedDuplicate: duplicateId });
  } catch(e){
    try { await conn.query("SET FOREIGN_KEY_CHECKS=1"); } catch {}
    await conn.rollback();
    res.status(500).json({error:e.message});
  } finally { conn.release(); }
});

app.delete('/api/profiles/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  const conn = await pool.getConnection();
  try {
    const profileId = req.params.id;
    const deleterUserId = req.query.deleterId || req.query.deleter_user_id || req.body?.deleterId;
    await conn.query("SET FOREIGN_KEY_CHECKS=0");
    await conn.beginTransaction();
    const [pRows] = await conn.query('SELECT * FROM profiles WHERE id=?', [profileId]);
    const target = pRows[0];
    if (!target) { await conn.rollback(); await conn.query("SET FOREIGN_KEY_CHECKS=1"); return res.status(404).json({error:"Profile not found"}); }
    let deleterProfileId = deleterUserId;
    if (deleterUserId) {
      const [dRows] = await conn.query('SELECT id FROM profiles WHERE id=? OR owner_user_id=? LIMIT 1', [deleterUserId, deleterUserId]);
      if (dRows[0]) deleterProfileId = dRows[0].id;
    }
    const isClaimed = target.is_claimed === 1 || target.owner_user_id === target.id;
    const isOwner = target.owner_user_id === deleterUserId || profileId === deleterUserId;
    if (!isOwner && isClaimed) {
      await conn.query('DELETE FROM profile_relations WHERE (owner_profile_id=? AND related_profile_id=?) OR (owner_profile_id=? AND related_profile_id=?)', [deleterProfileId, profileId, profileId, deleterProfileId]);
      await conn.commit();
      await conn.query("SET FOREIGN_KEY_CHECKS=1");
      return res.json({ success: true, mode: 'unlinked' });
    }
    try {
      let continuationToken = undefined;
      let isTruncated = true;
      while (isTruncated) {
        const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix: `avatars/${profileId}`, ContinuationToken: continuationToken }));
        if (list.Contents && list.Contents.length > 0) {
          for (const obj of list.Contents) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: obj.Key }));
        }
        isTruncated = list.IsTruncated || false;
        continuationToken = list.NextContinuationToken;
        if (!isTruncated) break;
      }
      const pUrl = target.photo_url || '';
      if (pUrl.includes('/api/files/')) {
        const k = decodeURIComponent(pUrl.split('/api/files/')[1]);
        if (k) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: k })).catch(()=>{});
      }
    } catch(s3e){}
    const [linkedUsers] = await conn.query('SELECT id FROM users WHERE id=? OR shared_profile_id=?', [profileId, profileId]);
    await conn.query('DELETE FROM profile_relations WHERE related_profile_id=? OR owner_profile_id=?', [profileId, profileId]);
    if (deleterProfileId) {
      await conn.query('UPDATE profiles SET father_id=NULL WHERE father_id=? AND mother_id!=? AND mother_id IS NOT NULL', [profileId, deleterProfileId]);
      await conn.query('UPDATE profiles SET mother_id=NULL WHERE mother_id=? AND father_id!=? AND father_id IS NOT NULL', [profileId, deleterProfileId]);
      await conn.query('UPDATE profiles SET father_id=NULL WHERE father_id=?', [profileId]);
      await conn.query('UPDATE profiles SET mother_id=NULL WHERE mother_id=?', [profileId]);
    } else {
      await conn.query('UPDATE profiles SET father_id=NULL WHERE father_id=?', [profileId]);
      await conn.query('UPDATE profiles SET mother_id=NULL WHERE mother_id=?', [profileId]);
    }
    await conn.query('DELETE FROM profiles WHERE id=?', [profileId]);
    for (const u of linkedUsers) {
      await conn.query('DELETE FROM users WHERE id=?', [u.id]);
      await conn.query('DELETE FROM profiles WHERE owner_user_id=?', [u.id]);
    }
    await conn.commit();
    await conn.query("SET FOREIGN_KEY_CHECKS=1");
    res.json({ success: true, mode: 'deleted', deletedProfile: profileId });
  } catch(e){
    try { await conn.query("SET FOREIGN_KEY_CHECKS=1"); } catch {}
    try { await conn.rollback(); } catch {}
    res.status(500).json({error: e.message})
  } finally { conn.release(); }
});

app.post('/api/profiles', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { id, display_name, relation_label, relation, owner_user_id, my_profile_id, photo_url, dob, name, bio, location, gender, father_id, mother_id } = req.body;
    const finalName = display_name || name;
    const finalId = id || `pr_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
    const finalRelation = relation || relation_label || 'Family';
    const myId = my_profile_id || null;
    if (!finalName) { await conn.rollback(); return res.status(400).json({ error: "display_name required" }); }
    if (!owner_user_id) { await conn.rollback(); return res.status(400).json({ error: "owner_user_id required" }); }
    let newFatherId = father_id || null;
    let newMotherId = mother_id || null;
    let newGender = gender || null;
    if (!newGender) {
      if (finalRelation === 'Father') newGender = 'Male';
      else if (finalRelation === 'Mother') newGender = 'Female';
    }
    let me = null;
    let mySpouseId = null;
    if (myId) {
      const [meRows] = await conn.query('SELECT * FROM profiles WHERE id=?', [myId]);
      me = meRows[0];
      if (me) {
        const [spRows] = await conn.query(`SELECT related_profile_id FROM profile_relations WHERE owner_profile_id=? AND relation_type='Spouse' LIMIT 1`, [myId]);
        mySpouseId = spRows[0]?.related_profile_id || null;
        if (finalRelation === 'Child') {
          if (me.gender === 'Male' || me.gender === null) { newFatherId = myId; newMotherId = mySpouseId; }
          else { newMotherId = myId; newFatherId = mySpouseId; }
        } else if (finalRelation === 'Sibling') { newFatherId = me.father_id; newMotherId = me.mother_id; }
      }
    }
    await conn.execute(`INSERT INTO profiles (id, owner_user_id, display_name, dob, photo_url, is_claimed, created_by_user_id, bio, location, gender, father_id, mother_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [finalId, owner_user_id, finalName, dob || null, photo_url || null, 0, owner_user_id, bio || null, location || null, newGender, newFatherId, newMotherId]);
    if (me) {
      if (finalRelation === 'Father') {
        await conn.query(`UPDATE profiles SET father_id=? WHERE id=?`, [finalId, myId]);
        if (me.father_id) await conn.query(`UPDATE profiles SET father_id=? WHERE father_id=? AND id!=?`, [finalId, me.father_id, finalId]);
        try {
          if (me.mother_id) await conn.query(`UPDATE profiles SET father_id=? WHERE mother_id=? AND (father_id IS NULL OR father_id='') AND id!=?`, [finalId, me.mother_id, finalId]);
          if (me.mother_id) {
            const [check] = await conn.query(`SELECT id FROM profile_relations WHERE ((owner_profile_id=? AND related_profile_id=?) OR (owner_profile_id=? AND related_profile_id=?)) AND relation_type='Spouse'`, [finalId, me.mother_id, me.mother_id, finalId]);
            if (check.length === 0) {
              const relA = `rel_${Date.now()}_${Math.random().toString(36).substr(2,3)}`;
              const relB = `rel_${Date.now()+1}_${Math.random().toString(36).substr(2,3)}`;
              await conn.execute(`INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?), (?,?,?,?,?)`, [relA, finalId, me.mother_id, 'Spouse', null, relB, me.mother_id, finalId, 'Spouse', null]);
            }
          }
        } catch(e) {}
      } else if (finalRelation === 'Mother') {
        await conn.query(`UPDATE profiles SET mother_id=? WHERE id=?`, [finalId, myId]);
        if (me.mother_id) await conn.query(`UPDATE profiles SET mother_id=? WHERE mother_id=? AND id!=?`, [finalId, me.mother_id, finalId]);
        try {
          if (me.father_id) await conn.query(`UPDATE profiles SET mother_id=? WHERE father_id=? AND (mother_id IS NULL OR mother_id='') AND id!=?`, [finalId, me.father_id, finalId]);
          await conn.query(`UPDATE profiles SET mother_id=? WHERE father_id=? AND (mother_id IS NULL OR mother_id='')`, [finalId, myId]);
          if (me.father_id) {
            const [check] = await conn.query(`SELECT id FROM profile_relations WHERE ((owner_profile_id=? AND related_profile_id=?) OR (owner_profile_id=? AND related_profile_id=?)) AND relation_type='Spouse'`, [finalId, me.father_id, me.father_id, finalId]);
            if (check.length === 0) {
              const relA = `rel_${Date.now()+2}_${Math.random().toString(36).substr(2,3)}`;
              const relB = `rel_${Date.now()+3}_${Math.random().toString(36).substr(2,3)}`;
              await conn.execute(`INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?), (?,?,?,?,?)`, [relA, finalId, me.father_id, 'Spouse', null, relB, me.father_id, finalId, 'Spouse', null]);
            }
          }
        } catch(e) {}
      } else if (finalRelation === 'Spouse') {
        const rel1 = `rel_${Date.now()}_${Math.random().toString(36).substr(2,3)}`;
        const rel2 = `rel_${Date.now()+1}_${Math.random().toString(36).substr(2,3)}`;
        await conn.execute(`INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?), (?,?,?,?,?)`, [rel1, myId, finalId, 'Spouse', null, rel2, finalId, myId, 'Spouse', null]);
        try {
          if (me.gender === 'Female') await conn.query(`UPDATE profiles SET father_id=? WHERE mother_id=? AND (father_id IS NULL OR father_id='')`, [finalId, myId]);
          else await conn.query(`UPDATE profiles SET mother_id=? WHERE father_id=? AND (mother_id IS NULL OR mother_id='')`, [finalId, myId]);
        } catch(e) {}
      } else if (finalRelation === 'Sibling') {
        const rel1 = `rel_${Date.now()}_${Math.random().toString(36).substr(2,3)}`;
        const rel2 = `rel_${Date.now()+1}_${Math.random().toString(36).substr(2,3)}`;
        try {
          await conn.execute(`INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type) VALUES (?,?,?,?), (?,?,?,?)`, [rel1, myId, finalId, 'Sibling', rel2, finalId, myId, 'Sibling']);
        } catch(e) {
          await conn.execute(`INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?), (?,?,?,?,?)`, [rel1, myId, finalId, 'Sibling', null, rel2, finalId, myId, 'Sibling', null]);
        }
      }
    }
    await conn.commit();
    res.json({ success: true, id: finalId, father_id: newFatherId, mother_id: newMotherId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

app.get('/api/relations', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { owner_profile_id } = req.query;
    if (!owner_profile_id) return res.json([]);
    const [rows] = await pool.query('SELECT * FROM profile_relations WHERE owner_profile_id =?', [owner_profile_id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/relations', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { id, owner_profile_id, related_profile_id, relation_type, spouse_group } = req.body;
    const finalId = id || `rel_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
    if (!owner_profile_id ||!related_profile_id ||!relation_type) return res.status(400).json({ error: "owner_profile_id, related_profile_id, relation_type required" });
    await pool.execute("INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?)", [finalId, owner_profile_id, related_profile_id, relation_type, spouse_group || null]);
    res.json({ success: true, id: finalId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const profileId = req.query.profileId || req.body?.profileId || req.query.id || req.body?.id;
    if (!profileId) return res.status(400).json({ error: "profileId missing! Call /api/upload?profileId=YOUR_PROFILE_ID" });
    const safeName = req.file.originalname.replace(/\s+/g, '-');
    const key = `avatars/${profileId}/${safeName}`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, Body: req.file.buffer, ContentType: req.file.mimetype || 'image/jpeg' }));
    const host = `${req.protocol}://${req.get('host')}`;
    const publicUrl = `${host}/api/files/${key}`;
    if (pool) await pool.execute("UPDATE profiles SET photo_url=? WHERE id=?", [publicUrl, profileId]);
    res.json({ success: true, url: publicUrl, key: key, folder: profileId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/files/*', async (req, res) => {
  try {
    const key = req.params[0];
    const data = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    res.setHeader('Content-Type', data.ContentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    data.Body.pipe(res);
  } catch (err) { res.status(404).json({ error: "File not found", details: err.message }); }
});

const frontendPath = path.join(__dirname, 'dist');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API route not found: ' + req.path });
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.json({ status: 'ok', message: 'Backend Running - dist not found' }));
}

app.listen(PORT, '0.0.0.0', () => console.log(`✅ Running on ${PORT}`));