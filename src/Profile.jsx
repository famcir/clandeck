import React, { useState, useEffect, useRef } from 'react';
import logo from './assets/clandeck_h.png';

export default function Profile({ onEdit, onLogout, onDeck, onBack }) {
  const [profiles, setProfiles] = useState([]);
  const [relations, setRelations] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const fileInputRef = useRef(null);
  const currentUserId = localStorage.getItem('userId') || 'ur001';

  const [showAddmodel, setShowAddmodel] = useState(false);
  const [newRelation, setNewRelation] = useState('Father');
  const [newName, setNewName] = useState('');
  const [newBio, setNewBio] = useState('');
  const [newPhoto, setNewPhoto] = useState(null);
  const [newPreview, setNewPreview] = useState('');
  const [selectedSpouseForChild, setSelectedSpouseForChild] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingFamilyId, setEditingFamilyId] = useState(null);

  // NEW: viewing other member tree
  const [viewProfileId, setViewProfileId] = useState(null);
  const [viewProfileData, setViewProfileData] = useState(null);
  // FIX: need tree + relations for viewed member
  const [activeTree, setActiveTree] = useState(null);
  const [activeRelations, setActiveRelations] = useState([]);

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

  const selfForRel = profiles.find(p => p.id === currentUserId) || profiles.find(p => p.relation_label?.toLowerCase() === 'self') || profiles[0];
  useEffect(() => {
    if (!selfForRel?.id) return;
    fetch(`/api/relations?owner_profile_id=${selfForRel.id}`)
.then(r => r.json())
.then(d => setRelations(d || []))
.catch(() => setRelations([]));
  }, [selfForRel?.id, profiles.length]);

  const self = profiles.find(p => p.id === currentUserId)
            || profiles.find(p => p.relation_label?.toLowerCase() === 'self')
            || profiles.find(p => p.relation_label?.toLowerCase() === 'you')
            || profiles[0];

  // Active profile is either viewed member or self
  const activeSelf = viewProfileData || self;
  const isViewingOther =!!viewProfileId;

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
        body: JSON.stringify({ photo_url: newUrl }),
      });
      setProfiles(prev => prev.map(p => p.id === self.id? {...p, photo_url: newUrl} : p));
    } catch (err) {
      alert("Failed: " + err.message);
      fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json()).then(d=>setProfiles(d||[]));
    } finally { setUploading(false); }
  };

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
        await fetch(`/api/profiles/${editingFamilyId}`, {
          method: 'PUT',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ display_name: newName, photo_url: photoUrl, bio: newBio })
        });
        const refreshed = await fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json());
        setProfiles(refreshed || []);
        setShowAddmodel(false);
        setEditingFamilyId(null);
        setNewName(''); setNewBio(''); setNewPhoto(null); setNewPreview(''); setSelectedSpouseForChild('');
      }catch(e){ alert('Failed: '+e.message); }finally{ setAdding(false); }
      return;
    }
    if (['Father','Mother'].includes(newRelation)) {
      const target = activeSelf || self;
      if (newRelation === 'Father' && target?.father_id) return alert(`Father already exists!`);
      if (newRelation === 'Mother' && target?.mother_id) return alert(`Mother already exists!`);
    }
    setAdding(true);
    try {
      const target = activeSelf || self;
      const genderForNew = newRelation === 'Father'? 'Male' : newRelation === 'Mother'? 'Female' : newRelation === 'Spouse'? (target?.gender === 'Male'? 'Female' : 'Male') : null;
      const spouseList = profiles.filter(p => relations.filter(r => r.relation_type === 'Spouse').map(r=>r.related_profile_id).includes(p.id));
      let linkedSpouseId = null;
      if (newRelation === 'Child') {
        if (spouseList.length === 1) linkedSpouseId = spouseList[0].id;
        else if (spouseList.length > 1) linkedSpouseId = selectedSpouseForChild || spouseList[0].id;
      }
      const res1 = await fetch('/api/profiles', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          display_name: newName,
          bio: newBio,
          owner_user_id: currentUserId,
          my_profile_id: target?.id || self.id,
          relation: newRelation,
          gender: genderForNew,
          photo_url: '',
          dob: null,
          spouse_id: linkedSpouseId
        })
      });
      const data1 = await res1.json();
      if (!res1.ok) throw new Error(data1.error || 'Add failed');
      const profileId = data1.id;
      let photoUrl = '';
      if(newPhoto){
        const fd = new FormData(); fd.append('file', newPhoto);
        const upRes = await fetch(`/api/upload?profileId=${profileId}`, { method: 'POST', body: fd });
        const upData = await upRes.json();
        photoUrl = upData.url || '';
        await fetch(`/api/profiles/${profileId}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ photo_url: photoUrl }) });
      }
      const refreshed = await fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json());
      setProfiles(refreshed || []);
      const relRef = await fetch(`/api/relations?owner_profile_id=${self.id}`).then(r=>r.json());
      setRelations(relRef || []);
      setShowAddmodel(false);
      setNewName(''); setNewBio(''); setNewPhoto(null); setNewPreview(''); setSelectedSpouseForChild('');
    } catch(e){ alert('Failed: ' + e.message); } finally { setAdding(false); }
  };

  const handleDelete = async (profileId) => {
    if(!confirm('Delete this member?')) return;
    await fetch(`/api/profiles/${profileId}`, { method: 'DELETE' });
    setProfiles(prev => prev.filter(p => p.id!== profileId));
  };

  const handleEdit = (p) => {
    setEditingFamilyId(p.id);
    setNewName(p.display_name || '');
    setNewBio(p.bio || '');
    let guessed = 'Sibling';
    if (p.id === activeSelf?.father_id) guessed = 'Father';
    else if (p.id === activeSelf?.mother_id) guessed = 'Mother';
    else if (relations.some(r => r.related_profile_id === p.id && r.relation_type === 'Spouse')) guessed = 'Spouse';
    else if (p.father_id === activeSelf?.id || p.mother_id === activeSelf?.id) guessed = 'Child';
    setNewRelation(guessed);
    setNewPreview(p.photo_url || '');
    setNewPhoto(null);
    setSelectedSpouseForChild('');
    setShowAddmodel(true);
  };

  // FIXED: click on family photo -> show that member's FULL tree
  const handleMemberPhotoClick = async (member) => {
    if(member.id === self?.id) {
      handleBackToMyTree();
      return;
    }
    setViewProfileId(member.id);
    setViewProfileData(member);
    try {
      const res = await fetch(`/api/family-tree/${member.id}`);
      const data = await res.json();
      if(Array.isArray(data) && data.length > 0) setActiveTree(data);
      else setActiveTree(null);
      const relRes = await fetch(`/api/relations?owner_profile_id=${member.id}`);
      const relData = await relRes.json();
      setActiveRelations(relData || []);
    } catch(e) {
      console.log('load active tree failed', e);
      setActiveTree(null);
      setActiveRelations([]);
    }
  };

  const handleBackToMyTree = () => {
    setViewProfileId(null);
    setViewProfileData(null);
    setActiveTree(null);
    setActiveRelations([]);
  };

  const goDeck = () => { if (onDeck) onDeck(); else if (onBack) onBack(); };
  if (!self) return <div className="p-10">Loading {currentUserId}...</div>;

  // FIXED: use activeTree / activeRelations when viewing other
  const sourceProfiles = activeTree || profiles;
  const sourceRelations = isViewingOther? activeRelations : relations;

  const father = sourceProfiles.find(p => p.id === activeSelf?.father_id);
  const mother = sourceProfiles.find(p => p.id === activeSelf?.mother_id);
  const spouseIds = sourceRelations.filter(r => r.relation_type === 'Spouse').map(r => r.related_profile_id);
  const spouse = sourceProfiles.find(p => spouseIds.includes(p.id));
  const spouseList = sourceProfiles.filter(p => spouseIds.includes(p.id));
  const siblingsFixed = sourceProfiles.filter(p => {
    if (p.id === activeSelf?.id) return false;
    if (activeSelf?.father_id && p.father_id === activeSelf?.father_id) return true;
    if (activeSelf?.mother_id && p.mother_id === activeSelf?.mother_id) return true;
    return false;
  });
  const children = sourceProfiles.filter(p => p.father_id === activeSelf?.id || p.mother_id === activeSelf?.id);

  const Node = ({ p, big }) => {
    if (!p) return null;
    const hasPhoto = p.photo_url && p.photo_url.trim()!== '';
    const initial = (p.display_name || '?').trim().charAt(0).toUpperCase();
    return (
      <div onClick={() => p && handleMemberPhotoClick(p)} className="flex flex-col items-center cursor-pointer group relative shrink-0 hover:scale-105 transition-transform">
        <div className={`${big? 'tree-node-big' : 'tree-node'} rounded-[8px] border flex items-center justify-center overflow-hidden shrink-0 ${big? 'bg-[#c9ad83] text-white' : 'bg-[#f8f5f0] text-[#5a4a32]'}`}>
          {hasPhoto? <img src={p.photo_url} className="w-full h-full rounded-[8px] object-cover" alt={p.display_name} /> : <span className="font-extrabold text-[clamp(14px,3cqw,22px)]">{initial}</span>}
        </div>
        <div className="mt-1 flex flex-col items-center text-center leading-none">
          <p className="tree-label font-bold max-w-[64px] truncate">{p.display_name}</p>
          {big && <span className="tree-label font-bold">(you)</span>}
          {!big && (
            <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition">
              <button onClick={(e)=>{e.stopPropagation(); handleEdit(p)}} className="text-[8px] bg-black text-white px-1.5 py-0.5 rounded-full">Edit</button>
              <button onClick={(e)=>{e.stopPropagation(); handleDelete(p.id)}} className="text-[8px] bg-red-500 text-white px-1.5 py-0.5 rounded-full">X</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const firstName = activeSelf?.display_name?.split(' ')[0] || 'Member';

  return (
    <div className="min-h-screen w-full bg-[#f2efe8]" style={{ fontFamily: 'Plus Jakarta Sans' }}>
      <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&display=swap');
.card{background:#fffefb;border:1px solid #e9e2d6;border-radius:10px}
      input,textarea{outline:none}
.tree-node{ width: clamp(44px, 8.5cqw, 62px); height: clamp(44px, 8.5cqw, 62px); font-size: clamp(16px, 3.5cqw, 22px); }
.tree-node-big{ width: clamp(58px, 11cqw, 76px); height: clamp(58px, 11cqw, 76px); font-size: clamp(20px, 4cqw, 26px); }
.tree-label{ font-size: clamp(8px, 2cqw, 11px); }
      `}</style>
      <header className="h-[68px] bg-[#fffefb] border-b flex items-center px-6 justify-between">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Clandeck" className="h-[60px] w-auto object-contain" />
          <button onClick={goDeck} className="ml-2 px-5 h-9 bg-black text-white rounded-full text-[12px] font-bold">Deck</button>
          {isViewingOther && (
            <button onClick={handleBackToMyTree} className="ml-2 px-4 h-8 bg-[#efe8d3] border border-[#e9e2d6] rounded-full text-[11px] font-bold">← {self?.display_name?.split(' ')[0]}'s Tree</button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onLogout} className="px-4 h-9 bg-black text-white rounded-full text-[12px]">Logout</button>
          {self?.photo_url? <img src={self.photo_url} className="w-9 h-9 rounded-full object-cover" alt="" /> : <div className="w-9 h-9 rounded-full bg-[#c9ad83] text-white flex items-center justify-center text-[12px] font-bold">{(self?.display_name?.[0] || '?').toUpperCase()}</div>}
        </div>
      </header>
      <div className="grid grid-cols-12 gap-4 p-4 w-full">
        <div className="col-span-12 lg:col-span-3 card p-6">
          <div className="text-center">
            <div className="relative w-[100px] h-[100px] mx-auto group cursor-pointer" onClick={() =>!isEditing && fileInputRef.current.click()}>
              {self?.photo_url? <img src={self.photo_url} className="w-[100px] h-[100px] rounded-[10px] mx-auto object-cover" alt="" /> : <div className="w-[100px] h-[100px] rounded-[10px] mx-auto bg-[#c9ad83] text-white flex items-center justify-center text-[32px] font-extrabold">{(self?.display_name?.[0] || '?').toUpperCase()}</div>}
              <div className="absolute inset-0 bg-black/50 rounded-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                <span className="text-white text-[11px] font-bold">{uploading? 'Uploading...' : 'Change'}</span>
              </div>
            </div>
            <input type="file" ref={fileInputRef} onChange={handleImageChange} accept="image/*" className="hidden" />
            {!isEditing? (
              <>
                <h2 className="font-extrabold text-[18px] mt-3">{self.display_name}</h2>
                <p className="text-[11px] text-gray-500">@{currentUserId} • {self.gender || self.relation_label || 'Self'}</p>
                {isViewingOther && <p className="text-[10px] text-[#c9ad83] font-bold mt-1">Viewing {activeSelf?.display_name}'s Tree</p>}
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

        {/* MIDDLE TREE - BEIGE HEADER SMALL ROUND */}
        <div className="col-span-12 lg:col-span-6 flex flex-col gap-0">
          <div className="bg-[#efe8d3] border border-[#e9e2d6] border-b-0 rounded-t-[10px] p-4 flex justify-between items-center">
            <h2 className="font-extrabold text-[13px]">{isViewingOther? `${activeSelf?.display_name}'s Family Tree` : "My Family Tree"}</h2>
            <button onClick={() => { setEditingFamilyId(null); setNewName(''); setNewBio(''); setNewPhoto(null); setNewPreview(''); setSelectedSpouseForChild(''); setShowAddmodel(true); }} className="px-4 py-1.5 bg-black text-white rounded-full text-[11px] font-bold">
              {isViewingOther? `+ Add ${firstName}'s Family Member` : "+ Add Family Member"}
            </button>
          </div>
          <div className="bg-[#fffefb] border border-[#e9e2d6] rounded-b-[10px] rounded-t-none p-6">
            <div className="w-full flex justify-center">
              <div className="relative w-full overflow-hidden" style={{ maxWidth: '520px', height: 'clamp(360px, 40vw, 440px)', containerType: 'inline-size' }}>
                <div className="absolute left-1/2 -translate-x-1/2 top-[2%] flex gap-[2px] z-10">
                  {father && <Node p={father} />}
                  {mother && <Node p={mother} />}
                </div>
                <div className="absolute left-1/2 -translate-x-1/2 top-[38%] flex items-center gap-[12px]">
                  {spouse && <Node p={spouse} />}
                  <Node p={activeSelf} big />
                </div>
                <div className="absolute right-[4%] top-[18%] flex gap-[2px] max-w-[36%] flex-wrap justify-end">
                  {siblingsFixed.map(s => <Node key={s.id} p={s} />)}
                </div>
                <div className="absolute left-[47%] bottom-[5%] -translate-x-1/2 flex gap-[2px] justify-center">
                  {children.map(c => <Node key={c.id} p={c} />)}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-3 space-y-4">
          <div className="card p-4"><h3 className="font-bold text-[13px]">Notifications</h3><p className="text-[12px] mt-2">✅ Profile loaded for {currentUserId}</p></div>
          <div className="card p-4"><h3 className="font-bold text-[13px]">Pictures</h3><div className="grid grid-cols-3 gap-2 mt-2"><div className="aspect-square bg-[#f2efe8] rounded-[8px]"></div><div className="aspect-square bg-[#f2efe8] rounded-[8px]"></div><div className="aspect-square bg-[#f2efe8] rounded-[8px]"></div></div></div>
          <div className="card p-4"><h3 className="font-bold text-[13px]">Baskets</h3><p className="text-[12px] mt-2">🧺 {profiles.length} members</p></div>
        </div>
      </div>

      {showAddmodel && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[10px] w-full max-w-[380px] p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-extrabold text-[16px]">
                {editingFamilyId
                ? 'Edit Family Member'
                  : isViewingOther
                  ? `Add ${activeSelf?.display_name}'s Family Member`
                    : 'Add Family Member'}
              </h3>
              <button onClick={()=>{ setShowAddmodel(false); setEditingFamilyId(null); setNewName(''); setNewBio(''); setNewPhoto(null); setNewPreview(''); setSelectedSpouseForChild(''); }} className="w-8 h-8 bg-gray-100 rounded-full">✕</button>
            </div>
            <div className="space-y-3">
              <p className="text-[11px] text-gray-500">
                {isViewingOther &&!editingFamilyId
                ? `Adding to ${activeSelf?.display_name}'s family tree`
                  : "Add a new member to family tree"}
              </p>
              <select value={newRelation} onChange={e=>setNewRelation(e.target.value)} className="w-full h-10 bg-[#f8f5f0] rounded-[8px] px-3 text-[12px] font-bold">
                <option>Father</option><option>Mother</option><option>Sibling</option><option>Spouse</option><option>Child</option>
              </select>
              {newRelation === 'Child' && spouseList.length > 1 && (
                <select value={selectedSpouseForChild} onChange={e=>setSelectedSpouseForChild(e.target.value)} className="w-full h-10 bg-[#f8f5f0] rounded-[8px] px-3 text-[12px]">
                  <option value="">Select Spouse (Mother/Father of child)</option>
                  {spouseList.map(s => (
                    <option key={s.id} value={s.id}>{s.display_name}</option>
                  ))}
                </select>
              )}
              <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Full Name" className="w-full h-10 bg-[#f8f5f0] rounded-[8px] px-3 text-[12px]" />
              <textarea value={newBio} onChange={e=>setNewBio(e.target.value)} placeholder="Small description / bio" className="w-full h-16 bg-[#f8f5f0] rounded-[8px] px-3 py-2 text-[12px]" />
              <div className="flex items-center gap-3">
                <input type="file" accept="image/*" onChange={handleNewPhoto} className="text-[11px]" />
                {newPreview && <img src={newPreview} className="w-12 h-12 rounded-[8px] object-cover" />}
              </div>
              <button onClick={handleAddFamily} disabled={adding} className="w-full h-11 bg-black text-white rounded-full font-bold text-[12px] mt-2">
                {adding? 'Saving...' : editingFamilyId? 'Save' : isViewingOther? `Add as ${firstName}'s ${newRelation}` : `Add as ${newRelation}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}