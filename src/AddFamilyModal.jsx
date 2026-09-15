import React, { useState } from 'react';

export default function AddFamilyModal({ selfId, currentUserId, onClose, onAdded }) {
  const [relation, setRelation] = useState('Father');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [spouseGroup, setSpouseGroup] = useState(1);
  const [loading, setLoading] = useState(false);

  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async () => {
    if(!name) return alert('Enter name');
    setLoading(true);
    try {
      // 1. Create profile in profiles table
      const newId = 'pr' + Date.now();
      const res1 = await fetch('/api/profiles', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          id: newId,
          display_name: name,
          relation_label: relation === 'wife'? 'Spouse' : relation,
          bio: bio,
          owner_user_id: currentUserId,
          photo_url: '',
          dob: null
        })
      });
      const data1 = await res1.json();
      const profileId = data1.id || newId;

      // 2. Upload photo if selected -> avatars/profileId/
      let photoUrl = '';
      if(photo){
        const fd = new FormData();
        fd.append('file', photo);
        const upRes = await fetch(`/api/upload?profileId=${profileId}&userId=${currentUserId}`, {
          method: 'POST',
          body: fd
        });
        const upData = await upRes.json();
        photoUrl = upData.url || '';
        // update profile with photo
        await fetch(`/api/profiles/${profileId}`, {
          method: 'PUT',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ display_name: name, relation_label: relation === 'wife'? 'Spouse' : relation, photo_url: photoUrl, bio })
        });
      }

      // 3. Create link in profile_relations
      await fetch('/api/relations', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          owner_profile_id: selfId,
          related_profile_id: profileId,
          relation_type: relation === 'wife'? 'Spouse' : relation,
          spouse_group: relation === 'Child'? spouseGroup : null
        })
      });

      onAdded();
      onClose();
      alert('Added: ' + name);
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

          {relation === 'Child' && (
            <div>
              <label className="text-[11px] font-bold">Child of which wife? (Spouse Group)</label>
              <select value={spouseGroup} onChange={e=>setSpouseGroup(e.target.value)} className="w-full h-10 bg-[#f8f5f0] rounded-xl px-3 text-[12px]">
                <option value={1}>Wife 1</option>
                <option value={2}>Wife 2</option>
                <option value={3}>Wife 3</option>
              </select>
            </div>
          )}

          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Full Name" className="w-full h-10 bg-[#f8f5f0] rounded-xl px-3 text-[12px]" />
          <textarea value={bio} onChange={e=>setBio(e.target.value)} placeholder="Small description / bio" className="w-full h-16 bg-[#f8f5f0] rounded-xl px-3 py-2 text-[12px]" />

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