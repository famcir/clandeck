const express = require('express');
const router = express.Router();
const db = require('../db'); // your mysql pool

// Helper: get pool query
const q = (sql, params) => db.query(sql, params);

// GET /api/profiles?owner_user_id=ur001&search=gov
router.get('/', async (req, res) => {
  try {
    const { owner_user_id, search } = req.query;
    if (!owner_user_id) return res.status(400).json({ error: 'owner_user_id required' });
    let sql = `SELECT p.*, GROUP_CONCAT(pgm.group_id) as group_ids
               FROM profiles p
               LEFT JOIN profile_group_members pgm ON pgm.profile_id = p.id
               WHERE p.owner_user_id =?`;
    let params = [owner_user_id];
    if (search) {
      sql += ` AND p.display_name LIKE?`;
      params.push(`%${search}%`);
    }
    sql += ` GROUP BY p.id ORDER BY p.created_at DESC`;
    const [rows] = await q(sql, params);
    res.json(rows);
  } catch (e) {
    console.error('GET profiles error', e);
    res.status(500).json({ error: e.message });
  }
});

// GET single profile /api/profiles/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await q(`SELECT * FROM profiles WHERE id =?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profiles - Create
router.post('/', async (req, res) => {
  try {
    const { display_name, bio, owner_user_id, photo_url, dob, location, gender, my_profile_id, relation, spouse_id, group_ids, category } = req.body;
    if (!display_name ||!owner_user_id) return res.status(400).json({ error: 'display_name and owner_user_id required' });

    // DUPLICATE FATHER/MOTHER PROTECTION
    if (my_profile_id && ['Father','Mother'].includes(relation)) {
      const [existing] = await q(`SELECT related_profile_id, relation_type FROM profile_relations WHERE owner_profile_id =? AND relation_type IN ('Father','Mother')`, [my_profile_id]);
      if (relation === 'Father' && existing.find(r=>r.relation_type==='Father')) {
        return res.status(400).json({ error: `Father already exists for ${my_profile_id}. Delete existing first.` });
      }
      if (relation === 'Mother' && existing.find(r=>r.relation_type==='Mother')) {
        return res.status(400).json({ error: `Mother already exists for ${my_profile_id}. Delete existing first.` });
      }
      // Also check via father_id/mother_id columns
      const [selfRow] = await q(`SELECT father_id, mother_id FROM profiles WHERE id =?`, [my_profile_id]);
      if (selfRow.length) {
        if (relation==='Father' && selfRow[0].father_id) return res.status(400).json({ error: 'Father already exists (father_id)' });
        if (relation==='Mother' && selfRow[0].mother_id) return res.status(400).json({ error: 'Mother already exists (mother_id)' });
      }
    }

    const newId = 'pr' + Date.now() + '_' + Math.random().toString(36).substr(2,4);
    const cat = category || (relation && ['Father','Mother','Sibling','Child','Spouse'].includes(relation)? 'Fml' : 'Fnd');

    await q(`INSERT INTO profiles (id, display_name, bio, owner_user_id, photo_url, dob, location, gender, father_id, mother_id, category) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [newId, display_name.trim(), bio||'', owner_user_id, photo_url||'', dob||null, location||'', gender||null, null, null, cat]);

    // Create relation links if my_profile_id provided
    if (my_profile_id && relation) {
      const relType = relation === 'wife'? 'Spouse' : relation;

      // Main link
      await q(`INSERT INTO profile_relations (owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE relation_type=VALUES(relation_type)`,
        [my_profile_id, newId, relType, null]);

      // Update father_id/mother_id columns for quick tree
      if (relType === 'Father') {
        await q(`UPDATE profiles SET father_id =? WHERE id =?`, [newId, my_profile_id]);
        await q(`INSERT INTO profile_relations (owner_profile_id, related_profile_id, relation_type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE relation_type=VALUES(relation_type)`, [newId, my_profile_id, 'Child']);
      }
      if (relType === 'Mother') {
        await q(`UPDATE profiles SET mother_id =? WHERE id =?`, [newId, my_profile_id]);
        await q(`INSERT INTO profile_relations (owner_profile_id, related_profile_id, relation_type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE relation_type=VALUES(relation_type)`, [newId, my_profile_id, 'Child']);
      }
      if (relType === 'Child') {
        // For child, my_profile_id is parent. Set child's father_id or mother_id
        // Check gender of parent to decide
        const [parent] = await q(`SELECT gender FROM profiles WHERE id =?`, [my_profile_id]);
        const isParentMale = parent[0]?.gender === 'Male' || true; // default father
        if (isParentMale) {
          await q(`UPDATE profiles SET father_id =? WHERE id =?`, [my_profile_id, newId]);
        } else {
          await q(`UPDATE profiles SET mother_id =? WHERE id =?`, [my_profile_id, newId]);
        }
        // If spouse_id provided for child, set second parent
        if (spouse_id) {
          const [spouseRow] = await q(`SELECT gender FROM profiles WHERE id =?`, [spouse_id]);
          const isSpouseMale = spouseRow[0]?.gender === 'Male';
          if (isSpouseMale) await q(`UPDATE profiles SET father_id =? WHERE id =?`, [spouse_id, newId]);
          else await q(`UPDATE profiles SET mother_id =? WHERE id =?`, [spouse_id, newId]);
        }
        await q(`INSERT INTO profile_relations (owner_profile_id, related_profile_id, relation_type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE relation_type=VALUES(relation_type)`, [newId, my_profile_id, 'Father']);
      }
      if (relType === 'Spouse' || relType === 'wife') {
        await q(`INSERT INTO profile_relations (owner_profile_id, related_profile_id, relation_type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE relation_type=VALUES(relation_type)`, [newId, my_profile_id, 'Spouse']);
      }
      if (relType === 'Sibling') {
        await q(`INSERT INTO profile_relations (owner_profile_id, related_profile_id, relation_type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE relation_type=VALUES(relation_type)`, [my_profile_id, newId, 'Sibling']);
        await q(`INSERT INTO profile_relations (owner_profile_id, related_profile_id, relation_type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE relation_type=VALUES(relation_type)`, [newId, my_profile_id, 'Sibling']);
      }
    }

    // Handle group_ids
    if (Array.isArray(group_ids) && group_ids.length > 0) {
      for (const gid of group_ids) {
        await q(`INSERT INTO profile_group_members (group_id, profile_id) VALUES (?,?) ON DUPLICATE KEY UPDATE group_id=VALUES(group_id)`, [gid, newId]);
      }
    }

    res.json({ id: newId, success: true });
  } catch (e) {
    console.error('POST profiles error', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profiles/link - Link existing profile as family
router.post('/link', async (req, res) => {
  try {
    const { my_profile_id, existing_profile_id, relation } = req.body;
    if (!my_profile_id ||!existing_profile_id ||!relation) return res.status(400).json({ error: 'Missing fields' });

    // Duplicate protection
    if (['Father','Mother'].includes(relation)) {
      const [existing] = await q(`SELECT relation_type FROM profile_relations WHERE owner_profile_id =? AND relation_type =?`, [my_profile_id, relation]);
      if (existing.length) return res.status(400).json({ error: `${relation} already exists` });
      const [selfRow] = await q(`SELECT father_id, mother_id FROM profiles WHERE id =?`, [my_profile_id]);
      if (selfRow.length) {
        if (relation==='Father' && selfRow[0].father_id) return res.status(400).json({ error: 'Father already exists' });
        if (relation==='Mother' && selfRow[0].mother_id) return res.status(400).json({ error: 'Mother already exists' });
      }
    }

    const relType = relation === 'wife'? 'Spouse' : relation;
    await q(`INSERT INTO profile_relations (owner_profile_id, related_profile_id, relation_type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE relation_type=VALUES(relation_type)`, [my_profile_id, existing_profile_id, relType]);

    if (relType === 'Father') await q(`UPDATE profiles SET father_id =? WHERE id =?`, [existing_profile_id, my_profile_id]);
    if (relType === 'Mother') await q(`UPDATE profiles SET mother_id =? WHERE id =?`, [existing_profile_id, my_profile_id]);
    if (relType === 'Child') await q(`UPDATE profiles SET father_id =? WHERE id =?`, [my_profile_id, existing_profile_id]);
    if (relType === 'Spouse') {
      await q(`INSERT INTO profile_relations (owner_profile_id, related_profile_id, relation_type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE relation_type=VALUES(relation_type)`, [existing_profile_id, my_profile_id, 'Spouse']);
    }
    if (relType === 'Sibling') {
      await q(`INSERT INTO profile_relations (owner_profile_id, related_profile_id, relation_type) VALUES (?,?,?) ON DUPLICATE KEY UPDATE relation_type=VALUES(relation_type)`, [existing_profile_id, my_profile_id, 'Sibling']);
    }

    res.json({ success: true });
  } catch (e) {
    console.error('Link error', e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/profiles/:id - Update
router.put('/:id', async (req, res) => {
  try {
    const { display_name, bio, photo_url, location, dob } = req.body;
    const fields = [];
    const vals = [];
    if (display_name!== undefined) { fields.push('display_name =?'); vals.push(display_name); }
    if (bio!== undefined) { fields.push('bio =?'); vals.push(bio); }
    if (photo_url!== undefined) { fields.push('photo_url =?'); vals.push(photo_url); }
    if (location!== undefined) { fields.push('location =?'); vals.push(location); }
    if (dob!== undefined) { fields.push('dob =?'); vals.push(dob||null); }
    if (!fields.length) return res.json({ success: true });
    vals.push(req.params.id);
    await q(`UPDATE profiles SET ${fields.join(', ')} WHERE id =?`, vals);
    const [rows] = await q(`SELECT * FROM profiles WHERE id =?`, [req.params.id]);
    res.json(rows[0] || { success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/profiles/:id?owner_user_id=ur001
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { owner_user_id } = req.query;
    if (!owner_user_id) return res.status(400).json({ error: 'owner_user_id required' });
    if (id === owner_user_id) return res.status(400).json({ error: 'Cannot delete Self profile' });

    const [prof] = await q(`SELECT owner_user_id, is_claimed FROM profiles WHERE id =?`, [id]);
    if (!prof.length) return res.status(404).json({ error: 'Not found' });
    // Optional: only owner can delete
    // if (String(prof[0].owner_user_id)!== String(owner_user_id)) return res.status(403).json({ error: 'Not owner' });
    if (Number(prof[0].is_claimed) === 1) return res.status(400).json({ error: 'Ownership accepted - cannot delete' });

    await q(`DELETE FROM profile_relations WHERE owner_profile_id =? OR related_profile_id =?`, [id, id]);
    await q(`DELETE FROM profile_group_members WHERE profile_id =?`, [id]);
    await q(`UPDATE profiles SET father_id = NULL WHERE father_id =?`, [id]);
    await q(`UPDATE profiles SET mother_id = NULL WHERE mother_id =?`, [id]);
    await q(`DELETE FROM profiles WHERE id =?`, [id]);

    res.json({ success: true });
  } catch (e) {
    console.error('DELETE error', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;