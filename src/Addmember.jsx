import React, { useState, useEffect } from 'react';
import logo from './assets/clandeck_h.png';

export default function Members({ onGoProfile, onGoDeck, onLogout }) {
  const currentUserId = localStorage.getItem('userId') || 'ur001';
  const [members, setMembers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [groupMembers, setGroupMembers] = useState([]);
  const [loggedProfile, setLoggedProfile] = useState(null);

  const [searchQ, setSearchQ] = useState('');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState('all');

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newName, setNewName] = useState('');
  const [newBio, setNewBio] = useState('');
  const [newPhoto, setNewPhoto] = useState(null);
  const [newPreview, setNewPreview] = useState('');
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(null);

  const [searchResults, setSearchResults] = useState([]);
  const [selectedExistingId, setSelectedExistingId] = useState(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json()).then(d=>{
      setLoggedProfile(d?.find(p=>p.id===currentUserId) || d?.[0]);
    });
    loadAll();
  }, [currentUserId]);

  const loadAll = async () => {
    try {
      const g = await fetch(`/api/profile-groups?owner_user_id=${currentUserId}`).then(r=>r.json()).catch(()=>[]);
      setGroups(Array.isArray(g)? g : []);

      const fnd = await fetch(`/api/group-members?owner_user_id=${currentUserId}`).then(r=>r.json()).catch(()=>[]);
      setMembers(Array.isArray(fnd)? fnd : []);

      const allGms = [];
      for (const grp of (Array.isArray(g)? g : [])) {
        const gm = await fetch(`/api/group-members?group_id=${grp.id}`).then(r=>r.json()).catch(()=>[]);
        allGms.push(...(Array.isArray(gm)? gm : []));
      }
      setGroupMembers(allGms);
    } catch(e) { console.log(e); }
  };

  useEffect(() => {
    if (editingId) return;
    const q = newName.trim();
    if (q.length < 1) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/profiles?owner_user_id=${currentUserId}&search=${encodeURIComponent(q)}`);
        const data = await res.json();
        const filtered = (data||[]).filter(p =>!members.some(m => m.id === p.id) && p.id!== currentUserId);
        setSearchResults(filtered.slice(0,20));
      } catch { setSearchResults([]); }
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [newName, editingId]);

  const handlePhoto = (e) => {
    const f = e.target.files[0];
    if(!f) return;
    setNewPhoto(f);
    setNewPreview(URL.createObjectURL(f));
  };

  const handleCreateGroupInline = async () => {
    if (!newGroupName.trim()) return alert('Group name required');
    setCreatingGroup(true);
    try {
      const res = await fetch('/api/profile-groups', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name: newGroupName.trim(), owner_user_id: currentUserId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Create failed');
      const newGrp = { id: data.id, name: newGroupName.trim() };
      setGroups(prev => [...prev, newGrp]);
      setSelectedGroups(prev => [...prev, data.id]);
      setNewGroupName('');
    } catch(e){ alert(e.message); }
    setCreatingGroup(false);
  };

  const checkOwnership = async (profileId) => {
    try {
      const prof = await fetch(`/api/profiles/${profileId}`).then(r=>r.json()).catch(()=>null);
      const userCheck = await fetch(`/api/users?profile_id=${profileId}`).then(r=>r.json()).catch(()=>null);
      const isClaimed = prof?.is_claimed === 1 || prof?.owner_user_id === prof?.id;
      const isOwned = prof?.owner_user_id && prof.owner_user_id!== currentUserId;
      const hasUser = userCheck?.is_owned || (Array.isArray(userCheck) && userCheck.length>0) || userCheck?.id;
      if ((isClaimed && isOwned) || hasUser) return true;
    } catch {}
    return false;
  };

  const handleSave = async () => {
    if (!newName &&!selectedExistingId) return alert('Name required');
    if (selectedGroups.length===0 &&!editingId) return alert('Select at least one group');
    setSaving(true);
    try {
      let profileId = editingId || selectedExistingId;

      if (editingId) {
        if (await checkOwnership(editingId)) return alert('Ownership accepted - cannot edit');
        let photoUrl = members.find(m=>m.id===editingId)?.photo_url || '';
        if (newPhoto) {
          const fd = new FormData(); fd.append('file', newPhoto);
          const up = await fetch(`/api/upload?profileId=${editingId}`, {method:'POST', body: fd}).then(r=>r.json());
          photoUrl = up.url || photoUrl;
        }
        // === FIX: don't force category to Fnd on edit, keep original ===
        await fetch(`/api/profiles/${editingId}`, {
          method:'PUT',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ display_name: newName, bio: newBio, photo_url: photoUrl })
        });
        for (const gid of selectedGroups) {
          await fetch('/api/group-members', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ group_id: gid, profile_id: editingId, owner_user_id: currentUserId })
          }).catch(()=>{});
        }
      } else if (selectedExistingId) {
        profileId = selectedExistingId;
        // === FIX: DON'T change category to Fnd for family members ===
        // keep Fml so it stays in family tree
        for (const gid of selectedGroups) {
          await fetch('/api/group-members', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ group_id: gid, profile_id: profileId, owner_user_id: currentUserId })
          }).catch(()=>{});
        }
      } else {
        const res = await fetch('/api/profiles', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            display_name: newName,
            bio: newBio,
            owner_user_id: currentUserId,
            relation: 'Friend',
            relation_label: 'Friend',
            category: 'Fnd',
            group_ids: selectedGroups,
            photo_url: '',
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Add failed');
        profileId = data.id;

        if (newPhoto) {
          const fd = new FormData(); fd.append('file', newPhoto);
          const up = await fetch(`/api/upload?profileId=${profileId}`, {method:'POST', body: fd}).then(r=>r.json());
          await fetch(`/api/profiles/${profileId}`, {
            method:'PUT',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ photo_url: up.url || '' })
          });
        }
      }

      await loadAll();
      setShowModal(false);
      setEditingId(null); setNewName(''); setNewBio(''); setNewPhoto(null); setNewPreview(''); setSelectedGroups([]); setNewGroupName(''); setSelectedExistingId(null); setSearchResults([]);
    } catch(e){ alert('Failed: '+e.message); }
    setSaving(false);
  };

  const handleEdit = (m) => {
    setEditingId(m.id);
    setNewName(m.display_name || '');
    setNewBio(m.bio || '');
    setNewPreview(m.photo_url || '');
    setNewPhoto(null);
    const gids = m.group_ids? m.group_ids.split(',') : [];
    const extra = groupMembers.filter(gm=> gm.profile_id===m.id).map(gm=> gm.group_id);
    setSelectedGroups([...new Set([...gids,...extra])]);
    setSelectedExistingId(null);
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this member?')) return;
    if (await checkOwnership(id)) return alert('Ownership accepted - cannot delete');
    await fetch(`/api/profiles/${id}?deleterId=${currentUserId}`, {method:'DELETE'}).catch(()=>{});
    setMembers(prev=> prev.filter(p=> p.id!==id));
    loadAll();
  };

  const handleShare = async (m) => {
    if (sharing) return;
    setSharing(m.id);
    try {
      if (await checkOwnership(m.id)) { alert(`${m.display_name} already accepted ownership`); setSharing(null); return; }
      const firstName = (m.display_name||'User').split(' ')[0].replace(/[^a-zA-Z0-9]/g,'');
      const tempUsername = `UN${firstName}`;
      const tempPassword = 'pw1234';
      const tempId = `tmp_${Date.now()}_${Math.random().toString(36).substr(2,4)}`;
      const res = await fetch('/api/share-temp-user', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ id: tempId, name: m.display_name, email: tempUsername, password: tempPassword, profile_id: m.id, invited_by_user_id: currentUserId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await navigator.clipboard.writeText(`Username: ${tempUsername}\nPassword: ${tempPassword}\nLink: ${window.location.origin}/login?u=${tempUsername}&p=${tempPassword}`);
      alert(`Temp login created!\nUsername: ${tempUsername}\nPassword: ${tempPassword}`);
    } catch(e){ alert(e.message.includes('Ownership')? e.message : 'Share failed: '+e.message); }
    setSharing(null);
  };

  const filteredMembers = members.filter(m => {
    const matchesSearch =!searchQ || m.display_name?.toLowerCase().includes(searchQ.toLowerCase());
    const gids = m.group_ids? m.group_ids.split(',') : [];
    const extraGids = groupMembers.filter(gm=> gm.profile_id===m.id).map(gm=> gm.group_id);
    const allGids = [...new Set([...gids,...extraGids])];
    const matchesGroup = selectedGroupFilter === 'all' || allGids.includes(selectedGroupFilter);
    return matchesSearch && matchesGroup;
  });

  const getGroupName = (member) => {
    const gids = member.group_ids? member.group_ids.split(',').filter(Boolean) : [];
    const extra = groupMembers.filter(gm=> gm.profile_id===member.id).map(gm=> gm.group_id);
    const all = [...new Set([...gids,...extra])];
    if (all.length===0) return '—';
    return all.map(id=> groups.find(g=> g.id===id)?.name || id).join(', ');
  };

  return (
    <div className="min-h-screen w-full bg-[#f2efe8]" style={{fontFamily:'Plus Jakarta Sans'}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&display=swap');.card{background:#fffefb;border:1px solid #e9e2d6;border-radius:10px}`}</style>

      <header className="h-[78px] bg-[#fffefb] border-b border-[#e9e2d6] flex items-center px-3 md:px-5 justify-between sticky top-0 z-20 w-full">
        <div className="flex items-center gap-2 md:gap-3">
          <img src={logo} alt="Clandeck" className="h-[36px] md:h-[42px] w-auto object-contain" />
          <button onClick={onGoDeck} className="px-3 h-8 md:h-9 bg-[#efe8d3] border border-[#e9e2d6] rounded-[4px] text-[11px] font-bold">Deck</button>
          <button onClick={onGoProfile} className="hidden md:flex px-3 h-8 md:h-9 bg-[#efe8d3] border border-[#e9e2d6] rounded-[4px] text-[11px] font-bold">Profile</button>
        </div>
        <div className="hidden lg:flex items-center gap-6 text-[13px] font-bold text-[#5a4a32] absolute left-1/2 -translate-x-1/2">
          <span className="opacity-40">Family Tree</span>
          <span className="text-black border-b-2 border-black pb-0.5">Members</span>
          <span className="opacity-40">Groups</span>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <button onClick={onLogout} className="px-3 md:px-4 h-8 md:h-9 bg-[#6b5a45] text-white rounded-[4px] text-[11px] md:text-[12px] font-bold hover:bg-[#5a4a32]">Logout</button>
          {loggedProfile?.photo_url? <img src={loggedProfile.photo_url} onClick={onGoProfile} className="w-8 h-8 md:w-9 md:h-9 rounded-[4px] object-cover border border-[#e9e2d6] cursor-pointer" alt="" /> : <div onClick={onGoProfile} className="w-8 h-8 md:w-9 md:h-9 rounded-[4px] bg-[#6b5a45] text-white flex items-center justify-center text-[11px] font-bold cursor-pointer">{(loggedProfile?.display_name?.[0]||'?').toUpperCase()}</div>}
        </div>
      </header>

      <div className="p-4 grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-3 space-y-4">
          <div className="card p-4">
            <h3 className="font-extrabold text-[13px] mb-3">Filters</h3>
            <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search members..." className="w-full h-10 bg-[#f8f5f0] border border-[#e9e2d6] rounded-[8px] px-3 text-[12px]" />
            <div className="mt-4">
              <p className="text-[11px] font-bold text-gray-500 mb-2">GROUPS (profile_groups)</p>
              <div className="space-y-1">
                <button onClick={()=>setSelectedGroupFilter('all')} className={`w-full text-left px-3 py-2 rounded-[6px] text-[12px] font-bold ${selectedGroupFilter==='all'? 'bg-black text-white' : 'bg-[#f8f5f0] hover:bg-[#efe8d3]'}`}>All ({members.length})</button>
                {groups.map(g=> (
                  <button key={g.id} onClick={()=>setSelectedGroupFilter(g.id)} className={`w-full text-left px-3 py-2 rounded-[6px] text-[12px] font-bold flex justify-between ${selectedGroupFilter===g.id? 'bg-black text-white' : 'bg-[#f8f5f0] hover:bg-[#efe8d3]'}`}>
                    <span>{g.name}</span>
                    <span className="text-[10px] opacity-60">{groupMembers.filter(gm=>gm.group_id===g.id).length}</span>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} placeholder="New group name" className="flex-1 h-9 bg-[#f8f5f0] border border-[#e9e2d6] rounded-[6px] px-3 text-[11px]" />
                <button onClick={handleCreateGroupInline} disabled={creatingGroup} className="px-3 h-9 bg-[#6b5a45] text-white rounded-[4px] text-[11px] font-bold">{creatingGroup? '...' : '+ Add'}</button>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-6">
          <div className="bg-[#efe8d3] border border-[#e9e2d6] border-b-0 rounded-t-[10px] p-4 flex justify-between items-center">
            <h2 className="font-extrabold text-[14px]">Members ({filteredMembers.length})</h2>
            <button onClick={()=>{ setEditingId(null); setNewName(''); setNewBio(''); setNewPhoto(null); setNewPreview(''); setSelectedGroups([]); setNewGroupName(''); setSelectedExistingId(null); setSearchResults([]); setShowModal(true); }} className="px-4 py-1.5 bg-black text-white rounded-[4px] text-[11px] font-bold">+ Add Fnd</button>
          </div>
          <div className="bg-[#fffefb] border border-[#e9e2d6] rounded-b-[10px] p-4 space-y-3 min-h-[400px]">
            {filteredMembers.length===0? (
              <div className="text-center py-16">
                <p className="text-[13px] font-bold text-gray-500">No members in this group yet</p>
                <p className="text-[11px] text-gray-400 mt-1">Add Fml or Fnd to groups — they stay in tree</p>
              </div>
            ) : filteredMembers.map(m=> (
              <div key={m.id} className="flex items-center gap-3 p-3 border border-[#e9e2d6] rounded-[8px] hover:bg-[#f8f5f0] group">
                {m.photo_url? <img src={m.photo_url} className="w-12 h-12 rounded-[8px] object-cover shrink-0" alt="" /> : <div className="w-12 h-12 rounded-[8px] bg-[#c9ad83] text-white flex items-center justify-center font-extrabold shrink-0">{m.display_name?.[0]?.toUpperCase()}</div>}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[13px] truncate">{m.display_name} <span className={`text-[9px] px-1.5 py-0.5 rounded ${m.category==='Fml'?'bg-black text-white':'bg-[#efe8d3]'}`}>{m.category||'Fnd'}</span></p>
                  <p className="text-[11px] text-gray-500 truncate">{getGroupName(m)} • {m.bio?.slice(0,40) || 'No bio'}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={()=>handleShare(m)} disabled={sharing===m.id} className="px-2.5 h-7 bg-[#f8f5f0] border border-[#e9e2d6] rounded-[4px] text-[10px] font-bold hover:bg-black hover:text-white">{sharing===m.id? '...' : 'Share'}</button>
                  <button onClick={()=>handleEdit(m)} className="px-2.5 h-7 bg-black text-white rounded-[4px] text-[10px] font-bold">Edit</button>
                  <button onClick={()=>handleDelete(m.id)} className="w-7 h-7 bg-red-500 text-white rounded-[4px] text-[11px] font-bold">×</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-3 space-y-4">
          <div className="card p-4">
            <h3 className="font-bold text-[13px]">About Groups</h3>
            <p className="text-[11px] text-gray-600 mt-2 leading-5">You can add any profile (Fml family or Fnd friend) to groups. Family members stay in Family Tree even when in a group.</p>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[10px] w-full max-w-[420px] p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-extrabold text-[16px]">{editingId? 'Edit Member' : 'Add to Group'}</h3>
              <button onClick={()=>{ setShowModal(false); setEditingId(null); setSearchResults([]); }} className="w-8 h-8 bg-gray-100 rounded-[4px]">✕</button>
            </div>
            <div className="space-y-3">
              <div className="relative">
                <label className="text-[10px] font-bold text-gray-500">NAME *</label>
                <input value={newName} onChange={e=>{ setNewName(e.target.value); setSelectedExistingId(null); }} placeholder="Full Name" className="w-full h-10 bg-[#f8f5f0] border border-[#e9e2d6] rounded-[8px] px-3 text-[12px] mt-1" />
                {searching && <p className="text-[10px] text-gray-400 mt-1">Searching...</p>}
                {selectedExistingId && <p className="text-[10px] text-green-600 font-bold mt-1">✓ Existing family member — will keep Fml category</p>}
                {searchResults.length>0 &&!editingId &&!selectedExistingId && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-[#e9e2d6] rounded-[8px] shadow-lg max-h-[160px] overflow-y-auto">
                    {searchResults.map(r=> (
                      <div key={r.id} onClick={()=>{ setSelectedExistingId(r.id); setNewName(r.display_name); setSearchResults([]); }} className="px-3 py-2 hover:bg-[#efe8d3] cursor-pointer flex items-center gap-2">
                        {r.photo_url? <img src={r.photo_url} className="w-6 h-6 rounded-[4px] object-cover" /> : <div className="w-6 h-6 rounded-[4px] bg-[#c9ad83] text-white flex items-center justify-center text-[10px] font-bold">{r.display_name[0]}</div>}
                        <div className="flex-1"><p className="text-[11px] font-bold">{r.display_name}</p><p className="text-[8px] text-gray-500">{r.category || 'Fml'}</p></div>
                        <span className="text-[9px] bg-black text-white px-2 py-0.5 rounded-[4px]">Add to group</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {!selectedExistingId && (
                <>
                  <div>
                    <label className="text-[10px] font-bold text-gray-500">BIO</label>
                    <textarea value={newBio} onChange={e=>setNewBio(e.target.value)} placeholder="Short bio" className="w-full h-16 bg-[#f8f5f0] border border-[#e9e2d6] rounded-[8px] px-3 py-2 text-[12px] mt-1" />
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="file" accept="image/*" onChange={handlePhoto} className="text-[11px]" />
                    {newPreview && <img src={newPreview} className="w-12 h-12 rounded-[8px] object-cover" alt="" />}
                  </div>
                </>
              )}

              <div>
                <label className="text-[10px] font-bold text-gray-500">GROUPS * (multi-select)</label>
                <div className="mt-1 border border-[#e9e2d6] rounded-[8px] p-2 max-h-[120px] overflow-y-auto bg-[#f8f5f0]">
                  {groups.length===0 && <p className="text-[11px] text-gray-400">No groups yet — create below</p>}
                  {groups.map(g=> (
                    <label key={g.id} className="flex items-center gap-2 py-1 cursor-pointer">
                      <input type="checkbox" checked={selectedGroups.includes(g.id)} onChange={e=> {
                        if(e.target.checked) setSelectedGroups(prev=> [...prev, g.id]);
                        else setSelectedGroups(prev=> prev.filter(id=> id!==g.id));
                      }} />
                      <span className="text-[12px] font-bold">{g.name}</span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <input value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} placeholder="New group name" className="flex-1 h-10 bg-[#f8f5f0] border border-[#e9e2d6] rounded-[8px] px-3 text-[12px]" />
                  <button onClick={handleCreateGroupInline} disabled={creatingGroup} className="px-4 h-10 bg-[#6b5a45] text-white rounded-[4px] text-[11px] font-bold">{creatingGroup? '...' : 'Create'}</button>
                </div>
              </div>

              <button onClick={handleSave} disabled={saving} className="w-full h-11 bg-black text-white rounded-[4px] font-bold text-[12px] mt-2">
                {saving? 'Saving...' : editingId? 'Save' : 'Add to Group(s)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}