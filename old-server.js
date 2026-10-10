import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import multer from 'multer';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 8080;
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

let pool;
const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
if (!dbUrl) console.error("MYSQL_URL missing!");
else {
  pool = mysql.createPool(dbUrl);
  pool.getConnection().then(async c => {
    console.log("DB Connected!"); c.release();
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS profile_groups (id VARCHAR(255) PRIMARY KEY, name VARCHAR(255) NOT NULL, description TEXT, photo_url TEXT, owner_user_id VARCHAR(255), invite_code VARCHAR(20), member_count INT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS group_members (id VARCHAR(255) PRIMARY KEY, group_id VARCHAR(255), profile_id VARCHAR(255), owner_user_id VARCHAR(255), role VARCHAR(50) DEFAULT 'member', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY unique_group_profile (group_id, profile_id))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS chatbox (user_id VARCHAR(255) PRIMARY KEY, display_name VARCHAR(255), last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, is_online TINYINT(1) DEFAULT 1, current_page VARCHAR(255) DEFAULT 'deck')`);
      await pool.query(`CREATE TABLE IF NOT EXISTS notifications (id VARCHAR(255) PRIMARY KEY, to_user_id VARCHAR(255), from_user_id VARCHAR(255), from_name VARCHAR(255), title VARCHAR(255), body TEXT, type VARCHAR(50) DEFAULT 'chat', is_read TINYINT(1) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_to_user (to_user_id, is_read))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS direct_messages (id VARCHAR(255) PRIMARY KEY, sender_id VARCHAR(255), sender_name VARCHAR(255), direct_to VARCHAR(255), text TEXT, type VARCHAR(50) DEFAULT 'text', file_name VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_chat (sender_id, direct_to, created_at))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS group_messages (id VARCHAR(255) PRIMARY KEY, sender_id VARCHAR(255), sender_name VARCHAR(255), group_id VARCHAR(255), text TEXT, type VARCHAR(50) DEFAULT 'text', file_name VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_group (group_id, created_at))`);
      await pool.query(`CREATE TABLE IF NOT EXISTS video_calls (id VARCHAR(255) PRIMARY KEY, caller_id VARCHAR(255), caller_name VARCHAR(255), receiver_id VARCHAR(255), status ENUM('ringing','accepted','rejected','ended') DEFAULT 'ringing', sdp_offer TEXT, sdp_answer TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_receiver (receiver_id, status))`);
      await pool.query(`ALTER TABLE profiles ADD COLUMN category VARCHAR(10) DEFAULT 'Fml'`).catch(()=>{});
      await pool.query(`CREATE TABLE IF NOT EXISTS profile_relations (id VARCHAR(255) PRIMARY KEY, owner_profile_id VARCHAR(255), related_profile_id VARCHAR(255), relation_type VARCHAR(50), spouse_group VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_owner (owner_profile_id), INDEX idx_related (related_profile_id))`);
      await pool.query(`ALTER TABLE profile_relations MODIFY spouse_group VARCHAR(255) NULL`).catch(async ()=>{ await pool.query(`ALTER TABLE profile_relations MODIFY COLUMN spouse_group VARCHAR(255) NULL`).catch(()=>{}); });
      console.log("Tables ready");
    } catch(e){ console.log("init:", e.message); }
  }).catch(err => console.error("DB Failed:", err.message));
}

const BUCKET_NAME = process.env.RAILWAY_BUCKET_NAME || process.env.BUCKET_NAME || "clandeckbucket-kbeh97nv8b";
const s3 = new S3Client({ region: 'auto', endpoint: process.env.ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: process.env.ACCESS_KEY_ID, secretAccessKey: process.env.SECRET_ACCESS_KEY } });
const upload = multer({ storage: multer.memoryStorage() });

const genId = (prefix='') => `${prefix}${Date.now()}_${Math.random().toString(36).substring(2,8)}`;

app.get('/api', (req,res)=>res.json({status:'ok',message:'Clandeck Backend Running!'}));
app.get('/api/health', (req,res)=>res.json({status:'ok',db:pool?'pool exists':'no pool',bucket:BUCKET_NAME}));

app.post('/api/chatbox/heartbeat', async (req,res)=>{ if(!pool) return res.status(500).json({error:"DB not connected"}); try{ const {userId,displayName}=req.body; await pool.query(`INSERT INTO chatbox (user_id, display_name, last_seen, is_online) VALUES (?,?,NOW(),1) ON DUPLICATE KEY UPDATE last_seen=NOW(), is_online=1, display_name=COALESCE(?, display_name)`, [userId, displayName||userId, displayName||userId]); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});} });
app.post('/api/chatbox/offline', async (req,res)=>{ try{ const {userId}=req.body; await pool.query(`UPDATE chatbox SET is_online=0, last_seen=NOW() WHERE user_id=?`, [userId]); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});} });
app.get('/api/chatbox/online', async (req,res)=>{ try{ await pool.query(`UPDATE chatbox SET is_online=0 WHERE last_seen < NOW() - INTERVAL 120 SECOND`); const [rows]=await pool.query(`SELECT user_id FROM chatbox WHERE last_seen >= NOW() - INTERVAL 120 SECOND AND is_online=1`); res.json(rows.map(r=>r.user_id)); }catch(e){res.status(500).json({error:e.message});} });
app.post('/api/call/request', async (req,res)=>{ try{ const {caller_id,caller_name,receiver_id,sdp_offer}=req.body; const id=`call_${Date.now()}_${Math.random().toString(36).substr(2,4)}`; await pool.query(`INSERT INTO video_calls (id, caller_id, caller_name, receiver_id, status, sdp_offer) VALUES (?,?,?,?, 'ringing',?)`, [id, caller_id, caller_name, receiver_id, sdp_offer||null]); const nId=`ntf_${Date.now()}_call`; await pool.query(`INSERT INTO notifications (id, to_user_id, from_user_id, from_name, title, body, type) VALUES (?,?,?,?,?,?, 'video_call')`, [nId, receiver_id, caller_id, caller_name, 'Incoming video call', `${caller_name} is calling you`]); res.json({ok:true,callId:id}); }catch(e){res.status(500).json({error:e.message});} });
app.get('/api/call/incoming/:userId', async (req,res)=>{ try{ const [rows]=await pool.query(`SELECT * FROM video_calls WHERE receiver_id=? AND status='ringing' AND created_at >= NOW() - INTERVAL 60 SECOND ORDER BY created_at DESC LIMIT 1`, [req.params.userId]); res.json(rows[0]||null); }catch(e){res.status(500).json({error:e.message});} });
app.get('/api/call/:callId', async (req,res)=>{ try{ const [rows]=await pool.query(`SELECT * FROM video_calls WHERE id=?`, [req.params.callId]); res.json(rows[0]||null); }catch(e){res.status(500).json({error:e.message});} });
app.post('/api/call/accept', async (req,res)=>{ try{ const {callId,sdp_answer}=req.body; await pool.query(`UPDATE video_calls SET status='accepted', sdp_answer=? WHERE id=?`, [sdp_answer||null, callId]); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});} });
app.post('/api/call/reject', async (req,res)=>{ try{ await pool.query(`UPDATE video_calls SET status='rejected' WHERE id=?`, [req.body.callId]); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});} });
app.post('/api/call/end', async (req,res)=>{ try{ await pool.query(`UPDATE video_calls SET status='ended' WHERE id=?`, [req.body.callId]); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});} });
app.post('/api/chatbox/notify', async (req,res)=>{ try{ const {to_user_id,from_user_id,from_name,title,body}=req.body; const [online]=await pool.query(`SELECT user_id FROM chatbox WHERE user_id=? AND last_seen >= NOW() - INTERVAL 120 SECOND`, [to_user_id]); if(online.length===0){ const id=`ntf_${Date.now()}_${Math.random().toString(36).substr(2,5)}`; await pool.query(`INSERT INTO notifications (id, to_user_id, from_user_id, from_name, title, body, type) VALUES (?,?,?,?,?,?, 'chat')`, [id, to_user_id, from_user_id, from_name, title||`You have chat from ${from_name}`, body]); } res.json({notified: online.length===0}); }catch(e){res.status(500).json({error:e.message});} });
app.get('/api/notifications/:userId', async (req,res)=>{ try{ const [rows]=await pool.query(`SELECT * FROM notifications WHERE to_user_id=? ORDER BY created_at DESC LIMIT 50`, [req.params.userId]); res.json(rows); }catch(e){res.status(500).json({error:e.message});} });
app.post('/api/chat/send', async (req,res)=>{ try{ const {sender_id,sender_name,text,type,direct_to,group_id,fileName}=req.body; const id=`msg_${Date.now()}_${Math.random().toString(36).substr(2,5)}`; if(group_id) await pool.query(`INSERT INTO group_messages (id, sender_id, sender_name, group_id, text, type, file_name) VALUES (?,?,?,?,?,?,?)`, [id, sender_id, sender_name, group_id, text, type||'text', fileName||null]); else await pool.query(`INSERT INTO direct_messages (id, sender_id, sender_name, direct_to, text, type, file_name) VALUES (?,?,?,?,?,?,?)`, [id, sender_id, sender_name, direct_to, text, type||'text', fileName||null]); res.json({ok:true,id}); }catch(e){res.status(500).json({error:e.message});} });
app.get('/api/chat/direct', async (req,res)=>{ try{ const {user1,user2}=req.query; const [rows]=await pool.query(`SELECT * FROM direct_messages WHERE (sender_id=? AND direct_to=?) OR (sender_id=? AND direct_to=?) ORDER BY created_at ASC LIMIT 200`, [user1, user2, user2, user1]); res.json(rows); }catch(e){res.status(500).json({error:e.message});} });
app.get('/api/chat/group/:groupId', async (req,res)=>{ try{ const [rows]=await pool.query(`SELECT * FROM group_messages WHERE group_id=? ORDER BY created_at ASC LIMIT 200`, [req.params.groupId]); res.json(rows); }catch(e){res.status(500).json({error:e.message});} });

app.post('/api/register', async (req,res)=>{ const {id,name,email,password,uname}=req.body; const finalUname=uname||email; try{ await pool.execute("INSERT INTO users (id, name, email, uname, password, status) VALUES (?,?,?,?,?,?)", [id,name,email||finalUname,finalUname,password,'active']); res.json({message:"User created!",id}); }catch(err){res.status(400).json({error:err.message});} });

app.post('/api/share-temp-user', async (req,res)=>{
  const {id,name,email,password,profile_id,invited_by_user_id,uname,allowUpdate}=req.body;
  const finalUname=uname||email;
  try{
    try{ await pool.query("ALTER TABLE users ADD COLUMN uname VARCHAR(255)")}catch{}
    try{ await pool.query("ALTER TABLE users ADD COLUMN invited_by_user_id VARCHAR(255)")}catch{}
    try{ await pool.query("ALTER TABLE users ADD COLUMN shared_profile_id VARCHAR(255)")}catch{}
    try{ await pool.query("ALTER TABLE users ADD COLUMN is_temp TINYINT DEFAULT 0")}catch{}

    if(profile_id){
      const [pRows]=await pool.query("SELECT id, display_name, owner_user_id, is_claimed FROM profiles WHERE id=?", [profile_id]);
      const p=pRows[0];
      if(p){
        const alreadyClaimed = String(p.id) === String(p.owner_user_id) || Number(p.is_claimed) === 1;
        if(alreadyClaimed){
          return res.status(403).json({error: `${p.display_name} already accepted ownership`});
        }
      }
    }

    await pool.execute("INSERT INTO users (id, name, email, uname, password, status, invited_by_user_id, shared_profile_id, is_temp) VALUES (?,?,?,?,?,?,?,?,?)", [id,name,email||finalUname,finalUname,password||'pw1234','active',invited_by_user_id,profile_id||null,1]);
    res.json({success:true,username:finalUname,password:password||'pw1234'});
  }catch(err){
    if(err.message.includes('Duplicate')){
      try{
        await pool.execute("UPDATE users SET password=?, invited_by_user_id=?, shared_profile_id=?, uname=? WHERE email=? OR uname=? OR shared_profile_id=?", [password||'pw1234',invited_by_user_id,profile_id||null,finalUname,email,finalUname,profile_id]);
        return res.json({success:true,username:finalUname,password:password||'pw1234',reused:true, updated:true});
      }catch(e2){ return res.status(500).json({error:e2.message}); }
    }
    res.status(500).json({error:err.message});
  }
});

app.post('/api/login', async (req,res)=>{
  const {email,password,uname}=req.body; const loginId=uname||email;
  try{
    const [rows]=await pool.execute("SELECT id, name, email, uname, shared_profile_id, is_temp FROM users WHERE (uname=? OR email=?) AND password=?", [loginId,loginId,password]);
    if(rows.length===0) return res.status(400).json({error:"Wrong username or password"});
    res.json({message:"Login success", id:rows[0].id, name:rows[0].name, email:rows[0].email, uname:rows[0].uname, shared_profile_id:rows[0].shared_profile_id, is_temp:rows[0].is_temp, token:"token-"+rows[0].id});
  }catch(err){ res.status(500).json({error:"DB Error: "+err.message}); }
});

app.post('/api/claim-account', async (req,res)=>{
  const {userId,newUname,newPassword}=req.body;
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction(); await conn.query("SET FOREIGN_KEY_CHECKS=0");
    const [rows]=await conn.query("SELECT id, shared_profile_id FROM users WHERE id=?", [userId]);
    if(rows.length===0) throw new Error("User not found");
    const sharedProfileId=rows[0].shared_profile_id;
    if(!sharedProfileId) throw new Error("No shared_profile_id");
    if(rows[0].id===sharedProfileId){ await conn.query("SET FOREIGN_KEY_CHECKS=1"); await conn.rollback(); return res.json({success:true,id:rows[0].id,message:"Already claimed"}); }
    const newId=sharedProfileId;
    const [unameCheck]=await conn.query("SELECT id FROM users WHERE uname=? AND id!=?", [newUname, userId]);
    if(unameCheck.length>0) throw new Error("Username already taken");
    await conn.query("UPDATE users SET id=?, uname=?, email=?, password=?, is_temp=0, shared_profile_id=NULL WHERE id=?", [newId,newUname,newUname,newPassword,userId]);
    await conn.query("UPDATE profiles SET owner_user_id=?, is_claimed=1 WHERE id=?", [newId, sharedProfileId]);
    await conn.query("SET FOREIGN_KEY_CHECKS=1"); await conn.commit();
    res.json({success:true,id:newId,uname:newUname});
  }catch(e){ try{await conn.query("SET FOREIGN_KEY_CHECKS=1");}catch{} await conn.rollback(); res.status(500).json({error:e.message}); }finally{ conn.release(); }
});
app.get('/api/users', async (req,res)=>{ try{ const [rows]=await pool.query("SELECT * FROM users"); res.json(rows); }catch(e){res.status(500).json({error:e.message});} });
app.get('/api/users/:id', async (req,res)=>{ try{ const [rows]=await pool.query("SELECT * FROM profiles WHERE id=?", [req.params.id]); res.json(rows[0]||null); }catch(e){res.status(500).json({error:e.message});} });
app.put('/api/users/:id', async (req,res)=>{ try{ const {name,email}=req.body; await pool.query("UPDATE users SET name=?, email=? WHERE id=?", [name,email,req.params.id]); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});} });
app.get('/api/basket/:userId', async (req,res)=>{ try{ const [rows]=await pool.query("SELECT COUNT(*) as count FROM profiles WHERE owner_user_id=?", [req.params.userId]); const [claimRows]=await pool.query("SELECT COUNT(*) as claimed FROM profiles WHERE owner_user_id=?", [req.params.userId]); res.json({count: rows[0]?.count||0, claimed: claimRows[0]?.claimed||0}); }catch(e){ res.json({count:0, claimed:0}); } });

app.get('/api/profiles', async (req,res)=>{
  try{
    const {owner_user_id, group_id, category, search}=req.query;
    let sql="SELECT * FROM profiles WHERE 1=1"; let params=[];
    if(owner_user_id){ sql+=" AND owner_user_id=?"; params.push(owner_user_id); }
    if(category){ sql+=" AND category=?"; params.push(category); }
    if(search){ sql+=" AND (display_name LIKE? OR id LIKE? )"; params.push(`%${search}%`, `%${search}%`); }
    if(group_id){ sql=`SELECT p.* FROM profiles p JOIN group_members gm ON p.id=gm.profile_id WHERE gm.group_id=?`; params=[group_id]; if(owner_user_id){ sql+=" AND p.owner_user_id=?"; params.push(owner_user_id); } }
    const [rows]=await pool.query(sql, params);
    res.json(rows);
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/profiles/:id', async (req,res)=>{ try{ const [rows]=await pool.query("SELECT * FROM profiles WHERE id=?", [req.params.id]); res.json(rows[0]||null); }catch(e){res.status(500).json({error:e.message});} });

app.get('/api/family-tree/:profileId', async (req,res)=>{
  try{
    const rootId=req.params.profileId;
    if(!rootId) return res.json([]);
    const [rows]=await pool.query("SELECT * FROM profiles WHERE id=?", [rootId]);
    const root = rows[0];
    if(!root) return res.json([]);
    if(root.category === 'Fnd'){
      return res.json([{...root, computed_relation:'Self'}]);
    }
    const ownerId = root.owner_user_id || rootId;
    const [allProfiles]=await pool.query("SELECT * FROM profiles WHERE owner_user_id=? OR id=?", [ownerId, rootId]);
    let allRelations=[];
    try{ const [rel]=await pool.query("SELECT * FROM profile_relations WHERE owner_profile_id=? OR related_profile_id=?", [rootId, rootId]); allRelations=rel; }catch{}
    const map=new Map(allProfiles.map(p=>[p.id, {...p}]));
    if(!map.has(rootId)) map.set(rootId, root);
    const result=[]; const seen=new Set();
    const add=(p, rel)=>{
      if(!p || seen.has(p.id)) return;
      seen.add(p.id);
      result.push({...p, computed_relation: rel || 'Family'});
    };
    add(map.get(rootId), 'Self');
    if(root.father_id && map.has(root.father_id)) add(map.get(root.father_id), 'Father');
    if(root.mother_id && map.has(root.mother_id)) add(map.get(root.mother_id), 'Mother');
    // FIX: parents from profile_relations Child rows
    allRelations.forEach(r=>{
      const t=(r.relation_type||r.type||'').toLowerCase();
      if(t==='child' && r.related_profile_id===rootId){
        const parentId=r.owner_profile_id;
        if(map.has(parentId)){
          const p=map.get(parentId);
          const relName = p.gender==='Female'? 'Mother' : p.gender==='Male'? 'Father' : 'Parent';
          add(p, relName);
        }
      }
    });
    allProfiles.forEach(p=>{
      if(p.id===rootId) return;
      if(root.father_id && p.father_id===root.father_id) add(p, 'Sibling');
      else if(root.mother_id && p.mother_id===root.mother_id) add(p, 'Sibling');
    });
    allProfiles.forEach(p=>{
      if(p.father_id===rootId || p.mother_id===rootId) add(p, 'Child');
    });
    allRelations.forEach(r=>{
      const t=(r.relation_type||r.type||'').toLowerCase();
      if(t.includes('spouse')){
        const otherId=r.owner_profile_id===rootId? r.related_profile_id : r.owner_profile_id;
        if(map.has(otherId)) add(map.get(otherId), 'Spouse');
      }
    });
    return res.json(result.length? result : [{...root, computed_relation:'Self'}]);
  }catch(e){
    console.error('family-tree error', e.message);
    return res.json([]);
  }
});

// FIXED PUT - WHITELIST ONLY REAL COLUMNS - FIXES Save failed on rename
app.put('/api/profiles/:id', async (req,res)=>{
  try{
    const allowed = ['display_name','owner_user_id','gender','dob','photo_url','category','location','bio','father_id','mother_id','is_claimed','created_by_user_id'];
    const fields = req.body;
    const updates = {};
    for(const k of allowed){
      if(k in fields && fields[k]!== undefined){
        updates[k] = fields[k];
      }
    }
    // support frontend sending 'name' instead of display_name
    if(!updates.display_name && fields.name) updates.display_name = fields.name;
    if(Object.keys(updates).length===0) return res.json({ok:true, message:'nothing to update'});

    const sets = Object.keys(updates).map(k=>`${k}=?`).join(',');
    const vals = Object.values(updates);
    vals.push(req.params.id);
    await pool.query(`UPDATE profiles SET ${sets} WHERE id=?`, vals);
    res.json({ok:true});
  }catch(e){
    console.error("PUT /api/profiles error:", e.message);
    res.status(500).json({error:e.message});
  }
});

app.post('/api/profiles', async (req,res)=>{
  try{
    const {id, display_name, owner_user_id, gender, dob, photo_url, category, group_ids, father_id, mother_id, location, bio, is_claimed, created_by_user_id, my_profile_id, relation, spouse_id} = req.body;
    if(!display_name) return res.status(400).json({error:"display_name required"});
    const finalId = id && String(id).trim()!== ''? String(id).trim() : genId('prof_');
    let finalOwner = owner_user_id && String(owner_user_id).trim()!== ''? String(owner_user_id).trim() : null;
    let finalFather = father_id || null;
    let finalMother = mother_id || null;
    let targetProfile = null;

    if(my_profile_id){
      const [tRows]=await pool.query("SELECT * FROM profiles WHERE id=?", [my_profile_id]);
      targetProfile = tRows[0];
      if(targetProfile){
        if(!finalOwner) finalOwner = targetProfile.owner_user_id || owner_user_id || targetProfile.id;
        const rel = String(relation||'').toLowerCase();
        if(rel==='sibling'){
          finalFather = targetProfile.father_id || null;
          finalMother = targetProfile.mother_id || null;
        } else if(rel==='child'){
          if(spouse_id){
            const [spRows]=await pool.query("SELECT * FROM profiles WHERE id=?", [spouse_id]);
            const sp = spRows[0];
            if(sp){
              if(targetProfile.gender==='Male' || (targetProfile.gender!=='Female' && sp.gender==='Female')){
                finalFather = targetProfile.id;
                finalMother = sp.id;
              } else {
                finalFather = sp.id;
                finalMother = targetProfile.id;
              }
            } else {
              finalFather = targetProfile.id;
            }
          } else {
            if(targetProfile.gender==='Female') finalMother = targetProfile.id;
            else finalFather = targetProfile.id;
          }
        }
      }
    }

    if(!finalOwner) finalOwner = finalId;
    const cat = category||'Fml';
    await pool.query(
      "INSERT INTO profiles (id, display_name, owner_user_id, gender, dob, photo_url, category, location, bio, father_id, mother_id, is_claimed, created_by_user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())",
      [finalId, display_name, finalOwner, gender||null, dob||null, photo_url||null, cat, location||null, bio||null, finalFather, finalMother, is_claimed||0, created_by_user_id||finalOwner]
    );

    if(targetProfile && relation){
      const rel = String(relation).toLowerCase();
      if(rel==='father'){
        await pool.query("UPDATE profiles SET father_id=? WHERE id=?", [finalId, targetProfile.id]);
        try{ await pool.query("INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?)", [genId('pr_'), finalId, targetProfile.id, 'child', null]); }catch{}
      } else if(rel==='mother'){
        await pool.query("UPDATE profiles SET mother_id=? WHERE id=?", [finalId, targetProfile.id]);
        try{ await pool.query("INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?)", [genId('pr_'), finalId, targetProfile.id, 'child', null]); }catch{}
      } else if(rel==='spouse'){
        try{
          await pool.query("INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?)", [genId('pr_'), targetProfile.id, finalId, 'Spouse', null]);
          await pool.query("INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?)", [genId('pr_'), finalId, targetProfile.id, 'Spouse', null]);
        }catch(e){ console.log('spouse insert', e.message); }
      } else if(rel==='child' || rel==='sibling'){
        if(finalFather){ try{ await pool.query("INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?)", [genId('pr_'), finalFather, finalId, 'child', null]); }catch{} }
        if(finalMother){ try{ await pool.query("INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?)", [genId('pr_'), finalMother, finalId, 'child', null]); }catch{} }
      }
    } else {
      if(father_id){ try{ await pool.query("INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?)", [genId('pr_'), father_id, finalId, 'child', null]); }catch{} }
      if(mother_id){ try{ await pool.query("INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?)", [genId('pr_'), mother_id, finalId, 'child', null]); }catch{} }
    }

    if(group_ids && Array.isArray(group_ids)){
      for(const gid of group_ids){
        if(!gid) continue;
        const gmId = genId('gm_');
        try{ await pool.query("INSERT INTO group_members (id, group_id, profile_id, owner_user_id, role) VALUES (?,?,?,?,?)", [gmId, gid, finalId, finalOwner, 'member']); }catch(e){ console.log("group_members insert:", e.message); }
      }
    }

    res.json({ok:true,id:finalId});
  }catch(e){ console.error("POST /api/profiles error:", e.message); res.status(500).json({error:e.message}); }
});

app.post('/api/profiles/link', async (req,res)=>{
  try{
    const from_profile_id = req.body.from_profile_id || req.body.my_profile_id;
    const to_profile_id = req.body.to_profile_id || req.body.existing_profile_id;
    let type = req.body.type || req.body.relation || 'child';
    type = String(type);
    const typeLower = type.toLowerCase();
    if(!from_profile_id ||!to_profile_id) return res.status(400).json({error:"from and to required"});

    if(typeLower==='father'){
      await pool.query("UPDATE profiles SET father_id=? WHERE id=?", [to_profile_id, from_profile_id]);
      await pool.query("INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?)", [genId('pr_'), to_profile_id, from_profile_id, 'child', null]).catch(()=>{});
    } else if(typeLower==='mother'){
      await pool.query("UPDATE profiles SET mother_id=? WHERE id=?", [to_profile_id, from_profile_id]);
      await pool.query("INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?)", [genId('pr_'), to_profile_id, from_profile_id, 'child', null]).catch(()=>{});
    } else if(typeLower==='spouse'){
      await pool.query("INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?)", [genId('pr_'), from_profile_id, to_profile_id, 'Spouse', null]).catch(()=>{});
      await pool.query("INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?)", [genId('pr_'), to_profile_id, from_profile_id, 'Spouse', null]).catch(()=>{});
    } else {
      await pool.query("INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?)", [genId('pr_'), from_profile_id, to_profile_id, type, null]).catch(()=>{});
    }
    res.json({ok:true});
  }catch(e){ console.error('link error', e.message); res.status(500).json({error:e.message}); }
});

app.post('/api/profiles/merge', async (req,res)=>{ try{ const {source_id,target_id}=req.body; await pool.query("UPDATE profile_relations SET owner_profile_id=? WHERE owner_profile_id=?", [target_id, source_id]); await pool.query("UPDATE profile_relations SET related_profile_id=? WHERE related_profile_id=?", [target_id, source_id]); await pool.query("UPDATE group_members SET profile_id=? WHERE profile_id=?", [target_id, source_id]); await pool.query("DELETE FROM profiles WHERE id=?", [source_id]); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});} });
app.delete('/api/profiles/:id', async (req,res)=>{ try{ const {owner_user_id}=req.query; if(owner_user_id){ const [rows]=await pool.query("SELECT owner_user_id FROM profiles WHERE id=?", [req.params.id]); if(rows[0] && rows[0].owner_user_id!==owner_user_id) return res.status(403).json({error:"Not owner"}); } await pool.query("DELETE FROM profile_relations WHERE owner_profile_id=? OR related_profile_id=?", [req.params.id, req.params.id]); await pool.query("DELETE FROM group_members WHERE profile_id=?", [req.params.id]); await pool.query("DELETE FROM profiles WHERE id=?", [req.params.id]); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});} });

app.get('/api/relations', async (req,res)=>{
  try{
    const profile_id = req.query.profile_id || req.query.owner_profile_id || req.query.owner_user_id;
    let sql="SELECT * FROM profile_relations"; let params=[];
    if(profile_id){ sql+=" WHERE owner_profile_id=? OR related_profile_id=?"; params=[profile_id, profile_id]; }
    const [rows]=await pool.query(sql, params);
    const mapped = rows.map(r=>({ id:r.id, owner_profile_id:r.owner_profile_id, related_profile_id:r.related_profile_id, relation_type:r.relation_type, spouse_group:r.spouse_group, from_profile_id:r.owner_profile_id, to_profile_id:r.related_profile_id, type:r.relation_type }));
    res.json(mapped);
  }catch(e){
    console.error('relations error', e.message);
    return res.json([]);
  }
});
app.post('/api/relations', async (req,res)=>{ try{ const {from_profile_id,to_profile_id,type, owner_profile_id, related_profile_id, relation_type}=req.body; const owner = owner_profile_id || from_profile_id; const related = related_profile_id || to_profile_id; const relType = relation_type || type || 'child'; const id=genId('pr_'); await pool.query("INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?)", [id, owner, related, relType, null]); res.json({ok:true,id}); }catch(e){res.status(500).json({error:e.message});} });

app.get('/api/profile-groups', async (req,res)=>{ try{ const {owner_user_id}=req.query; let sql="SELECT * FROM profile_groups"; let params=[]; if(owner_user_id){ sql+=" WHERE owner_user_id=?"; params.push(owner_user_id); } const [rows]=await pool.query(sql, params); res.json(rows); }catch(e){res.status(500).json({error:e.message});} });
app.post('/api/profile-groups', async (req,res)=>{
  try{
    const {id, name, description, photo_url, owner_user_id, invite_code}=req.body;
    if(!name) return res.status(400).json({error:"name required"});
    const finalId = id && String(id).trim()!== ''? String(id).trim() : genId('grp_');
    await pool.query("INSERT INTO profile_groups (id, name, description, photo_url, owner_user_id, invite_code, member_count) VALUES (?,?,?,?,?,?,0)", [finalId, name, description||null, photo_url||null, owner_user_id||'001', invite_code||null]);
    res.json({ok:true,id:finalId});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/profile-groups/:id', async (req,res)=>{ try{ await pool.query("DELETE FROM group_members WHERE group_id=?", [req.params.id]); await pool.query("DELETE FROM profile_groups WHERE id=?", [req.params.id]); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});} });
app.get('/api/group-members', async (req,res)=>{ try{ const {group_id}=req.query; const [rows]=await pool.query("SELECT * FROM group_members WHERE group_id=?", [group_id]); res.json(rows); }catch(e){res.status(500).json({error:e.message});} });
app.post('/api/group-members', async (req,res)=>{
  try{
    const {id, group_id, profile_id, owner_user_id, role}=req.body;
    if(!group_id ||!profile_id) return res.status(400).json({error:"group_id and profile_id required"});
    const finalId = id && String(id).trim()!== ''? String(id).trim() : genId('gm_');
    await pool.query("INSERT INTO group_members (id, group_id, profile_id, owner_user_id, role) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE role=VALUES(role)", [finalId, group_id, profile_id, owner_user_id||'001', role||'member']);
    await pool.query("UPDATE profile_groups SET member_count=(SELECT COUNT(*) FROM group_members WHERE group_id=?) WHERE id=?", [group_id, group_id]);
    res.json({ok:true,id:finalId});
  }catch(e){ console.error("group-members error:", e.message); res.status(500).json({error:e.message}); }
});
app.delete('/api/group-members/:id', async (req,res)=>{ try{ const [rows]=await pool.query("SELECT group_id FROM group_members WHERE group_id=? OR id=? LIMIT 1", [req.params.id, req.params.id]); await pool.query("DELETE FROM group_members WHERE id=? OR (group_id=? AND profile_id=?)", [req.params.id, req.params.id, req.query.profile_id||'']); if(rows[0]) await pool.query("UPDATE profile_groups SET member_count=(SELECT COUNT(*) FROM group_members WHERE group_id=?) WHERE id=?", [rows[0].group_id, rows[0].group_id]); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});} });

app.post('/api/upload', upload.single('file'), async (req,res)=>{ try{ const file=req.file; if(!file) return res.status(400).json({error:"No file"}); const key=`uploads/${Date.now()}_${file.originalname}`; await s3.send(new PutObjectCommand({Bucket:BUCKET_NAME, Key:key, Body:file.buffer, ContentType:file.mimetype})); res.json({url:key, key}); }catch(e){res.status(500).json({error:e.message});} });
app.post('/api/chat/upload/voice', upload.single('file'), async (req,res)=>{ try{ const key=`chat/voice/${Date.now()}_${req.file.originalname}`; await s3.send(new PutObjectCommand({Bucket:BUCKET_NAME, Key:key, Body:req.file.buffer, ContentType:req.file.mimetype})); res.json({url:key}); }catch(e){res.status(500).json({error:e.message});} });
app.post('/api/chat/upload/document', upload.single('file'), async (req,res)=>{ try{ const key=`chat/docs/${Date.now()}_${req.file.originalname}`; await s3.send(new PutObjectCommand({Bucket:BUCKET_NAME, Key:key, Body:req.file.buffer, ContentType:req.file.mimetype})); res.json({url:key}); }catch(e){res.status(500).json({error:e.message});} });
app.post('/api/chat/upload', upload.single('file'), async (req,res)=>{ try{ const key=`chat/${Date.now()}_${req.file.originalname}`; await s3.send(new PutObjectCommand({Bucket:BUCKET_NAME, Key:key, Body:req.file.buffer, ContentType:req.file.mimetype})); res.json({url:key}); }catch(e){res.status(500).json({error:e.message});} });
app.get('/api/files/:key(*)', async (req,res)=>{
  try{
    const Key=req.params.key;
    const obj=await s3.send(new GetObjectCommand({Bucket:BUCKET_NAME, Key}));
    res.setHeader('Content-Type', obj.ContentType||'application/octet-stream');
    obj.Body.pipe(res);
  }catch(e){ res.status(404).json({error:e.message}); }
});

const frontendPath=path.join(__dirname,'dist');
if(fs.existsSync(frontendPath)){
  app.use(express.static(frontendPath));
  app.get('*', (req,res)=>{ if(req.path.startsWith('/api')) return res.status(404).json({error:'API route not found: '+req.path}); res.sendFile(path.join(frontendPath,'index.html')); });
} else {
  app.get('/', (req,res)=>res.json({status:'ok',message:'Backend Running - dist not found'}));
}
app.listen(PORT,'0.0.0.0',()=>console.log(`Running on ${PORT}`));