import express from 'express';
import { pool, genId } from '../server.js';

const router = express.Router();

// REGISTER
router.post('/register', async (req,res)=>{
  const {id,name,email,password,uname}=req.body;
  const finalUname=uname||email;
  try{
    await pool.execute("INSERT INTO users (id, name, email, uname, password, status) VALUES (?,?,?,?,?,?)", [id,name,email||finalUname,finalUname,password,'active']);
    res.json({message:"User created!",id});
  }catch(err){res.status(400).json({error:err.message});}
});

// SHARE TEMP USER
router.post('/share-temp-user', async (req,res)=>{
  const {id,name,email,password,profile_id,invited_by_user_id,uname}=req.body;
  const finalUname=uname||email;
  try{
    if(profile_id){
      const [pRows]=await pool.query("SELECT id, display_name, owner_user_id, is_claimed FROM profiles WHERE id=?", [profile_id]);
      const p=pRows[0];
      if(p){
        const alreadyClaimed = String(p.id) === String(p.owner_user_id) || Number(p.is_claimed) === 1;
        if(alreadyClaimed) return res.status(403).json({error: `${p.display_name} already accepted ownership`});
      }
    }
    await pool.execute("INSERT INTO users (id, name, email, uname, password, status, invited_by_user_id, shared_profile_id, is_temp) VALUES (?,?,?,?,?,?,?,?,?)", [id,name,email||finalUname,finalUname,password||'pw1234','active',invited_by_user_id,profile_id||null,1]);
    res.json({success:true,username:finalUname,password:password||'pw1234'});
  }catch(err){
    if(err.message.includes('Duplicate')){
      try{
        await pool.execute("UPDATE users SET password=?, invited_by_user_id=?, shared_profile_id=?, uname=? WHERE email=? OR uname=? OR shared_profile_id=?", [password||'pw1234',invited_by_user_id,profile_id||null,finalUname,email,finalUname,profile_id]);
        return res.json({success:true,username:finalUname,password:password||'pw1234',reused:true});
      }catch(e2){ return res.status(500).json({error:e2.message}); }
    }
    res.status(500).json({error:err.message});
  }
});

// LOGIN
router.post('/login', async (req,res)=>{
  const {email,password,uname}=req.body; const loginId=uname||email;
  try{
    const [rows]=await pool.execute("SELECT id, name, email, uname, shared_profile_id, is_temp FROM users WHERE (uname=? OR email=?) AND password=?", [loginId,loginId,password]);
    if(rows.length===0) return res.status(400).json({error:"Wrong username or password"});
    res.json({message:"Login success",...rows[0], token:"token-"+rows[0].id});
  }catch(err){ res.status(500).json({error:"DB Error: "+err.message}); }
});

// CLAIM ACCOUNT
router.post('/claim-account', async (req,res)=>{
  const {userId,newUname,newPassword}=req.body;
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction(); await conn.query("SET FOREIGN_KEY_CHECKS=0");
    const [rows]=await conn.query("SELECT id, shared_profile_id FROM users WHERE id=?", [userId]);
    if(rows.length===0) throw new Error("User not found");
    const sharedProfileId=rows[0].shared_profile_id;
    if(!sharedProfileId) throw new Error("No shared_profile_id");
    if(rows[0].id===sharedProfileId){ await conn.query("SET FOREIGN_KEY_CHECKS=1"); await conn.rollback(); return res.json({success:true,id:rows[0].id,message:"Already claimed"}); }
    const [unameCheck]=await conn.query("SELECT id FROM users WHERE uname=? AND id!=?", [newUname, userId]);
    if(unameCheck.length>0) throw new Error("Username already taken");
    await conn.query("UPDATE users SET id=?, uname=?, email=?, password=?, is_temp=0, shared_profile_id=NULL WHERE id=?", [sharedProfileId,newUname,newUname,newPassword,userId]);
    await conn.query("UPDATE profiles SET owner_user_id=?, is_claimed=1 WHERE id=?", [sharedProfileId, sharedProfileId]);
    await conn.query("SET FOREIGN_KEY_CHECKS=1"); await conn.commit();
    res.json({success:true,id:sharedProfileId,uname:newUname});
  }catch(e){ try{await conn.query("SET FOREIGN_KEY_CHECKS=1");}catch{} await conn.rollback(); res.status(500).json({error:e.message}); }finally{ conn.release(); }
});

router.get('/users', async (req,res)=>{ try{ const [rows]=await pool.query("SELECT * FROM users"); res.json(rows); }catch(e){res.status(500).json({error:e.message});} });
router.get('/users/:id', async (req,res)=>{ try{ const [rows]=await pool.query("SELECT * FROM profiles WHERE id=?", [req.params.id]); res.json(rows[0]||null); }catch(e){res.status(500).json({error:e.message});} });
router.get('/basket/:userId', async (req,res)=>{ try{ const [rows]=await pool.query("SELECT COUNT(*) as count FROM profiles WHERE owner_user_id=?", [req.params.userId]); res.json({count: rows[0]?.count||0}); }catch(e){ res.json({count:0}); } });

export default router;