import React, { useState, useEffect, useRef } from 'react';
import CommonHeader from './CommonHeader.jsx';

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

  const [searchResults, setSearchResults] = useState([]);
  const [selectedExistingId, setSelectedExistingId] = useState(null);
  const [searching, setSearching] = useState(false);

  const [viewProfileId, setViewProfileId] = useState(null);
  const [viewProfileData, setViewProfileData] = useState(null);
  const [activeTree, setActiveTree] = useState(null);
  const [activeRelations, setActiveRelations] = useState([]);

  // ADDED FOR DECK STYLE UNLIMITED
  const [treeDepth, setTreeDepth] = useState(0);
  const [extendedTree, setExtendedTree] = useState([]);
  const onlyFml = (arr) => (arr||[]).filter(p =>!p.category || p.category === 'Fml');

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

  useEffect(() => {
    if(editingFamilyId) return;
    const q = newName?.trim() || '';
    if(q.length < 1){ setSearchResults([]); return; }
    const timer = setTimeout(async ()=>{
      setSearching(true);
      try{
        const res = await fetch(`/api/profiles?owner_user_id=${currentUserId}&search=${encodeURIComponent(q)}`);
        const data = await res.json();
        const filtered = (data||[]).filter(p=> p.id!== activeSelf?.id && p.id!== self?.id);
        setSearchResults(filtered.slice(0,30));
      }catch{ setSearchResults([]); }
      setSearching(false);
    }, 300);
    return ()=>clearTimeout(timer);
  }, [newName, editingFamilyId, activeSelf?.id, self?.id, currentUserId]);

  // UNLIMITED EXTENDED TREE - SAME AS DECK.JSX
  useEffect(()=>{
    const sourceForBFS = activeTree || profiles;
    const base = sourceForBFS.filter(p =>
      p.id === activeSelf?.father_id ||
      p.id === activeSelf?.mother_id ||
      p.id === activeSelf?.id ||
      (activeSelf?.father_id && p.father_id === activeSelf?.father_id) ||
      (activeSelf?.mother_id && p.mother_id === activeSelf?.mother_id) ||
      p.father_id === activeSelf?.id || p.mother_id === activeSelf?.id ||
      (activeRelations||[]).filter(r=>r.relation_type==='Spouse').map(r=>r.related_profile_id).includes(p.id)
    );
    const baseList = base.length>0? base : sourceForBFS;
    if(treeDepth === 0){ setExtendedTree([]); return; }
    if(baseList.length === 0) return;
    const run = async () => {
      let all = [...baseList];
      let visited = new Set(baseList.map(p=>p.id));
      let queue = [...baseList.map(p=>p.id)];
      let depth = 0;
      while(queue.length>0 && depth < treeDepth){
        const results = await Promise.all(queue.map(id=> fetch(`/api/family-tree/${id}`).then(r=>r.json()).catch(()=>[])));
        const flat = results.flat().filter(Boolean);
        const fmlOnly = onlyFml(flat);
        const newOnes = fmlOnly.filter(p=>p?.id &&!visited.has(p.id));
        newOnes.forEach(p=>visited.add(p.id));
        all = [...all,...newOnes];
        queue = newOnes.map(p=>p.id);
        depth++;
      }
      const unique = Array.from(new Map(all.map(p=>[p.id,p])).values());
      setExtendedTree(unique);
    };
    run();
  },[treeDepth, activeTree, profiles, activeSelf?.id]);

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
    if(!newName &&!selectedExistingId) return alert('Enter name');
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
        setNewName(''); setNewBio(''); setNewPhoto(null); setNewPreview(''); setSelectedSpouseForChild(''); setSearchResults([]); setSelectedExistingId(null);
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

      if(selectedExistingId){
        const linkRes = await fetch('/api/profiles/link', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            my_profile_id: target?.id || self.id,
            existing_profile_id: selectedExistingId,
            relation: newRelation
          })
        });
        const linkData = await linkRes.json();
        if(!linkRes.ok) throw new Error(linkData.error || 'Link failed');
        const refreshed = await fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json());
        setProfiles(refreshed || []);
        const relRef = await fetch(`/api/relations?owner_profile_id=${self.id}`).then(r=>r.json());
        setRelations(relRef || []);
        if(viewProfileId){
          const treeRes = await fetch(`/api/family-tree/${viewProfileId}`);
          const treeData = await treeRes.json();
          setActiveTree(treeData || []);
          const relRes2 = await fetch(`/api/relations?owner_profile_id=${viewProfileId}`);
          setActiveRelations(await relRes2.json() || []);
        }
        setShowAddmodel(false);
        setNewName(''); setNewBio(''); setNewPhoto(null); setNewPreview(''); setSelectedSpouseForChild(''); setSearchResults([]); setSelectedExistingId(null);
        alert('Linked to existing member ✅ Now his family will show in tree');
        return;
      }

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
      if(viewProfileId){
        const treeRes = await fetch(`/api/family-tree/${viewProfileId}`);
        const treeData = await treeRes.json();
        setActiveTree(treeData || []);
        const relRes2 = await fetch(`/api/relations?owner_profile_id=${viewProfileId}`);
        setActiveRelations(await relRes2.json() || []);
      }
      setShowAddmodel(false);
      setNewName(''); setNewBio(''); setNewPhoto(null); setNewPreview(''); setSelectedSpouseForChild(''); setSearchResults([]); setSelectedExistingId(null);
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
    setSearchResults([]);
    setSelectedExistingId(null);
    setShowAddmodel(true);
  };

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
    setTreeDepth(0);
  };

  const goDeck = () => { if (onDeck) onDeck(); else if (onBack) onBack(); };
  if (!self) return <div className="p-10">Loading {currentUserId}...</div>;

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
        <div className={`${big? 'w-[76px] h-[76px] text-[22px] bg-[#c9ad83] text-white' : 'w-[64px] h-[64px] bg-[#f8f5f0] text-[#5a4a32]'} rounded-[8px] border flex items-center justify-center overflow-hidden shrink-0 hover:ring-2 hover:ring-black`}>
          {hasPhoto? <img src={p.photo_url} className="w-full h-full rounded-[8px] object-cover" alt={p.display_name} /> : <span className="font-extrabold text-[16px]">{initial}</span>}
        </div>
        <div className="mt-1 flex flex-col items-center text-center leading-none">
          <p className="text-[10px] font-bold max-w-[64px] truncate">{p.display_name?.split(' ')[0]}</p>
          {big && <span className="text-[10px] font-bold">(you)</span>}
          {!big && (
            <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition">
              <button onClick={(e)=>{e.stopPropagation(); handleEdit(p)}} className="text-[8px] bg-black text-white px-1.5 py-0.5 rounded-[4px]">Edit</button>
              <button onClick={(e)=>{e.stopPropagation(); handleDelete(p.id)}} className="text-[8px] bg-red-500 text-white px-1.5 py-0.5 rounded-[4px]">X</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const firstName = activeSelf?.display_name?.split(' ')[0] || 'Member';
  const allProfiles = extendedTree.length>0? extendedTree : sourceProfiles;

  return (
    <div className="min-h-screen w-full bg-[#f2efe8]" style={{ fontFamily: 'Plus Jakarta Sans' }}>
      <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&display=swap');
.card{background:#fffefb;border:1px solid #e9e2d6;border-radius:10px}
      input,textarea{outline:none}
.tree-node{ width: clamp(44px, 8.5cqw, 62px); height: clamp(44px, 8.5cqw, 62px); font-size: clamp(16px, 3.5cqw, 22px); }
.tree-node-big{ width: clamp(58px, 11cqw, 76px); height: clamp(58px, 11cqw, 76px); font-size: clamp(20px, 4cqw, 26px); }
.tree-label{ font-size: clamp(8px, 2cqw, 11px); }
.family-scroll{width:100%;height:540px;overflow:auto;display:flex;justify-content:flex-start;align-items:flex-start;position:relative;background:#fffefb;scrollbar-width:thin;scrollbar-color:#c9ad83 #f8f5f0;-webkit-overflow-scrolling:touch}
.family-scroll::-webkit-scrollbar{width:8px;height:8px}
.family-scroll::-webkit-scrollbar-thumb{background:#c9ad83;border-radius:10px;border:2px solid #fffefb}
.family-scroll::-webkit-scrollbar-track{background:#f8f5f0}
      `}</style>

      <CommonHeader
        page="profile"
        self={self}
        displayProfile={activeSelf}
        isViewingOther={isViewingOther}
        onDeck={goDeck}
        onProfile={()=>{}}
        onMembers={goDeck}
        onGroups={goDeck}
        onLogout={onLogout}
        onBackToMyTree={handleBackToMyTree}
      />

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
                <button onClick={()=>setIsEditing(true)} className="flex-1 py-2.5 bg-black text-white rounded-[4px] font-bold text-[12px]">Edit Profile</button>
                <button className="flex-1 py-2.5 bg-[#827d74] text-white rounded-[4px] font-bold text-[12px]">Share</button>
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
                <button onClick={()=>setIsEditing(false)} className="flex-1 py-2.5 bg-[#f2efe8] border border-[#e9e2d6] rounded-[4px] font-bold text-[12px]">Cancel</button>
                <button onClick={handleSaveProfile} disabled={saving} className="flex-1 py-2.5 bg-black text-white rounded-[4px] font-bold text-[12px]">{saving? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          )}
        </div>

        <div className="col-span-12 lg:col-span-6 flex flex-col gap-0">
          <div className="bg-[#efe8d3] border border-[#e9e2d6] border-b-0 rounded-t-[10px] p-4 flex justify-between items-center">
            <h2 className="font-extrabold text-[13px]">{isViewingOther? `${activeSelf?.display_name}'s Family Tree` : "My Family Tree"}</h2>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-white rounded-full border border-[#e9e2d6] px-1 py-1">
                <button onClick={()=>setTreeDepth(d=>Math.max(0,d-1))} disabled={treeDepth===0} className="w-6 h-6 rounded-full bg-black text-white text-[12px] font-bold flex items-center justify-center disabled:opacity-30">−</button>
                <span className="text-[10px] font-bold px-1">L{treeDepth}</span>
                <button onClick={()=>setTreeDepth(d=>Math.min(10,d+1))} disabled={treeDepth===10} className="w-6 h-6 rounded-full bg-black text-white text-[12px] font-bold flex items-center justify-center disabled:opacity-30">+</button>
              </div>
              <button onClick={() => { setEditingFamilyId(null); setNewName(''); setNewBio(''); setNewPhoto(null); setNewPreview(''); setSelectedSpouseForChild(''); setSearchResults([]); setSelectedExistingId(null); setShowAddmodel(true); }} className="px-3 py-1.5 bg-black text-white rounded-[4px] text-[10px] font-bold">
                {isViewingOther? `+ Add ${firstName}'s Member` : "+ Add Member"}
              </button>
            </div>
          </div>
          <div className="bg-[#fffefb] border border-[#e9e2d6] rounded-b-[10px] p-0 overflow-hidden">
            <div className="family-scroll">
              {treeDepth===0? (
                (() => {
                  const hasParents =!!(father || mother);
                  const hasSibs = siblingsFixed.length>0;
                  let minLeft = 562;
                  if(father) minLeft = Math.min(minLeft, 520);
                  if(mother) minLeft = Math.min(minLeft, 616);
                  if(hasSibs) minLeft = Math.min(minLeft, 440 - (siblingsFixed.length-1)*100);
                  if(spouse) minLeft = Math.min(minLeft, 670, 622);
                  else minLeft = Math.min(minLeft, 568);
                  let minTop = 312;
                  if(hasParents) minTop = 180;
                  else if(hasSibs) minTop = 246;
                  const shiftX = minLeft - 20;
                  const shiftY = minTop - 20;
                  const canvasW = Math.max(500, 180 + siblingsFixed.length*110 + children.length*80) + 64;
                  const canvasH = hasParents? 552 : (hasSibs? 420 : 360);
                  const isSingle = sourceProfiles.length<=1;
                  if(isSingle){
                    return (<div className="flex items-center justify-center w-full h-[400px]"><Node p={activeSelf} big /></div>);
                  }
                  return (
                    <div className="relative" style={{width:`${canvasW}px`,height:`${canvasH}px`,minWidth:'500px', marginLeft:'0', marginRight:'auto', overflow:'visible'}}>
                      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{zIndex:0, overflow:'visible'}}>
                        {father && mother && <line x1={584-shiftX} y1={212-shiftY} x2={616-shiftX} y2={212-shiftY} stroke="#c9ad83" strokeWidth="1.5"/>}
                        {(father || mother) && <line x1={600-shiftX} y1={212-shiftY} x2={600-shiftX} y2={312-shiftY} stroke="#c9ad83" strokeWidth="1.5"/>}
                        {activeSelf && spouse && <line x1={638-shiftX} y1={352-shiftY} x2={670-shiftX} y2={352-shiftY} stroke="#c9ad83" strokeWidth="1.5"/>}
                        {activeSelf && spouse && children.length>0 && <line x1={654-shiftX} y1={352-shiftY} x2={654-shiftX} y2={444-shiftY} stroke="#c9ad83" strokeWidth="1.5"/>}
                        {siblingsFixed.length>1 && (
                          <>
                            <line x1={472-shiftX} y1={236-shiftY} x2={472 - (siblingsFixed.length-1)*100 - shiftX} y2={236-shiftY} stroke="#c9ad83" strokeWidth="1.2"/>
                            {siblingsFixed.map((_,i)=> <line key={`s-${i}`} x1={472 - i*100 - shiftX} y1={236-shiftY} x2={472 - i*100 - shiftX} y2={246-shiftY} stroke="#c9ad83" strokeWidth="1.2"/>)}
                          </>
                        )}
                        {siblingsFixed.length>0 && (
                          <>
                            <line x1={600-shiftX} y1={285-shiftY} x2={504-shiftX} y2={285-shiftY} stroke="#c9ad83" strokeWidth="1.5"/>
                            <line x1={504-shiftX} y1={278-shiftY} x2={504-shiftX} y2={285-shiftY} stroke="#c9ad83" strokeWidth="1.5"/>
                          </>
                        )}
                      </svg>
                      {father && mother && <div className="absolute" style={{left:`${593-shiftX}px`,top:`${190-shiftY}px`,zIndex:3,fontSize:'10px'}}>❤️</div>}
                      {activeSelf && spouse && <div className="absolute" style={{left:`${647-shiftX}px`,top:`${330-shiftY}px`,zIndex:3,fontSize:'10px'}}>❤️</div>}
                      <div className="absolute" style={{left:`${520-shiftX}px`,top:`${180-shiftY}px`,zIndex:3}}>{father && <Node p={father} />}</div>
                      <div className="absolute" style={{left:`${616-shiftX}px`,top:`${180-shiftY}px`,zIndex:3}}>{mother && <Node p={mother} />}</div>
                      {siblingsFixed.map((s, idx) => (
                        <div key={s.id} className="absolute" style={{left:`${440 - idx*100 - shiftX}px`, top:`${246-shiftY}px`,zIndex:3}}>
                          <Node p={s} />
                        </div>
                      ))}
                      <div className="absolute" style={{left:`${562-shiftX}px`,top:`${312-shiftY}px`,zIndex:3}}><Node p={activeSelf} big /></div>
                      <div className="absolute" style={{left:`${670-shiftX}px`,top:`${320-shiftY}px`,zIndex:3}}>{spouse && <Node p={spouse} />}</div>
                      <div className="absolute flex" style={{left: spouse? `${622-shiftX}px` : `${568-shiftX}px`, top:`${444-shiftY}px`, gap:'16px', flexWrap:'nowrap', zIndex:3}}>
                        {children.map(c=> (
                          <div key={c.id} style={{width:'64px', flexShrink:0}}>
                            <Node p={c} />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div style={{width:'1200px',minWidth:'1200px',minHeight:'540px',padding:'20px'}}>
                  <p className="text-[10px] text-gray-500 mb-3">Level {treeDepth} - Unlimited tree ({allProfiles.length} members) - includes Govindan's siblings like Shivan Nair</p>
                  <div className="flex flex-wrap gap-5">
                    {allProfiles.map(p=><Node key={p.id} p={p} />)}
                  </div>
                </div>
              )}
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
          <div className="bg-white rounded-[10px] w-full max-w-[380px] p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-extrabold text-[16px]">
                {editingFamilyId
        ? 'Edit Family Member'
                  : isViewingOther
          ? `Add ${activeSelf?.display_name}'s Family Member`
                    : 'Add Family Member'}
              </h3>
              <button onClick={()=>{ setShowAddmodel(false); setEditingFamilyId(null); setNewName(''); setNewBio(''); setNewPhoto(null); setNewPreview(''); setSelectedSpouseForChild(''); setSearchResults([]); setSelectedExistingId(null); }} className="w-8 h-8 bg-gray-100 rounded-[4px]">✕</button>
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
              <div className="relative">
                <input value={newName} onChange={e=>{setNewName(e.target.value); setSelectedExistingId(null);}} placeholder="Full Name" className="w-full h-10 bg-[#f8f5f0] rounded-[8px] px-3 text-[12px]" />
                {selectedExistingId && <p className="text-[10px] text-green-600 font-bold mt-1">✓ Linking to existing member</p>}
                {searching && <p className="text-[10px] text-gray-400 mt-1">Searching...</p>}
                {searchResults.length > 0 &&!editingFamilyId &&!selectedExistingId && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-[#e9e2d6] rounded-[8px] shadow-lg max-h-[180px] overflow-y-auto">
                    <p className="text-[9px] text-gray-500 px-3 py-1 font-bold bg-[#f8f5f0]">{'Type G → G names, Go → Go names. Click to link.'}</p>
                    {searchResults.map(r=>(
                      <div key={r.id} onClick={()=>{ setSelectedExistingId(r.id); setNewName(r.display_name); setSearchResults([]); }} className="px-3 py-2 hover:bg-[#efe8d3] cursor-pointer flex items-center gap-2 border-b border-gray-50">
                        {r.photo_url? <img src={r.photo_url} className="w-6 h-6 rounded-[4px] object-cover" alt="" /> : <div className="w-6 h-6 rounded-[4px] bg-[#c9ad83] text-white flex items-center justify-center text-[10px] font-bold">{r.display_name[0]}</div>}
                        <div className="flex-1"><p className="text-[11px] font-bold">{r.display_name}</p><p className="text-[8px] text-gray-500 truncate">{r.id} {r.father_id? '• has father' : ''} {r.mother_id? '• has mother' : ''}</p></div>
                        <span className="text-[9px] bg-black text-white px-2 py-0.5 rounded-[4px]">Link</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {!selectedExistingId && (
                <>
                  <textarea value={newBio} onChange={e=>setNewBio(e.target.value)} placeholder="Small description / bio" className="w-full h-16 bg-[#f8f5f0] rounded-[8px] px-3 py-2 text-[12px]" />
                  <div className="flex items-center gap-3">
                    <input type="file" accept="image/*" onChange={handleNewPhoto} className="text-[11px]" />
                    {newPreview && <img src={newPreview} className="w-12 h-12 rounded-[8px] object-cover" />}
                  </div>
                </>
              )}
              {selectedExistingId && (
                <div className="bg-[#efe8d3] p-3 rounded-[8px] text-[11px]">
                  <p className="font-bold">Will link as {newRelation} of {activeSelf?.display_name || self?.display_name}</p>
                  <p className="text-[10px] text-gray-600 mt-1">His/her already saved parents, spouse, children will automatically show in tree — no duplicate.</p>
                  <button onClick={()=>{setSelectedExistingId(null); setNewName(''); setSearchResults([]);}} className="text-[10px] underline mt-1">Create new instead</button>
                </div>
              )}
              <button onClick={handleAddFamily} disabled={adding} className="w-full h-11 bg-black text-white rounded-[4px] font-bold text-[12px] mt-2">
                {adding? 'Saving...' : selectedExistingId? `Link as ${newRelation} ✅` : editingFamilyId? 'Save' : isViewingOther? `Add as ${firstName}'s ${newRelation}` : `Add as ${newRelation}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}