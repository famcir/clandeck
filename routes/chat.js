import express from 'express';
import { pool } from '../server.js';

const router = express.Router();

// ONLINE HEARTBEAT
router.post('/chatbox/heartbeat', async (req,res)=>{
  try{
    const {userId,displayName}=req.body;
    await pool.query(`INSERT INTO chatbox (user_id, display_name, last_seen, is_online) VALUES (?,?,NOW(),1) ON DUPLICATE KEY UPDATE last_seen=NOW(), is_online=1, display_name=COALESCE(?, display_name)`, [userId, displayName||userId, displayName||userId]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});

router.post('/chatbox/offline', async (req,res)=>{
  try{
    await pool.query(`UPDATE chatbox SET is_online=0, last_seen=NOW() WHERE user_id=?`, [req.body.userId]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});

router.get('/chatbox/online', async (req,res)=>{
  try{
    await pool.query(`UPDATE chatbox SET is_online=0 WHERE last_seen < NOW() - INTERVAL 120 SECOND`);
    const [rows]=await pool.query(`SELECT user_id FROM chatbox WHERE last_seen >= NOW() - INTERVAL 120 SECOND AND is_online=1`);
    res.json(rows.map(r=>r.user_id));
  }catch(e){res.status(500).json({error:e.message});}
});

// VIDEO CALLS
router.post('/call/request', async (req,res)=>{
  try{
    const {caller_id,caller_name,receiver_id,sdp_offer}=req.body;
    const id=`call_${Date.now()}_${Math.random().toString(36).substr(2,4)}`;
    await pool.query(`INSERT INTO video_calls (id, caller_id, caller_name, receiver_id, status, sdp_offer) VALUES (?,?,?,?, 'ringing',?)`, [id, caller_id, caller_name, receiver_id, sdp_offer||null]);
    const nId=`ntf_${Date.now()}_call`;
    await pool.query(`INSERT INTO notifications (id, to_user_id, from_user_id, from_name, title, body, type) VALUES (?,?,?,?,?,?, 'video_call')`, [nId, receiver_id, caller_id, caller_name, 'Incoming video call', `${caller_name} is calling you`]);
    res.json({ok:true,callId:id});
  }catch(e){res.status(500).json({error:e.message});}
});

router.get('/call/incoming/:userId', async (req,res)=>{
  try{ const [rows]=await pool.query(`SELECT * FROM video_calls WHERE receiver_id=? AND status='ringing' AND created_at >= NOW() - INTERVAL 60 SECOND ORDER BY created_at DESC LIMIT 1`, [req.params.userId]); res.json(rows[0]||null); }catch(e){res.status(500).json({error:e.message});}
});
router.get('/call/:callId', async (req,res)=>{ try{ const [rows]=await pool.query(`SELECT * FROM video_calls WHERE id=?`, [req.params.callId]); res.json(rows[0]||null); }catch(e){res.status(500).json({error:e.message});} });
router.post('/call/accept', async (req,res)=>{ try{ await pool.query(`UPDATE video_calls SET status='accepted', sdp_answer=? WHERE id=?`, [req.body.sdp_answer||null, req.body.callId]); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});} });
router.post('/call/reject', async (req,res)=>{ try{ await pool.query(`UPDATE video_calls SET status='rejected' WHERE id=?`, [req.body.callId]); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});} });
router.post('/call/end', async (req,res)=>{ try{ await pool.query(`UPDATE video_calls SET status='ended' WHERE id=?`, [req.body.callId]); res.json({ok:true}); }catch(e){res.status(500).json({error:e.message});} });

// NOTIFICATIONS
router.post('/chatbox/notify', async (req,res)=>{
  try{
    const {to_user_id,from_user_id,from_name,title,body}=req.body;
    const [online]=await pool.query(`SELECT user_id FROM chatbox WHERE user_id=? AND last_seen >= NOW() - INTERVAL 120 SECOND`, [to_user_id]);
    if(online.length===0){
      const id=`ntf_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
      await pool.query(`INSERT INTO notifications (id, to_user_id, from_user_id, from_name, title, body, type) VALUES (?,?,?,?,?,?, 'chat')`, [id, to_user_id, from_user_id, from_name, title||`You have chat from ${from_name}`, body]);
    }
    res.json({notified: online.length===0});
  }catch(e){res.status(500).json({error:e.message});}
});

router.get('/notifications/:userId', async (req,res)=>{
  try{ const [rows]=await pool.query(`SELECT * FROM notifications WHERE to_user_id=? ORDER BY created_at DESC LIMIT 50`, [req.params.userId]); res.json(rows); }catch(e){res.status(500).json({error:e.message});}
});

// MESSAGES
router.post('/chat/send', async (req,res)=>{
  try{
    const {sender_id,sender_name,text,type,direct_to,group_id,fileName}=req.body;
    const id=`msg_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
    if(group_id) await pool.query(`INSERT INTO group_messages (id, sender_id, sender_name, group_id, text, type, file_name) VALUES (?,?,?,?,?,?,?)`, [id, sender_id, sender_name, group_id, text, type||'text', fileName||null]);
    else await pool.query(`INSERT INTO direct_messages (id, sender_id, sender_name, direct_to, text, type, file_name) VALUES (?,?,?,?,?,?,?)`, [id, sender_id, sender_name, direct_to, text, type||'text', fileName||null]);
    res.json({ok:true,id});
  }catch(e){res.status(500).json({error:e.message});}
});

router.get('/chat/direct', async (req,res)=>{
  try{
    const {user1,user2}=req.query;
    const [rows]=await pool.query(`SELECT * FROM direct_messages WHERE (sender_id=? AND direct_to=?) OR (sender_id=? AND direct_to=?) ORDER BY created_at ASC LIMIT 200`, [user1, user2, user2, user1]);
    res.json(rows);
  }catch(e){res.status(500).json({error:e.message});}
});

router.get('/chat/group/:groupId', async (req,res)=>{
  try{ const [rows]=await pool.query(`SELECT * FROM group_messages WHERE group_id=? ORDER BY created_at ASC LIMIT 200`, [req.params.groupId]); res.json(rows); }catch(e){res.status(500).json({error:e.message});}
});

export default router;