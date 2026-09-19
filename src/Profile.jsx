import React, { useState, useEffect, useRef } from 'react';
import logo from './assets/clandeck_h.png';

export default function Profile({ onEdit, onLogout, onDeck, onBack }) {
  const [profiles, setProfiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const fileInputRef = useRef(null);
  const currentUserId = localStorage.getItem('userId') || 'ur001';

  // Add family states
  const [showAddmodel, setShowAddmodel] = useState(false);
  const [newRelation, setNewRelation] = useState('Father');
  const [newName, setNewName] = useState('');
  const [newBio, setNewBio] = useState('');
  const [newPhoto, setNewPhoto] = useState(null);
  const [newPreview, setNewPreview] = useState('');
  const [newSpouseGroup, setNewSpouseGroup] = useState(1);
  const [adding, setAdding] = useState(false);
  const [editingFamilyId, setEditingFamilyId] = useState(null); // NEW FOR EDIT

  // EDIT PROFILE STATES
  const [editForm, setEditForm] = useState({
    display_name: '',
    bio: '',
    location: '',
    dob: ''
  });

  useEffect(() => {
    fetch(`/api/profiles?owner_user_id=${currentUserId}`)
     .then(res => res.json())
     .then(data => setProfiles(data || []))
     .catch(() => setProfiles([]));
  }, [currentUserId]);

  const get = (label) => profiles.find(p => p.relation_label?.toLowerCase() === label.toLowerCase());
  const getAll = (label) => profiles.filter(p => p.relation_label?.toLowerCase() === label.toLowerCase());

  const self = profiles.find(p => p.id === currentUserId)
            || profiles.find(p => p.relation_label?.toLowerCase() === 'self')
            || profiles.find(p => p.relation_label?.toLowerCase() === 'you')
            || profiles[0];

  // Fill edit form when self changes
  useEffect(() => {
    if (self) {
      setEditForm({
        display_name: self.display_name || '',
        bio: self.bio || '',
        location: self.location || '',
        dob: self.dob? self.dob.split('T')[0] : ''
      });
    }
  }, [self?.id]);

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (!file ||!self) return;
    const localPreview = URL.createObjectURL(file);
    setProfiles(prev => prev.map(p => p.id === self.id? {...p, photo_url: localPreview} : p));
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch(`/api/upload?profileId=${self.id}`, { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadData.url) throw new Error(uploadData.error || "Upload failed");
      const newUrl = uploadData.url;
      await fetch(`/api/profiles/${self.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({...self, photo_url: newUrl }),
      });
      setProfiles(prev => prev.map(p => p.id === self.id? {...p, photo_url: newUrl} : p));
    } catch (err) {
      alert("Failed: " + err.message);
      fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json()).then(d=>setProfiles(d||[]));
    } finally { setUploading(false); }
  };

  // SAVE EDITED PROFILE IN SAME PLACE
  const handleSaveProfile = async () => {
    if (!editForm.display_name.trim()) return alert('Name required');
    setSaving(true);
    try {
      const res = await fetch(`/api/profiles/${self.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: editForm.display_name,
          bio: editForm.bio,
          location: editForm.location,
          dob: editForm.dob,
          relation_label: self.relation_label,
          photo_url: self.photo_url,
          is_claimed: self.is_claimed
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated = await res.json();
      setProfiles(prev => prev.map(p => p.id === self.id? {...p,...editForm,...updated} : p));
      setIsEditing(false);
      alert('Profile saved ✅');
    } catch (e) {
      alert(e.message);
    } finally { setSaving(false); }
  };

  const handleNewPhoto = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    setNewPhoto(file);
    setNewPreview(URL.createObjectURL(file));
  };

  const handleAddFamily = async () => {
    if(!newName) return alert('Enter name');

    // IF EDITING - UPDATE SAME PROFILE
    if(editingFamilyId){
      setAdding(true);
      try{
        let photoUrl = profiles.find(p=>p.id===editingFamilyId)?.photo_url || '';
        if(newPhoto){
          const fd = new FormData(); fd.append('file', newPhoto);
          const upRes = await fetch(`/api/upload?profileId=${editingFamilyId}`, { method: 'POST', body: fd });
          const upData = await upRes.json();
          photoUrl = upData.url || photoUrl;
        }
        const relationLabel = newRelation === 'wife'? 'Spouse' : newRelation;
        await fetch(`/api/profiles/${editingFamilyId}`, {
          method: 'PUT',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ display_name: newName, relation_label: relationLabel, photo_url: photoUrl, bio: newBio })
        });
        const refreshed = await fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json());
        setProfiles(refreshed || []);
        setShowAddmodel(false);
        setEditingFamilyId(null);
        setNewName(''); setNewBio(''); setNewPhoto(null); setNewPreview('');
      }catch(e){ alert('Failed: '+e.message); }finally{ setAdding(false); }
      return;
    }

    // ADD NEW MODE (unchanged)
    const checkLabel = newRelation.toLowerCase() === 'wife'? 'spouse' : newRelation.toLowerCase();
    const alreadyExists = profiles.find(p => p.relation_label?.toLowerCase() === checkLabel);
    if (['father','mother','spouse'].includes(checkLabel) && alreadyExists) {
      return alert(`${alreadyExists.relation_label} already saved as ${alreadyExists.display_name}!`);
    }
    setAdding(true);
    try {
      const newId = 'pr' + Date.now();
      const relationLabel = newRelation === 'wife'? 'Spouse' : newRelation;
      const res1 = await fetch('/api/profiles', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ id: newId, display_name: newName, relation_label: relationLabel, bio: newBio, owner_user_id: currentUserId, photo_url: '', dob: null })
      });
      const data1 = await res1.json();
      const profileId = data1.id || newId;
      let photoUrl = '';
      if(newPhoto){
        const fd = new FormData(); fd.append('file', newPhoto);
        const upRes = await fetch(`/api/upload?profileId=${profileId}`, { method: 'POST', body: fd });
        const upData = await upRes.json();
        photoUrl = upData.url || '';
        await fetch(`/api/profiles/${profileId}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ display_name: newName, relation_label: relationLabel, photo_url: photoUrl, bio: newBio }) });
      }
      await fetch('/api/relations', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ owner_profile_id: self.id, related_profile_id: profileId, relation_type: relationLabel, spouse_group: newRelation === 'Child'? Number(newSpouseGroup) : null }) });
      const refreshed = await fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json());
      setProfiles(refreshed || []);
      setShowAddmodel(false);
      setNewName(''); setNewBio(''); setNewPhoto(null); setNewPreview('');
    } catch(e){ alert('Failed: ' + e.message); } finally { setAdding(false); }
  };

  const handleDelete = async (profileId) => {
    if(!confirm('Delete this member?')) return;
    await fetch(`/api/profiles/${profileId}`, { method: 'DELETE' });
    setProfiles(prev => prev.filter(p => p.id!== profileId));
  };

  const handleEdit = (p) => {
    // SAME POPUP WITH CURRENT VALUES - NO OTHER CHANGE
    setEditingFamilyId(p.id);
    setNewName(p.display_name || '');
    setNewBio(p.bio || '');
    setNewRelation(p.relation_label === 'Spouse'? 'wife' : p.relation_label || 'Father');
    setNewPreview(p.photo_url || '');
    setNewPhoto(null);
    setShowAddmodel(true);
  };

  const goDeck = () => { if (onDeck) onDeck(); else if (onBack) onBack(); };
  if (!self) return <div className="p-10">Loading {currentUserId}...</div>;

  const father = get('Father'); const mother = get('Mother'); const spouse = get('Spouse');
  const siblings = getAll('Sibling'); const children = getAll('Child');

  const Node = ({ p, big }) => {
    if (!p) return null;
    return (
      <div className="flex flex-col items-center cursor-pointer group relative">
        <div className={`${big? 'w-[70px] h-[70px] bg-[#c9ad83] text-white text-[24px]' : 'w-[62px] h-[62px] bg-[#f8f5f0] text-[22px]'} rounded-[16px] border flex items-center justify-center overflow-hidden`}>
          {p.photo_url? <img src={p.photo_url} className="w-full h-full rounded-[16px] object-cover" /> : p.display_name?.[0]}
        </div>
        <div className="mt-1 flex flex-col items-center text-center leading-none">
          <p className="text-[11px] font-bold">{p.display_name}</p>
          {big && <span className="text-[11px] font-bold">(you)</span>}
          {!big && (
            <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition">
              <button onClick={()=>handleEdit(p)} className="text-[9px] bg-black text-white px-1.5 py-0.5 rounded-full">Edit</button>
              <button onClick={()=>handleDelete(p.id)} className="text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded-full">X</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen w-full bg-[#f2efe8]" style={{ fontFamily: 'Plus Jakarta Sans' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&display=swap');.card{background:#fffefb;border:1px solid #e9e2d6;border-radius:28px} input,textarea{outline:none}`}</style>

      <header className="h-[68px] bg-[#fffefb] border-b flex items-center px-6 justify-between">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Clandeck" className="h-[60px] w-auto object-contain" />
          <button onClick={goDeck} className="ml-2 px-5 h-9 bg-black text-white rounded-full text-[12px] font-bold">Deck</button>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onLogout} className="px-4 h-9 bg-black text-white rounded-full text-[12px]">Logout</button>
          <img src={self.photo_url} className="w-9 h-9 rounded-full object-cover" alt="" />
        </div>
      </header>

      <div className="grid grid-cols-12 gap-4 p-4 w-full">
        {/* LEFT EDITABLE PROFILE */}
        <div className="col-span-12 lg:col-span-3 card p-6">
          <div className="text-center">
            <div className="relative w-[100px] h-[100px] mx-auto group cursor-pointer" onClick={() =>!isEditing && fileInputRef.current.click()}>
              <img src={self.photo_url} className="w-[100px] h-[100px] rounded-[20px] mx-auto object-cover" alt="" />
              <div className="absolute inset-0 bg-black/50 rounded-[20px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                <span className="text-white text-[11px] font-bold">{uploading? 'Uploading...' : 'Change'}</span>
              </div>
            </div>
            <input type="file" ref={fileInputRef} onChange={handleImageChange} accept="image/*" className="hidden" />

            {!isEditing? (
              <>
                <h2 className="font-extrabold text-[18px] mt-3">{self.display_name}</h2>
                <p className="text-[11px] text-gray-500">@{currentUserId} • {self.relation_label}</p>
              </>
            ) : (
              <input value={editForm.display_name} onChange={e=>setEditForm({...editForm, display_name: e.target.value})} className="w-full mt-3 h-10 bg-[#f8f5f0] border border-[#e9e2d6] rounded-xl px-3 text-[14px] font-bold text-center" placeholder="Your name" />
            )}
            {uploading && <p className="text-[10px] text-blue-600 mt-1">Uploading...</p>}
          </div>

          {!isEditing? (
            <>
              <div className="mt-6 flex gap-2">
                <button onClick={()=>setIsEditing(true)} className="flex-1 py-2.5 bg-black text-white rounded-full font-bold text-[12px]">Edit Profile</button>
                <button className="flex-1 py-2.5 bg-[#827d74] text-white rounded-full font-bold text-[12px]">Share</button>
              </div>
              <div className="mt-5 space-y-3 text-[12px]">
                <div className="text-left"><p className="text-[11px] text-gray-500 font-bold">Bio</p><p className="bg-[#f8f5f0] p-3 rounded-xl mt-1 text-[12px]">{self.bio || 'No bio yet.'}</p></div>
                <div className="flex justify-between"><span className="text-gray-500">DOB</span><b>{self.dob? self.dob.split('T')[0] : '—'}</b></div>
                <div className="flex justify-between"><span className="text-gray-500">Location</span><b>{self.location || '—'}</b></div>
                <div className="flex justify-between"><span className="text-gray-500">Members</span><b>{profiles.length}</b></div>
              </div>
            </>
          ) : (
            <div className="mt-5 space-y-3">
              <div><label className="text-[10px] font-bold text-gray-500">BIO</label><textarea value={editForm.bio} onChange={e=>setEditForm({...editForm, bio: e.target.value})} placeholder="Write about you" className="w-full h-20 bg-[#f8f5f0] border border-[#e9e2d6] rounded-xl px-3 py-2 text-[12px] mt-1" /></div>
              <div><label className="text-[10px] font-bold text-gray-500">DOB</label><input type="date" value={editForm.dob} onChange={e=>setEditForm({...editForm, dob: e.target.value})} className="w-full h-10 bg-[#f8f5f0] border border-[#e9e2d6] rounded-xl px-3 text-[12px] mt-1" /></div>
              <div><label className="text-[10px] font-bold text-gray-500">LOCATION</label><input value={editForm.location} onChange={e=>setEditForm({...editForm, location: e.target.value})} placeholder="City, State" className="w-full h-10 bg-[#f8f5f0] border border-[#e9e2d6] rounded-xl px-3 text-[12px] mt-1" /></div>

              <div className="flex gap-2 pt-2">
                <button onClick={()=>setIsEditing(false)} className="flex-1 py-2.5 bg-[#f2efe8] border border-[#e9e2d6] rounded-full font-bold text-[12px]">Cancel</button>
                <button onClick={handleSaveProfile} disabled={saving} className="flex-1 py-2.5 bg-black text-white rounded-full font-bold text-[12px]">{saving? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          )}
        </div>

        {/* CENTER + RIGHT SAME */}
        <div className="col-span-12 lg:col-span-6 card p-6">
          <div className="flex justify-between items-center mb-4">
            <button onClick={() => { setEditingFamilyId(null); setNewName(''); setNewBio(''); setNewPhoto(null); setNewPreview(''); setShowAddmodel(true); }} className="px-4 py-1.5 bg-black text-white rounded-full text-[11px] font-bold">+ Add Family Member</button>
            <span className="text-[11px] text-gray-500">{profiles.length} members</span>
          </div>
          <div className="relative mx-auto" style={{ width: '520px', maxWidth: '100%', height: '420px' }}>
            <div className="absolute" style={{ left: '125px', top: '0' }}><Node p={father} /></div>
            <div className="absolute" style={{ left: '245px', top: '0' }}><Node p={mother} /></div>
            <div className="absolute flex gap-2" style={{ left: '330px', top: '175px' }}>{siblings.map(s => <Node key={s.id} p={s} />)}</div>
            <div className="absolute" style={{ left: '65px', top: '215px' }}><Node p={spouse} /></div>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10"><Node p={self} big /></div>
            <div className="absolute flex gap-3" style={{ left: '110px', top: '330px' }}>{children.map(c => <Node key={c.id} p={c} />)}</div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-3 space-y-4">
          <div className="card p-4"><h3 className="font-bold text-[13px]">Notifications</h3><p className="text-[12px] mt-2">✅ Profile loaded for {currentUserId}</p></div>
          <div className="card p-4"><h3 className="font-bold text-[13px]">Pictures</h3><div className="grid grid-cols-3 gap-2 mt-2"><div className="aspect-square bg-[#f2efe8] rounded-xl"></div><div className="aspect-square bg-[#f2efe8] rounded-xl"></div><div className="aspect-square bg-[#f2efe8] rounded-xl"></div></div></div>
          <div className="card p-4"><h3 className="font-bold text-[13px]">Baskets</h3><p className="text-[12px] mt-2">🧺 {profiles.length} members</p></div>
        </div>
      </div>

      {showAddmodel && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[20px] w-full max-w-[380px] p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-extrabold text-[16px]">{editingFamilyId? 'Edit Family Member' : 'Add Family Member'}</h3>
              <button onClick={()=>{ setShowAddmodel(false); setEditingFamilyId(null); setNewName(''); setNewBio(''); setNewPhoto(null); setNewPreview(''); }} className="w-8 h-8 bg-gray-100 rounded-full">✕</button>
            </div>
            <div className="space-y-3">
              <select value={newRelation} onChange={e=>setNewRelation(e.target.value)} className="w-full h-10 bg-[#f8f5f0] rounded-xl px-3 text-[12px] font-bold">
                <option>Father</option><option>Mother</option><option>Sibling</option><option>wife</option><option>Child</option>
              </select>
              {newRelation === 'Child' && (
                <select value={newSpouseGroup} onChange={e=>setNewSpouseGroup(e.target.value)} className="w-full h-10 bg-[#f8f5f0] rounded-xl px-3 text-[12px]">
                  <option value={1}>Wife 1</option><option value={2}>Wife 2</option><option value={3}>Wife 3</option>
                </select>
              )}
              <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Full Name" className="w-full h-10 bg-[#f8f5f0] rounded-xl px-3 text-[12px]" />
              <textarea value={newBio} onChange={e=>setNewBio(e.target.value)} placeholder="Small description / bio" className="w-full h-16 bg-[#f8f5f0] rounded-xl px-3 py-2 text-[12px]" />
              <div className="flex items-center gap-3">
                <input type="file" accept="image/*" onChange={handleNewPhoto} className="text-[11px]" />
                {newPreview && <img src={newPreview} className="w-12 h-12 rounded-xl object-cover" />}
              </div>
              <button onClick={handleAddFamily} disabled={adding} className="w-full h-11 bg-black text-white rounded-full font-bold text-[12px] mt-2">{adding? 'Saving...' : editingFamilyId? 'Save' : `Add as ${newRelation}`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}