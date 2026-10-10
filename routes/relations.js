import express from 'express';
import { pool } from '../server.js';

const router = express.Router();

// GET /api/relations?profile_id=xxx
router.get('/relations', async (req,res)=>{
  try{
    const profile_id = req.query.profile_id || req.query.owner_profile_id || req.query.owner_user_id;
    let sql="SELECT * FROM profile_relations"; let params=[];
    if(profile_id){ sql+=" WHERE owner_profile_id=? OR related_profile_id=?"; params=[profile_id, profile_id]; }
    const [rows]=await pool.query(sql, params);
    const mapped = rows.map(r=>({
      id:r.id,
      owner_profile_id:r.owner_profile_id,
      related_profile_id:r.related_profile_id,
      relation_type:r.relation_type,
      spouse_group:r.spouse_group,
      from_profile_id:r.owner_profile_id,
      to_profile_id:r.related_profile_id,
      type:r.relation_type
    }));
    res.json(mapped);
  }catch(e){ res.json([]); }
});

router.post('/relations', async (req,res)=>{
  try{
    const {from_profile_id,to_profile_id,type, owner_profile_id, related_profile_id, relation_type}=req.body;
    const owner = owner_profile_id || from_profile_id;
    const related = related_profile_id || to_profile_id;
    const relType = relation_type || type || 'child';
    const id = `pr_${Date.now()}_${Math.random().toString(36).substring(2,5)}`;
    await pool.query("INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type) VALUES (?,?,?,?)", [id, owner, related, relType]);
    res.json({ok:true,id});
  }catch(e){res.status(500).json({error:e.message});}
});

// FIXED FAMILY TREE - NO MORE DUPLICATE SARATH
router.get('/family-tree/:profileId', async (req,res)=>{
  try{
    const rootId=req.params.profileId;
    if(!rootId) return res.json([]);
    const [rows]=await pool.query("SELECT * FROM profiles WHERE id=?", [rootId]);
    const root = rows[0];
    if(!root) return res.json([]);
    if(root.category === 'Fnd') return res.json([{...root, computed_relation:'Self'}]);

    const ownerId = root.owner_user_id || rootId;
    const [allProfiles]=await pool.query("SELECT * FROM profiles WHERE owner_user_id=? OR id=?", [ownerId, rootId]);

    let allRelations=[];
    try{ const [rel]=await pool.query("SELECT * FROM profile_relations WHERE owner_profile_id=? OR related_profile_id=?", [rootId, rootId]); allRelations=rel; }catch{}

    const map=new Map(allProfiles.map(p=>[p.id, {...p}]));
    if(!map.has(rootId)) map.set(rootId, root);

    const result=[];
    const seen=new Set();
    const add=(p, rel)=>{
      if(!p || seen.has(p.id)) return;
      seen.add(p.id);
      result.push({...p, computed_relation: rel});
    };

    add(map.get(rootId), 'Self');

    // parents from father_id / mother_id column
    if(root.father_id && map.has(root.father_id)) add(map.get(root.father_id), 'Father');
    if(root.mother_id && map.has(root.mother_id)) add(map.get(root.mother_id), 'Mother');

    // FIX: also parents from profile_relations where root is child
    allRelations.forEach(r=>{
      const t=(r.relation_type||'').toLowerCase();
      if(t==='child' && r.related_profile_id===rootId){
        const parentId=r.owner_profile_id;
        if(map.has(parentId) &&!seen.has(parentId)){
          const p=map.get(parentId);
          const relName = p.gender==='Female'? 'Mother' : p.gender==='Male'? 'Father' : 'Parent';
          add(p, relName);
        }
      }
    });

    // siblings - same father or mother
    allProfiles.forEach(p=>{
      if(p.id===rootId || seen.has(p.id)) return;
      if((root.father_id && p.father_id===root.father_id) || (root.mother_id && p.mother_id===root.mother_id)){
        add(p, 'Sibling');
      }
    });

    // children
    allProfiles.forEach(p=>{
      if(seen.has(p.id)) return;
      if(p.father_id===rootId || p.mother_id===rootId) add(p, 'Child');
    });

    // children from relations table
    allRelations.forEach(r=>{
      const t=(r.relation_type||'').toLowerCase();
      if(t==='child' && r.owner_profile_id===rootId){
        const childId=r.related_profile_id;
        if(map.has(childId)) add(map.get(childId), 'Child');
      }
    });

    // spouses
    allRelations.forEach(r=>{
      const t=(r.relation_type||'').toLowerCase();
      if(t.includes('spouse')){
        const otherId=r.owner_profile_id===rootId? r.related_profile_id : r.owner_profile_id;
        if(map.has(otherId)) add(map.get(otherId), 'Spouse');
      }
    });

    // Deduplicate final result by id - THIS STOPS DUPLICATE SARATH
    const unique = Array.from(new Map(result.map(p=>[p.id,p])).values());
    return res.json(unique.length? unique : [{...root, computed_relation:'Self'}]);
  }catch(e){
    console.error('family-tree error', e.message);
    return res.json([]);
  }
});

export default router;