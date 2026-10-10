// api/FamilyTree.js OR server/routes/FamilyTree.js
// FINAL FIXED - No duplicate Father, No 500 for Fnd
const express = require('express');
const router = express.Router();
const db = require('../db');
const q = (sql, params) => db.query(sql, params);

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { owner_user_id } = req.query;

    const [selfRows] = await q(`SELECT * FROM profiles WHERE id =?`, [id]);
    if (!selfRows.length) return res.json([]);
    const self = selfRows[0];

    // Fnd = return only self, no 500
    if (self.category === 'Fnd') {
      return res.json([{...self, computed_relation: 'Self' }]);
    }

    let owner = owner_user_id || self.owner_user_id;
    let allProfiles = [];
    if (owner) {
      const [rows] = await q(`SELECT * FROM profiles WHERE owner_user_id =? AND (category='Fml' OR category IS NULL)`, [owner]);
      allProfiles = rows;
    } else {
      const [rows] = await q(`SELECT * FROM profiles WHERE category='Fml' OR category IS NULL LIMIT 500`);
      allProfiles = rows;
    }

    const [rels] = await q(`SELECT * FROM profile_relations WHERE owner_profile_id =?`, [id]);

    const map = new Map();
    const add = (p, computed) => {
      if (!p ||!p.id) return;
      if (map.has(p.id)) return;
      map.set(p.id, {...p, computed_relation: computed || '' });
    };

    add(self, 'Self');

    // Father - ONE only
    if (self.father_id) {
      const father = allProfiles.find(pr => pr.id === self.father_id) || (await q(`SELECT * FROM profiles WHERE id =?`, [self.father_id]).then(r=>r[0][0]).catch(()=>null));
      if (father) add(father, 'Father');
    } else {
      const fatherRel = rels.find(r => r.relation_type === 'Father');
      if (fatherRel) {
        const father = allProfiles.find(pr => pr.id === fatherRel.related_profile_id) || (await q(`SELECT * FROM profiles WHERE id =?`, [fatherRel.related_profile_id]).then(r=>r[0][0]).catch(()=>null));
        if (father) add(father, 'Father');
      }
    }

    // Mother - ONE only
    if (self.mother_id) {
      const mother = allProfiles.find(pr => pr.id === self.mother_id) || (await q(`SELECT * FROM profiles WHERE id =?`, [self.mother_id]).then(r=>r[0][0]).catch(()=>null));
      if (mother) add(mother, 'Mother');
    } else {
      const motherRel = rels.find(r => r.relation_type === 'Mother');
      if (motherRel) {
        const mother = allProfiles.find(pr => pr.id === motherRel.related_profile_id) || (await q(`SELECT * FROM profiles WHERE id =?`, [motherRel.related_profile_id]).then(r=>r[0][0]).catch(()=>null));
        if (mother) add(mother, 'Mother');
      }
    }

    // Spouse
    const spouseRels = rels.filter(r => r.relation_type === 'Spouse');
    for (const sr of spouseRels) {
      const spouse = allProfiles.find(pr => pr.id === sr.related_profile_id) || (await q(`SELECT * FROM profiles WHERE id =?`, [sr.related_profile_id]).then(r=>r[0][0]).catch(()=>null));
      if (spouse) add(spouse, 'Spouse');
    }

    // Siblings
    const siblings = allProfiles.filter(p => {
      if (p.id === self.id) return false;
      if (map.has(p.id)) return false;
      if (self.father_id && p.father_id === self.father_id) return true;
      if (self.mother_id && p.mother_id === self.mother_id) return true;
      return false;
    });
    siblings.forEach(s => add(s, 'Sibling'));

    const sibRels = rels.filter(r => r.relation_type === 'Sibling');
    for (const sr of sibRels) {
      const sib = allProfiles.find(pr => pr.id === sr.related_profile_id) || (await q(`SELECT * FROM profiles WHERE id =?`, [sr.related_profile_id]).then(r=>r[0][0]).catch(()=>null));
      if (sib) add(sib, 'Sibling');
    }

    // Children
    const children = allProfiles.filter(p => p.father_id === self.id || p.mother_id === self.id);
    children.forEach(c => add(c, 'Child'));

    const childRels = rels.filter(r => r.relation_type === 'Child');
    for (const cr of childRels) {
      const child = allProfiles.find(pr => pr.id === cr.related_profile_id) || (await q(`SELECT * FROM profiles WHERE id =?`, [cr.related_profile_id]).then(r=>r[0][0]).catch(()=>null));
      if (child) add(child, 'Child');
    }

    // Enforce only 1 Father / 1 Mother
    let result = Array.from(map.values());
    const fathers = result.filter(p => p.computed_relation === 'Father');
    if (fathers.length > 1) {
      const keepId = fathers[0].id;
      result = result.filter(p =>!(p.computed_relation === 'Father' && p.id!== keepId));
    }
    const mothers = result.filter(p => p.computed_relation === 'Mother');
    if (mothers.length > 1) {
      const keepId = mothers[0].id;
      result = result.filter(p =>!(p.computed_relation === 'Mother' && p.id!== keepId));
    }

    const unique = Array.from(new Map(result.map(p=>[p.id,p])).values());
    res.json(unique);
  } catch (e) {
    console.error('FamilyTree error', e);
    res.json([]);
  }
});

module.exports = router;