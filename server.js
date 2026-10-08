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
    pool.getConnection().then(async c => {
      console.log("✅ DB Connected!");
      c.release();
      try {
        await pool.query(`CREATE TABLE IF NOT EXISTS profile_groups (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          image_url TEXT,
          owner_user_id VARCHAR(255),
          invite_code VARCHAR(20),
          member_count INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS group_members (
          id VARCHAR(255) PRIMARY KEY,
          group_id VARCHAR(255),
          profile_id VARCHAR(255),
          owner_user_id VARCHAR(255),
          role VARCHAR(50) DEFAULT 'member',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_group_profile (group_id, profile_id)
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS chatbox (
          user_id VARCHAR(255) PRIMARY KEY,
          display_name VARCHAR(255),
          last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          is_online TINYINT(1) DEFAULT 1,
          current_page VARCHAR(255) DEFAULT 'deck'
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
          id VARCHAR(255) PRIMARY KEY,
          to_user_id VARCHAR(255),
          from_user_id VARCHAR(255),
          from_name VARCHAR(255),
          title VARCHAR(255),
          body TEXT,
          type VARCHAR(50) DEFAULT 'chat',
          is_read TINYINT(1) DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_to_user (to_user_id, is_read)
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS direct_messages (
          id VARCHAR(255) PRIMARY KEY,
          sender_id VARCHAR(255),
          sender_name VARCHAR(255),
          direct_to VARCHAR(255),
          text TEXT,
          type VARCHAR(50) DEFAULT 'text',
          file_name VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_chat (sender_id, direct_to, created_at)
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS group_messages (
          id VARCHAR(255) PRIMARY KEY,
          sender_id VARCHAR(255),
          sender_name VARCHAR(255),
          group_id VARCHAR(255),
          text TEXT,
          type VARCHAR(50) DEFAULT 'text',
          file_name VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_group (group_id, created_at)
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS video_calls (
          id VARCHAR(255) PRIMARY KEY,
          caller_id VARCHAR(255),
          caller_name VARCHAR(255),
          receiver_id VARCHAR(255),
          status ENUM('ringing','accepted','rejected','ended') DEFAULT 'ringing',
          sdp_offer TEXT,
          sdp_answer TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_receiver (receiver_id, status)
        )`);
        await pool.query(`ALTER TABLE profiles ADD COLUMN category VARCHAR(10) DEFAULT 'Fml'`).catch(()=>{});
        // Indexes for merge speed
        await pool.query(`CREATE INDEX idx_rel_owner ON profile_relations(owner_profile_id)`).catch(()=>{});
        await pool.query(`CREATE INDEX idx_rel_related ON profile_relations(related_profile_id)`).catch(()=>{});
        await pool.query(`CREATE INDEX idx_profiles_father ON profiles(father_id)`).catch(()=>{});
        await pool.query(`CREATE INDEX idx_profiles_mother ON profiles(mother_id)`).catch(()=>{});
        console.log("✅ Tables + Indexes ready");
      } catch(e){ console.log("table init:", e.message); }
    }).catch(err => console.error("❌ DB Failed:", err.message));
  } catch (err) { console.error("Pool error:", err.message); }
}

const BUCKET_NAME = process.env.RAILWAY_BUCKET_NAME || process.env.BUCKET_NAME || "clandeckbucket-kbeh97nv8b";
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
});

const upload = multer({ storage: multer.memoryStorage() });

// ================== FAMILY MERGE BFS HELPER - THIS FIXES NIRMAL+ARUN MERGE ==================
function getConnectedFamily(startId, allProfiles, allRelations) {
  if (!startId) return [];
  const profileMap = new Map(allProfiles.map(p => [p.id, p]));
  const childrenByParent = new Map();
  for (const p of allProfiles) {
    if (p.father_id) {
      if (!childrenByParent.has(p.father_id)) childrenByParent.set(p.father_id, []);
      childrenByParent.get(p.father_id).push(p.id);
    }
    if (p.mother_id) {
      if (!childrenByParent.has(p.mother_id)) childrenByParent.set(p.mother_id, []);
      childrenByParent.get(p.mother_id).push(p.id);
    }
  }
  const relAdj = new Map();
  for (const r of allRelations) {
    if (!relAdj.has(r.owner_profile_id)) relAdj.set(r.owner_profile_id, []);
    relAdj.get(r.owner_profile_id).push(r.related_profile_id);
    if (!relAdj.has(r.related_profile_id)) relAdj.set(r.related_profile_id, []);
    relAdj.get(r.related_profile_id).push(r.owner_profile_id);
  }

  const visited = new Set([startId]);
  const queue = [startId];

  while (queue.length > 0) {
    const curr = queue.shift();
    const currProf = profileMap.get(curr);

    // Parents
    if (currProf?.father_id &&!visited.has(currProf.father_id)) { visited.add(currProf.father_id); queue.push(currProf.father_id); }
    if (currProf?.mother_id &&!visited.has(currProf.mother_id)) { visited.add(currProf.mother_id); queue.push(currProf.mother_id); }

    // Children
    const childs = childrenByParent.get(curr) || [];
    for (const chId of childs) { if (!visited.has(chId)) { visited.add(chId); queue.push(chId); } }

    // Spouse / Sibling via relations table
    const rels = relAdj.get(curr) || [];
    for (const relId of rels) { if (!visited.has(relId)) { visited.add(relId); queue.push(relId); } }
  }

  return allProfiles.filter(p => visited.has(p.id));
}

function computeRelationLabel(self, target, allRelations) {
  if (target.id === self.id) return 'Self';
  if (target.id === self.father_id) return 'Father';
  if (target.id === self.mother_id) return 'Mother';
  if (target.father_id === self.id || target.mother_id === self.id) return 'Child';
  const isSpouse = allRelations.some(r =>
    (r.owner_profile_id === self.id && r.related_profile_id === target.id && r.relation_type === 'Spouse') ||
    (r.related_profile_id === self.id && r.owner_profile_id === target.id && r.relation_type === 'Spouse')
  );
  if (isSpouse) return 'Spouse';
  const isSibling = allRelations.some(r =>
    (r.owner_profile_id === self.id && r.related_profile_id === target.id && r.relation_type === 'Sibling')
  ) || (self.father_id && self.father_id === target.father_id) || (self.mother_id && self.mother_id === target.mother_id);
  if (isSibling && target.id!== self.id) {
    if (target.father_id === self.father_id && self.father_id) return 'Sibling';
    if (target.mother_id === self.mother_id && self.mother_id) return 'Sibling';
    const sibRel = allRelations.some(r => r.relation_type === 'Sibling' && ((r.owner_profile_id === self.id && r.related_profile_id === target.id) || (r.owner_profile_id === target.id && r.related_profile_id === self.id)));
    if (sibRel) return 'Sibling';
  }
  if (target.father_id === self.father_id && target.mother_id === self.mother_id && self.father_id) return 'Sibling';
  return 'Extended Family';
}

app.get('/api', (req, res) => res.json({ status: 'ok', message: 'Clandeck Backend Running!' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', db: pool? 'pool exists' : 'no pool', bucket: BUCKET_NAME }));

// === HEARTBEAT ===
app.post('/api/chatbox/heartbeat', async (req,res)=>{
  if(!pool) return res.status(500).json({error:"DB not connected"});
  try{
    const {userId, displayName} = req.body;
    if(!userId) return res.status(400).json({error:"userId required"});
    await pool.query(`INSERT INTO chatbox (user_id, display_name, last_seen, is_online) VALUES (?,?,NOW(),1) ON DUPLICATE KEY UPDATE last_seen=NOW(), is_online=1, display_name=COALESCE(?, display_name)`, [userId, displayName||userId, displayName||userId]);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/chatbox/offline', async (req,res)=>{
  if(!pool) return res.status(500).json({error:"DB not connected"});
  try{
    const {userId} = req.body;
    if(!userId) return res.json({ok:true});
    await pool.query(`UPDATE chatbox SET is_online=0, last_seen=NOW() WHERE user_id=?`, [userId]);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/chatbox/online', async (req,res)=>{
  if(!pool) return res.status(500).json({error:"DB not connected"});
  try{
    await pool.query(`UPDATE chatbox SET is_online=0 WHERE last_seen < NOW() - INTERVAL 120 SECOND`);
    const [rows] = await pool.query(`SELECT user_id FROM chatbox WHERE last_seen >= NOW() - INTERVAL 120 SECOND AND is_online=1`);
    res.json(rows.map(r=>r.user_id));
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/call/request', async (req,res)=>{
  if(!pool) return res.status(500).json({error:"DB not connected"});
  try{
    const {caller_id, caller_name, receiver_id, sdp_offer} = req.body;
    const id = `call_${Date.now()}_${Math.random().toString(36).substr(2,4)}`;
    await pool.query(`INSERT INTO video_calls (id, caller_id, caller_name, receiver_id, status, sdp_offer) VALUES (?,?,?,?, 'ringing',?)`, [id, caller_id, caller_name, receiver_id, sdp_offer||null]);
    const nId = `ntf_${Date.now()}_call`;
    await pool.query(`INSERT INTO notifications (id, to_user_id, from_user_id, from_name, title, body, type) VALUES (?,?,?,?,?,?, 'video_call')`, [nId, receiver_id, caller_id, caller_name, 'Incoming video call', `${caller_name} is calling you`]);
    res.json({ok:true, callId:id});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/call/incoming/:userId', async (req,res)=>{
  if(!pool) return res.status(500).json({error:"DB not connected"});
  try{
    const [rows] = await pool.query(`SELECT * FROM video_calls WHERE receiver_id=? AND status='ringing' AND created_at >= NOW() - INTERVAL 60 SECOND ORDER BY created_at DESC LIMIT 1`, [req.params.userId]);
    res.json(rows[0]||null);
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/call/:callId', async (req,res)=>{
  if(!pool) return res.status(500).json({error:"DB not connected"});
  try{
    const [rows] = await pool.query(`SELECT * FROM video_calls WHERE id=?`, [req.params.callId]);
    res.json(rows[0]||null);
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/call/accept', async (req,res)=>{
  if(!pool) return res.status(500).json({error:"DB not connected"});
  try{
    const {callId, sdp_answer} = req.body;
    await pool.query(`UPDATE video_calls SET status='accepted', sdp_answer=? WHERE id=?`, [sdp_answer||null, callId]);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/call/reject', async (req,res)=>{
  if(!pool) return res.status(500).json({error:"DB not connected"});
  try{
    const {callId} = req.body;
    await pool.query(`UPDATE video_calls SET status='rejected' WHERE id=?`, [callId]);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/call/end', async (req,res)=>{
  if(!pool) return res.status(500).json({error:"DB not connected"});
  try{
    const {callId} = req.body;
    await pool.query(`UPDATE video_calls SET status='ended' WHERE id=?`, [callId]);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/chatbox/notify', async (req,res)=>{
  if(!pool) return res.status(500).json({error:"DB not connected"});
  try{
    const {to_user_id, from_user_id, from_name, title, body} = req.body;
    const [online] = await pool.query(`SELECT user_id FROM chatbox WHERE user_id=? AND last_seen >= NOW() - INTERVAL 120 SECOND`, [to_user_id]);
    if(online.length===0){
      const id = `ntf_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
      await pool.query(`INSERT INTO notifications (id, to_user_id, from_user_id, from_name, title, body, type) VALUES (?,?,?,?,?,?, 'chat')`, [id, to_user_id, from_user_id, from_name, title||`You have chat from ${from_name}`, body]);
    }
    res.json({notified: online.length===0});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/notifications/:userId', async (req,res)=>{
  if(!pool) return res.status(500).json({error:"DB not connected"});
  try{
    const [rows] = await pool.query(`SELECT * FROM notifications WHERE to_user_id=? ORDER BY created_at DESC LIMIT 50`, [req.params.userId]);
    res.json(rows);
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/chat/send', async (req,res)=>{
  if(!pool) return res.status(500).json({error:"DB not connected"});
  try{
    const {sender_id, sender_name, text, type, direct_to, group_id, fileName} = req.body;
    const id = `msg_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
    if(group_id){
      await pool.query(`INSERT INTO group_messages (id, sender_id, sender_name, group_id, text, type, file_name) VALUES (?,?,?,?,?,?,?)`, [id, sender_id, sender_name, group_id, text, type||'text', fileName||null]);
    }else{
      await pool.query(`INSERT INTO direct_messages (id, sender_id, sender_name, direct_to, text, type, file_name) VALUES (?,?,?,?,?,?,?)`, [id, sender_id, sender_name, direct_to, text, type||'text', fileName||null]);
    }
    res.json({ok:true, id});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/chat/direct', async (req,res)=>{
  if(!pool) return res.status(500).json({error:"DB not connected"});
  try{
    const {user1, user2} = req.query;
    if(!user1 ||!user2) return res.json([]);
    const [rows] = await pool.query(`SELECT * FROM direct_messages WHERE (sender_id=? AND direct_to=?) OR (sender_id=? AND direct_to=?) ORDER BY created_at ASC LIMIT 200`, [user1, user2, user2, user1]);
    res.json(rows);
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/chat/group/:groupId', async (req,res)=>{
  if(!pool) return res.status(500).json({error:"DB not connected"});
  try{
    const [rows] = await pool.query(`SELECT * FROM group_messages WHERE group_id=? ORDER BY created_at ASC LIMIT 200`, [req.params.groupId]);
    res.json(rows);
  }catch(e){ res.status(500).json({error:e.message}); }
});
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
      } catch (chkErr) { console.log("ownership check skip:", chkErr.message); }
    }
    await pool.execute("INSERT INTO users (id, name, email, uname, password, status, invited_by_user_id, shared_profile_id, is_temp) VALUES (?,?,?,?,?,?,?,?,?)", [id, name, email || finalUname, finalUname, password || 'pw1234', 'active', invited_by_user_id, profile_id || null, 1]);
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
    res.status(500).json({error: e.message});
  } finally { conn.release(); }
});
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
app.get('/api/basket/:userId', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { userId } = req.params;
    try { await pool.query("ALTER TABLE profiles ADD COLUMN created_by_user_id VARCHAR(255)"); } catch(e) {}
    try { await pool.query("ALTER TABLE profiles ADD COLUMN is_claimed TINYINT DEFAULT 0"); } catch(e) {}
    try { await pool.query("ALTER TABLE profiles ADD COLUMN owner_user_id VARCHAR(255)"); } catch(e) {}
    const [totalRows] = await pool.query(`SELECT COUNT(*) as total FROM profiles WHERE (created_by_user_id=? OR (created_by_user_id IS NULL AND owner_user_id=?)) AND id!=?`, [userId, userId, userId]);
    const [claimedRows] = await pool.query(`SELECT COUNT(*) as claimed FROM profiles WHERE (created_by_user_id=? OR (created_by_user_id IS NULL AND owner_user_id=?)) AND is_claimed=1 AND id!=?`, [userId, userId, userId]);
    const [unclaimedRows] = await pool.query(`SELECT COUNT(*) as unclaimed FROM profiles WHERE (created_by_user_id=? OR (created_by_user_id IS NULL AND owner_user_id=?)) AND (is_claimed=0 OR is_claimed IS NULL) AND id!=?`, [userId, userId, userId]);
    res.json({ userId, totalCreated: totalRows[0]?.total || 0, claimed: claimedRows[0]?.claimed || 0, unclaimed: unclaimedRows[0]?.unclaimed || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
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

// --- FIXED #1 & #2: FAMILY MERGE LOGIC ---
app.get('/api/profiles', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { owner_user_id, search, father_id, mother_id, id } = req.query;
    if (father_id) {
      const [rows] = await pool.query('SELECT * FROM profiles WHERE father_id =?', [father_id]);
      return res.json(rows);
    }
    if (mother_id) {
      const [rows] = await pool.query('SELECT * FROM profiles WHERE mother_id =?', [mother_id]);
      return res.json(rows);
    }
    if (id) {
      const [rows] = await pool.query('SELECT * FROM profiles WHERE id =?', [id]);
      return res.json(rows[0] || {});
    }
    if (search && search.trim().length > 0) {
      const s = search.trim().toLowerCase();
      const likeAny = `%${s}%`;
      const likeStart = `${s}%`;
      const [rows] = await pool.query(`SELECT * FROM profiles WHERE LOWER(display_name) LIKE? ORDER BY CASE WHEN LOWER(display_name) LIKE? THEN 0 ELSE 1 END, display_name ASC LIMIT 30`, [likeAny, likeStart]);
      if (owner_user_id) {
        const owned = rows.filter(r => r.owner_user_id === owner_user_id);
        const others = rows.filter(r => r.owner_user_id!== owner_user_id);
        return res.json([...owned,...others].slice(0,30));
      }
      return res.json(rows);
    }
    if (!owner_user_id) {
      const [all] = await pool.query('SELECT * FROM profiles LIMIT 500');
      return res.json(all);
    }
    // --- MAIN LOGIC FOR DECK ---
    const [allProfiles] = await pool.query('SELECT * FROM profiles WHERE owner_user_id =? LIMIT 1000', [owner_user_id]);
    let self = allProfiles.find(p => p.id === owner_user_id);
    if (!self && allProfiles.length > 0) {
      // fallback: find claimed self
      const [sRows] = await pool.query('SELECT * FROM profiles WHERE id=?', [owner_user_id]);
      self = sRows[0];
    }
    if (!self) return res.json(allProfiles);

    // Fetch all relations for these profiles
    const profileIds = allProfiles.map(p => p.id);
    let allRelations = [];
    if (profileIds.length > 0) {
      const placeholders = profileIds.map(() => '?').join(',');
      const [rels] = await pool.query(`SELECT * FROM profile_relations WHERE owner_profile_id IN (${placeholders}) OR related_profile_id IN (${placeholders})`, [...profileIds,...profileIds]);
      allRelations = rels;
    }

    // If self is Friend category, return only immediate small circle
    if (self.category === 'Fnd') {
      const connected = getConnectedFamily(self.id, allProfiles, allRelations);
      return res.json(connected.map(p => ({...p, relation_label: computeRelationLabel(self, p, allRelations), computed_relation: computeRelationLabel(self, p, allRelations)})));
    }

    // NORMAL FAMILY: Full BFS merge - This merges Nirmal + Arun when sister marries Arun
    const connectedFamily = getConnectedFamily(self.id, allProfiles, allRelations);

    // Add Friends who are owned but not connected? Keep them separate? For now include only connected + friends as separate cards
    const result = connectedFamily.map(p => ({
     ...p,
      relation_label: computeRelationLabel(self, p, allRelations),
      computed_relation: computeRelationLabel(self, p, allRelations)
    }));

    // Add Friend profiles (category Fnd) that are owned but not part of family BFS - they show as Friend cards
    const friends = allProfiles.filter(p => p.category === 'Fnd' &&!connectedFamily.find(c => c.id === p.id));
    friends.forEach(f => result.push({...f, relation_label: 'Friend', computed_relation: 'Friend'}));

    res.json(result);
  } catch(e){ console.error(e); res.status(500).json({error: e.message}) }
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

    // Get all profiles of same owner to allow merge
    const ownerId = self.owner_user_id;
    const [allProfiles] = await pool.query('SELECT * FROM profiles WHERE owner_user_id=? LIMIT 1000', [ownerId]);
    const profileIds = allProfiles.map(p=>p.id);
    let allRelations = [];
    if (profileIds.length) {
      const placeholders = profileIds.map(()=> '?').join(',');
      const [rels] = await pool.query(`SELECT * FROM profile_relations WHERE owner_profile_id IN (${placeholders}) OR related_profile_id IN (${placeholders})`, [...profileIds,...profileIds]);
      allRelations = rels;
    }

    const connected = getConnectedFamily(profileId, allProfiles, allRelations);
    const result = connected.map(p => ({
     ...p,
      relation_label: computeRelationLabel(self, p, allRelations),
      computed_relation: computeRelationLabel(self, p, allRelations)
    }));
    res.json(result);
  } catch (e) {
    console.error('family-tree error', e.message);
    res.status(500).json({ error: e.message });
  }
});
app.put('/api/profiles/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { display_name, dob, photo_url, is_claimed, bio, location, gender, father_id, mother_id, category } = req.body;
    await pool.query(`UPDATE profiles SET display_name=COALESCE(?,display_name), dob=COALESCE(?,dob), photo_url=COALESCE(?,photo_url), is_claimed=COALESCE(?,is_claimed), bio=COALESCE(?,bio), location=COALESCE(?,location), gender=COALESCE(?,gender), father_id=COALESCE(?,father_id), mother_id=COALESCE(?,mother_id), category=COALESCE(?,category) WHERE id=?`, [display_name, dob, photo_url, is_claimed, bio, location, gender, father_id, mother_id, category, req.params.id]);
    res.json({ success: true });
  } catch(e){
    try {
      const { display_name, dob, photo_url, is_claimed, bio, location, gender, father_id, mother_id } = req.body;
      await pool.query(`UPDATE profiles SET display_name=COALESCE(?,display_name), dob=COALESCE(?,dob), photo_url=COALESCE(?,photo_url), is_claimed=COALESCE(?,is_claimed), bio=COALESCE(?,bio), location=COALESCE(?,location), gender=COALESCE(?,gender), father_id=COALESCE(?,father_id), mother_id=COALESCE(?,mother_id) WHERE id=?`, [display_name, dob, photo_url, is_claimed, bio, location, gender, father_id, mother_id, req.params.id]);
      res.json({ success: true });
    } catch(e2){ res.status(500).json({error: e.message}) }
  }
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
    const [linkedUsers] = await pool.query('SELECT id FROM users WHERE id=? OR shared_profile_id=?', [profileId, profileId]);
    await conn.query('DELETE FROM profile_relations WHERE related_profile_id=? OR owner_profile_id=?', [profileId, profileId]);
    try { await conn.query('DELETE FROM group_members WHERE profile_id=?', [profileId]); } catch(e) {}
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
    const { id, display_name, relation_label, relation, owner_user_id, my_profile_id, photo_url, dob, name, bio, location, gender, father_id, mother_id, category, group_ids } = req.body;
    const finalName = display_name || name;
    const finalId = id || `pr_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
    const finalRelation = relation || relation_label || 'Family';
    const myId = my_profile_id || null;
    let finalCategory = category || 'Fml';
    if (!['Fml','Fnd'].includes(finalCategory)) finalCategory = 'Fml';
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
        if (finalRelation === 'Child' && finalCategory === 'Fml') {
          if (me.gender === 'Male' || me.gender === null) { newFatherId = myId; newMotherId = mySpouseId; }
          else { newMotherId = myId; newFatherId = mySpouseId; }
        } else if (finalRelation === 'Sibling' && finalCategory === 'Fml') { newFatherId = me.father_id; newMotherId = me.mother_id; }
      }
    }
    try {
      await conn.execute(`INSERT INTO profiles (id, owner_user_id, display_name, dob, photo_url, is_claimed, created_by_user_id, bio, location, gender, father_id, mother_id, category) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [finalId, owner_user_id, finalName, dob || null, photo_url || null, 0, owner_user_id, bio || null, location || null, newGender, newFatherId, newMotherId, finalCategory]);
    } catch (catErr) {
      await conn.execute(`INSERT INTO profiles (id, owner_user_id, display_name, dob, photo_url, is_claimed, created_by_user_id, bio, location, gender, father_id, mother_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [finalId, owner_user_id, finalName, dob || null, photo_url || null, 0, owner_user_id, bio || null, location || null, newGender, newFatherId, newMotherId]);
    }
    if (group_ids && Array.isArray(group_ids) && group_ids.length > 0) {
      for (const gid of group_ids) {
        const gmId = `gm_${Date.now()}_${Math.random().toString(36).substr(2,5)}_${gid.substr(0,4)}`;
        try {
          await conn.execute(`INSERT INTO group_members (id, group_id, profile_id, owner_user_id, role) VALUES (?,?,?,?,?)`, [gmId, gid, finalId, owner_user_id, 'member']);
          await conn.execute(`UPDATE profile_groups SET member_count = (SELECT COUNT(*) FROM group_members WHERE group_id=?) WHERE id=?`, [gid, gid]);
        } catch(e) { console.log("group insert skip:", e.message); }
      }
    }
    if (me && finalCategory === 'Fml') {
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
    res.json({ success: true, id: finalId, father_id: newFatherId, mother_id: newMotherId, category: finalCategory });
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
app.get('/api/profile-groups', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { owner_user_id } = req.query;
    if (!owner_user_id) return res.status(400).json({ error: "owner_user_id required" });
    const [rows] = await pool.query('SELECT * FROM profile_groups WHERE owner_user_id=? ORDER BY created_at DESC', [owner_user_id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/profile-groups', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { id, name, description, owner_user_id, image_url } = req.body;
    if (!name ||!owner_user_id) return res.status(400).json({ error: "name and owner_user_id required" });
    const finalId = id || `grp_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
    const inviteCode = Math.random().toString(36).substr(2,6).toUpperCase();
    await pool.execute(`INSERT INTO profile_groups (id, name, description, image_url, owner_user_id, invite_code, member_count) VALUES (?,?,?,?,?,?,0)`, [finalId, name, description || null, image_url || null, owner_user_id, inviteCode]);
    res.json({ success: true, id: finalId, invite_code: inviteCode });
  } catch (err) {
    if (err.message.includes('Duplicate')) return res.status(400).json({ error: "Group name already exists" });
    res.status(500).json({ error: err.message });
  }
});
app.delete('/api/profile-groups/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    await pool.query("SET FOREIGN_KEY_CHECKS=0");
    await pool.query('DELETE FROM group_members WHERE group_id=?', [req.params.id]);
    await pool.query('DELETE FROM profile_groups WHERE id=?', [req.params.id]);
    await pool.query("SET FOREIGN_KEY_CHECKS=1");
    res.json({ success: true });
  } catch (err) {
    try { await pool.query("SET FOREIGN_KEY_CHECKS=1"); } catch {}
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/group-members', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { group_id, owner_user_id } = req.query;
    if (group_id) {
      const [rows] = await pool.query(`SELECT gm.*, p.display_name, p.photo_url, p.category, p.id as profile_id FROM group_members gm JOIN profiles p ON gm.profile_id = p.id WHERE gm.group_id=?`, [group_id]);
      return res.json(rows);
    }
    if (owner_user_id) {
      const [rows] = await pool.query(`SELECT p.*, GROUP_CONCAT(gm.group_id) as group_ids FROM profiles p LEFT JOIN group_members gm ON p.id = gm.profile_id WHERE p.owner_user_id=? GROUP BY p.id`, [owner_user_id]);
      return res.json(rows);
    }
    res.json([]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/group-members', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { group_id, profile_id, owner_user_id } = req.body;
    if (!group_id ||!profile_id ||!owner_user_id) return res.status(400).json({ error: "group_id, profile_id, owner_user_id required" });
    const gmId = `gm_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
    await pool.execute(`INSERT INTO group_members (id, group_id, profile_id, owner_user_id) VALUES (?,?,?,?)`, [gmId, group_id, profile_id, owner_user_id]);
    await pool.execute(`UPDATE profile_groups SET member_count = (SELECT COUNT(*) FROM group_members WHERE group_id=?) WHERE id=?`, [group_id, group_id]);
    res.json({ success: true, id: gmId });
  } catch (err) {
    if (err.message.includes('Duplicate')) return res.status(400).json({ error: "Already in group" });
    res.status(500).json({ error: err.message });
  }
});
app.delete('/api/group-members/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const [row] = await pool.query('SELECT group_id FROM group_members WHERE id=?', [req.params.id]);
    const groupId = row[0]?.group_id;
    await pool.query('DELETE FROM group_members WHERE id=?', [req.params.id]);
    if (groupId) await pool.query(`UPDATE profile_groups SET member_count = (SELECT COUNT(*) FROM group_members WHERE group_id=?) WHERE id=?`, [groupId, groupId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== UPLOAD LOGIC =====
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: `Avatar only allows images. Use /api/chat/upload/voice or /api/chat/upload/document for other files` });
    }
    const profileId = req.query.profileId || req.body?.profileId || req.query.id || req.body?.id;
    if (!profileId) return res.status(400).json({ error: "profileId missing!" });
    const safeName = req.file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.\-_]/g, '');
    const key = `avatars/${profileId}/${Date.now()}_${safeName}`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, Body: req.file.buffer, ContentType: req.file.mimetype || 'image/jpeg' }));
    const publicUrl = `/api/files/${key}`;
    if (pool) await pool.execute("UPDATE profiles SET photo_url=? WHERE id=?", [publicUrl, profileId]);
    res.json({ success: true, url: publicUrl, key: key, folder: profileId, type: 'avatar' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/chat/upload/voice', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const profileId = req.query.profileId || req.body?.profileId || req.query.userId || req.body?.userId;
    if (!profileId) return res.status(400).json({ error: "profileId missing!" });
    const safeName = req.file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.\-_]/g, '') || `voice_${Date.now()}.webm`;
    const key = `avatars/${profileId}/voice/${Date.now()}_${safeName}`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, Body: req.file.buffer, ContentType: req.file.mimetype || 'audio/webm' }));
    const publicUrl = `/api/files/${key}`;
    res.json({ success: true, url: publicUrl, key: key, folder: `${profileId}/voice`, type: 'voice' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/chat/upload/document', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const profileId = req.query.profileId || req.body?.profileId || req.query.userId || req.body?.userId;
    if (!profileId) return res.status(400).json({ error: "profileId missing!" });
    const safeName = req.file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.\-_]/g, '');
    const key = `avatars/${profileId}/documents/${Date.now()}_${safeName}`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, Body: req.file.buffer, ContentType: req.file.mimetype || 'application/octet-stream' }));
    const publicUrl = `/api/files/${key}`;
    res.json({ success: true, url: publicUrl, key: key, folder: `${profileId}/documents`, type: 'document' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/chat/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const profileId = req.query.profileId || req.body?.profileId || req.query.userId || req.body?.userId || 'anonymous';
    const safeName = req.file.originalname.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.\-_]/g, '') || `file_${Date.now()}`;
    const isVoice = req.file.mimetype.startsWith('audio/');
    const subFolder = isVoice? 'voice' : 'documents';
    const key = `avatars/${profileId}/${subFolder}/${Date.now()}_${safeName}`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, Body: req.file.buffer, ContentType: req.file.mimetype || 'application/octet-stream' }));
    const publicUrl = `/api/files/${key}`;
    res.json({ success: true, url: publicUrl, key: key, folder: `${profileId}/${subFolder}`, type: subFolder });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/files/*', async (req, res) => {
  try {
    const key = req.params[0];
    const data = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    res.setHeader('Content-Type', data.ContentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.setHeader('Access-Control-Allow-Origin', '*');
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

app.listen(PORT, '0.0.0.0', () => console.log(`✅ Running on ${PORT} - Family Merge Fixed`));