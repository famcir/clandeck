import React, { useState, useEffect } from 'react';

export default function AddFamilyModel({ selfId, currentUserId, onClose, onAdded }) {
  const [relation, setRelation] = useState('Father');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [spouseGroup, setSpouseGroup] = useState(1);
  const [loading, setLoading] = useState(false);
  const [existing, setExisting] = useState({ father: null, mother: null });

  useEffect(()=>{
    // Check existing Father/Mother to prevent duplicate
    fetch(`/api/family-tree/${selfId}`).then(r=>r.json()).then(d=>{
      if(Array.isArray(d)){
        const f = d.find(p=> p.computed_relation==='Father' || p.relation_type==='Father');
        const m = d.find(p=> p.computed_relation==='Mother' || p.relation_type==='Mother');
        setExisting({ father: f||null, mother: m||null });
      }
    }).catch(()=>{});
  },[selfId]);

  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async () => {
    if(!name.trim()) return alert('Enter name');
    if(relation==='Father' && existing.father) return alert(`Father already exists: ${existing.father.display_name}. Cannot add second father.`);
    if(relation==='Mother' && existing.mother) return alert(`Mother already exists: ${existing.mother.display_name}. Cannot add second mother.`);
    
    setLoading(true);
    try {
      // 1. Create profile - let backend create ID
      const res1 = await fetch(`/api/profiles`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          display_name: name.trim(),
          bio: bio,
          owner_user_id: currentUserId,
          photo_url: '',
        })
      });
      const data1 = await res1.json();
      if(!res1.ok) throw new Error(data1.error || 'Create failed');
      const profileId = data1.id;

      // 2. Upload photo
      let photoUrl = '';
      if(photo){
        const fd = new FormData();
        fd.append('file', photo);
        const upRes = await fetch(`/api/upload`, { method: 'POST', body: fd });
        const upData = await upRes.json();
        photoUrl = upData.url || upData.fullUrl || '';
        if(photoUrl){
          await fetch(`/api/profiles/${profileId}`, {
            method: 'PUT',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ photo_url: photoUrl })
          });
        }
      }

      // 3. Create relation link
      if (relation === 'Sibling') {
        let parentIds = { father: null, mother: null };
        try {
          const famRes = await fetch(`/api/family-tree/${selfId}`);
          const famData = await famRes.json();
          if (Array.isArray(famData)) {
            const father = famData.find(p => p.computed_relation === 'Father' || p.relation_type === 'Father');
            const mother = famData.find(p => p.computed_relation === 'Mother' || p.relation_type === 'Mother');
            if (father) parentIds.father = father.id;
            if (mother) parentIds.mother = mother.id;
          }
        } catch(e) {}

        if (parentIds.father) {
          await fetch(`/api/relations`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ owner_profile_id: profileId, related_profile_id: parentIds.father, relation_type: 'Father' })
          });
        }
        if (parentIds.mother) {
          await fetch(`/api/relations`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ owner_profile_id: profileId, related_profile_id: parentIds.mother, relation_type: 'Mother' })
          });
        }
        // Sibling link both ways
        await fetch(`/api/relations`, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ owner_profile_id: selfId, related_profile_id: profileId, relation_type: 'Sibling' })
        });
        await fetch(`/api/relations`, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ owner_profile_id: profileId, related_profile_id: selfId, relation_type: 'Sibling' })
        });
      } else {
        // Normal
        await fetch(`/api/relations`, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            owner_profile_id: selfId,
            related_profile_id: profileId,
            relation_type: relation === 'wife' ? 'Spouse' : relation,
            spouse_group: relation === 'Child' ? Number(spouseGroup) : null
          })
        });

        // Reverse link - Child's perspective: parent is Father or Mother
        if (relation === 'Father' || relation === 'Mother') {
          await fetch(`/api/relations`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ owner_profile_id: profileId, related_profile_id: selfId, relation_type: 'Child' })
          });
        }
        if (relation === 'Child') {
          // From child's view, selfId is Father (we keep simple)
          await fetch(`/api/relations`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ owner_profile_id: profileId, related_profile_id: selfId, relation_type: 'Father' })
          });
        }
        if (relation === 'wife') {
          await fetch(`/api/relations`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ owner_profile_id: profileId, related_profile_id: selfId, relation_type: 'Spouse' })
          });
        }
      }

      onAdded();
      onClose();
    } catch(e){
      alert('Failed: ' + e.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[20px] w-full max-w-[380px] p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-extrabold text-[16px]">Add Family Member</h3>
          <button onClick={onClose} className="w-8 h-8 bg-gray-100 rounded-full">✕</button>
        </div>
        <div className="space-y-3">
          <label className="text-[11px] font-bold">Relation</label>
          <select value={relation} onChange={e=>setRelation(e.target.value)} className="w-full h-10 bg-[#f8f5f0] rounded-xl px-3 text-[12px] font-bold">
            <option>Father</option>
            <option>Mother</option>
            <option>Sibling</option>
            <option>wife</option>
            <option>Child</option>
          </select>
          {existing.father && relation==='Father' && <p className="text-[10px] text-red-600">⚠️ Father exists: {existing.father.display_name}</p>}
          {existing.mother && relation==='Mother' && <p className="text-[10px] text-red-600">⚠️ Mother exists: {existing.mother.display_name}</p>}
          {relation === 'Child' && (
            <div>
              <label className="text-[11px] font-bold">Child of which wife?</label>
              <select value={spouseGroup} onChange={e=>setSpouseGroup(Number(e.target.value))} className="w-full h-10 bg-[#f8f5f0] rounded-xl px-3 text-[12px]">
                <option value={1}>Wife 1</option>
                <option value={2}>Wife 2</option>
                <option value={3}>Wife 3</option>
              </select>
            </div>
          )}
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Full Name" className="w-full h-10 bg-[#f8f5f0] rounded-xl px-3 text-[12px]" />
          <textarea value={bio} onChange={e=>setBio(e.target.value)} placeholder="Small description" className="w-full h-16 bg-[#f8f5f0] rounded-xl px-3 py-2 text-[12px]" />
          <div className="flex items-center gap-3">
            <input type="file" accept="image/*" onChange={handlePhoto} className="text-[11px]" />
            {preview && <img src={preview} className="w-12 h-12 rounded-xl object-cover" />}
          </div>
          <button onClick={handleSubmit} disabled={loading} className="w-full h-11 bg-black text-white rounded-full font-bold text-[12px] mt-2">
            {loading? 'Saving...' : `Add as ${relation}`}
          </button>
        </div>
      </div>
    </div>
  );
}