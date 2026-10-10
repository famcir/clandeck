import express from 'express';
import { pool, genId } from '../server.js';

const router = express.Router();

router.get('/profile-groups', async (req,res)=>{
  try{
    const {owner_user_id}=req.query;
    let sql="SELECT * FROM profile_groups"; let params=[];
    if(owner_user_id){ sql+=" WHERE owner_user_id=?"; params.push(owner_user_id); }
    const [rows]=await pool.query(sql, params);
    res.json(rows);
  }catch(e){res.status(500).json({error:e.message});}
});

router.post('/profile-groups', async (req,res)=>{
  try{
    const {id, name, description, photo_url, owner_user_id, invite_code}=req.body;
    if(!name) return res.status(400).json({error:"name required"});
    const finalId = id?.trim()? id.trim() : genId('grp_');
    await pool.query("INSERT INTO profile_groups (id, name, description, photo_url, owner_user_id, invite_code, member_count) VALUES (?,?,?,?,?,?,0)", [finalId, name, description||null, photo_url||null, owner_user_id||'001', invite_code||null]);
    res.json({ok:true,id:finalId});
  }catch(e){ res.status(500).json({error:e.message}); }
});

router.delete('/profile-groups/:id', async (req,res)=>{
  try{
    await pool.query("DELETE FROM group_members WHERE group_id=?", [req.params.id]);
    await pool.query("DELETE FROM profile_groups WHERE id=?", [req.params.id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});

router.get('/group-members', async (req,res)=>{
  try{
    const {group_id}=req.query;
    const [rows]=await pool.query("SELECT * FROM group_members WHERE group_id=?", [group_id]);
    res.json(rows);
  }catch(e){res.status(500).json({error:e.message});}
});

router.post('/group-members', async (req,res)=>{
  try{
    const {id, group_id, profile_id, owner_user_id, role}=req.body;
    if(!group_id ||!profile_id) return res.status(400).json({error:"group_id and profile_id required"});
    const finalId = id?.trim()? id.trim() : genId('gm_');
    await pool.query("INSERT INTO group_members (id, group_id, profile_id, owner_user_id, role) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE role=VALUES(role)", [finalId, group_id, profile_id, owner_user_id||'001', role||'member']);
    await pool.query("UPDATE profile_groups SET member_count=(SELECT COUNT(*) FROM group_members WHERE group_id=?) WHERE id=?", [group_id, group_id]);
    res.json({ok:true,id:finalId});
  }catch(e){ res.status(500).json({error:e.message}); }
});

router.delete('/group-members/:id', async (req,res)=>{
  try{
    const [rows]=await pool.query("SELECT group_id FROM group_members WHERE group_id=? OR id=? LIMIT 1", [req.params.id, req.params.id]);
    await pool.query("DELETE FROM group_members WHERE id=? OR (group_id=? AND profile_id=?)", [req.params.id, req.params.id, req.query.profile_id||'']);
    if(rows[0]) await pool.query("UPDATE profile_groups SET member_count=(SELECT COUNT(*) FROM group_members WHERE group_id=?) WHERE id=?", [rows[0].group_id, rows[0].group_id]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});

export default router;