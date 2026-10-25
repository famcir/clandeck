import React, { useState, useEffect, useRef } from 'react';
import CommonHeader from './CommonHeader.jsx';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export default function ProfileEdit({ onGoProfile, onLogout, onGoDeck }) {
  const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
  const [family, setFamily] = useState([]);
  const [groups, setGroups] = useState([]);
  const [form, setForm] = useState({
    display_name: storedUser?.name || localStorage.getItem('profile_name') || '',
    nickname: localStorage.getItem('profile_nickname') || '',
    uname: storedUser?.uname || '',
    dob: localStorage.getItem('profile_dob') || '',
    gender: localStorage.getItem('profile_gender') || 'Male',
    email: localStorage.getItem('profile_email') || storedUser?.email || '',
    phone: localStorage.getItem('profile_phone') || '',
    birth_order: 1,
    show_in_deck: parseInt(localStorage.getItem('profile_show_in_deck') || '1'),
    visibility: localStorage.getItem('profile_visibility') || 'public'
  });
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(localStorage.getItem('photo_url') || '');
  const [pos, setPos] = useState(JSON.parse(localStorage.getItem('clandeck_photo_pos') || '{"x":50,"y":50,"zoom":100}'));
  const [relationType, setRelationType] = useState('Father');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberPhoto, setNewMemberPhoto] = useState(null);
  const [newMemberPreview, setNewMemberPreview] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPhoto, setEditPhoto] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [savedInfo, setSavedInfo] = useState({ key: '', url: '' });

  const boxRef = useRef(null);
  const dragRef = useRef({ dragging:false, startX:0, startY:0, startPosX:50, startPosY:50 });

  const uploadToBucket = async (profileId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_URL}/api/upload/profile/${profileId}`, { method: 'POST', body: fd });
    const j = await res.json();
    if (!j.success) throw new Error(j.error || 'Upload failed');
    return { url: j.url, key: j.key };
  };

  const fetchFamily = async () => {
    try {
      const userId = storedUser?.id || storedUser?.uname || 'self';
      const res = await fetch(`${API_URL}/api/family?user_id=${userId}`);
      const j = await res.json();
      if (j.success && j.data) {
        const clean = j.data.filter(p => {
          if (!p) return false;
          if (p.photo_url?.startsWith('blob:') || p.photo_url?.startsWith('data:')) return false;
          if (p.id === storedUser?.id) return false;
          if ((p.display_name || p.name || '').trim().toLowerCase() === (storedUser?.name || '').trim().toLowerCase()) return false;
          return true;
        });
        setFamily(clean);
        localStorage.setItem('clandeck_family', JSON.stringify(clean));
      }
    } catch (e) {
      const local = JSON.parse(localStorage.getItem('clandeck_family') || '[]');
      const cleanLocal = local.filter(p => {
        if (!p) return false;
        if (p.id === storedUser?.id) return false;
        if ((p.display_name || p.name || '').trim().toLowerCase() === (storedUser?.name || '').trim().toLowerCase()) return false;
        return true;
      });
      setFamily(cleanLocal);
    }
  };

  useEffect(() => {
    fetchFamily();
    setGroups(JSON.parse(localStorage.getItem('clandeck_groups') || '[]'));
    const savedPhoto = localStorage.getItem('photo_url');
    if (savedPhoto && !savedPhoto.startsWith('blob:')) {
      setPhotoPreview(savedPhoto);
    }
    try { setPos(JSON.parse(localStorage.getItem('clandeck_photo_pos') || '{"x":50,"y":50,"zoom":100}')); } catch {}
    const userId = storedUser?.id || storedUser?.uname || 'self';
    fetch(`${API_URL}/api/profile/${userId}`)
      .then(r => r.json())
      .then(j => {
        if (j?.data?.photo_url && !j.data.photo_url.startsWith('blob:')) {
          setPhotoPreview(j.data.photo_url);
          localStorage.setItem('photo_url', j.data.photo_url);
        }
        if (j?.data?.photo_x) {
          const newPos = { x: Number(j.data.photo_x), y: Number(j.data.photo_y), zoom: Number(j.data.photo_zoom) };
          setPos(newPos);
          localStorage.setItem('clandeck_photo_pos', JSON.stringify(newPos));
        }
        if (j?.data) {
          setForm(f => ({
            ...f,
            display_name: j.data.display_name || j.data.name || f.display_name,
            nickname: j.data.nickname || localStorage.getItem('profile_nickname') || f.nickname,
            gender: j.data.gender || f.gender,
            dob: j.data.dob ? j.data.dob.split('T')[0] : f.dob,
            email: j.data.bio?.includes('@') ? j.data.bio : f.email,
            phone: j.data.mobile_number || j.data.phone || f.phone,
            visibility: j.data.visibility || f.visibility,
            show_in_deck: j.data.show_in_deck ?? f.show_in_deck
          }));
          if (j.data.mobile_number) localStorage.setItem('profile_phone', j.data.mobile_number);
          if (j.data.nickname) localStorage.setItem('profile_nickname', j.data.nickname);
          if (j.data.visibility) localStorage.setItem('profile_visibility', j.data.visibility);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (photoPreview?.startsWith('blob:')) URL.revokeObjectURL(photoPreview);
      if (newMemberPreview?.startsWith('blob:')) URL.revokeObjectURL(newMemberPreview);
    };
  }, []);

  const handlePhoto = (e) => {
    const f = e.target.files[0]; if(!f) return;
    setPhotoFile(f);
    if (photoPreview?.startsWith('blob:')) URL.revokeObjectURL(photoPreview);
    const url = URL.createObjectURL(f);
    setPhotoPreview(url);
  };

  const handleNewMemberPhoto = (e) => {
    const f = e.target.files[0]; if(!f) return;
    setNewMemberPhoto(f);
    if (newMemberPreview?.startsWith('blob:')) URL.revokeObjectURL(newMemberPreview);
    setNewMemberPreview(URL.createObjectURL(f));
  };

  const savePos = (newPos) => {
    setPos(newPos);
    localStorage.setItem('clandeck_photo_pos', JSON.stringify(newPos));
  };

  const changeZoom = (delta) => {
    const nz = Math.min(200, Math.max(50, pos.zoom + delta));
    savePos({ ...pos, zoom: nz });
  };

  const onPointerDown = (e) => {
    if (!photoPreview) return;
    dragRef.current.dragging = true;
    dragRef.current.startX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    dragRef.current.startY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    dragRef.current.startPosX = pos.x;
    dragRef.current.startPosY = pos.y;
  };
  const onPointerMove = (e) => {
    if (!dragRef.current.dragging) return;
    const curX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const curY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    const dx = curX - dragRef.current.startX;
    const dy = curY - dragRef.current.startY;
    let nx = dragRef.current.startPosX - dx * 0.6;
    let ny = dragRef.current.startPosY - dy * 0.6;
    nx = Math.min(100, Math.max(0, nx));
    ny = Math.min(100, Math.max(0, ny));
    setPos(p => ({ ...p, x: nx, y: ny }));
  };
  const onPointerUp = () => {
    if (!dragRef.current.dragging) return;
    dragRef.current.dragging = false;
    localStorage.setItem('clandeck_photo_pos', JSON.stringify(pos));
  };

  const handleSaveProfile = async () => {
    setUploading(true);
    try {
      const profileId = storedUser?.id || storedUser?.uname || 'self';
      let uploadedUrl = localStorage.getItem('photo_url') || '';
      let uploadedKey = localStorage.getItem('photo_bucket_key') || '';

      if (photoFile) {
        const result = await uploadToBucket(profileId, photoFile);
        uploadedUrl = result.url;
        uploadedKey = result.key;
        localStorage.setItem('photo_url', uploadedUrl);
        localStorage.setItem('photo_bucket_key', uploadedKey);
        setPhotoPreview(uploadedUrl);
      }

      const updatedUser = {...storedUser, name: form.display_name, uname: form.uname, email: form.email};
      localStorage.setItem('user', JSON.stringify(updatedUser));
      localStorage.setItem('profile_name', form.display_name);
      localStorage.setItem('profile_nickname', form.nickname);
      localStorage.setItem('profile_gender', form.gender);
      localStorage.setItem('profile_dob', form.dob);
      localStorage.setItem('profile_email', form.email);
      localStorage.setItem('profile_phone', form.phone);
      localStorage.setItem('profile_visibility', form.visibility);
      localStorage.setItem('profile_show_in_deck', form.show_in_deck.toString());
      localStorage.setItem('clandeck_photo_pos', JSON.stringify(pos));

      const privacy = JSON.parse(localStorage.getItem('clandeck_privacy') || '{}');
      privacy.showName = form.visibility === 'public';
      privacy.showInDeck = form.show_in_deck === 1;
      localStorage.setItem('clandeck_privacy', JSON.stringify(privacy));

      // FIXED: Send exact DB column names mobile_number + photo_x/y/zoom
      try {
        const res = await fetch(`${API_URL}/api/profile/${profileId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name: form.display_name,
            nickname: form.nickname,
            gender: form.gender,
            dob: form.dob || null,
            mobile_number: form.phone,
            bio: form.email,
            visibility: form.visibility,
            show_in_deck: form.show_in_deck,
            photo_url: uploadedUrl || localStorage.getItem('photo_url') || null,
            photo_compressed_url: uploadedUrl || localStorage.getItem('photo_url') || null,
            photo_original_url: uploadedUrl || localStorage.getItem('photo_url') || null,
            photo_bucket_key: uploadedKey || localStorage.getItem('photo_bucket_key') || null,
            photo_x: pos.x,
            photo_y: pos.y,
            photo_zoom: pos.zoom
          })
        });
        const j = await res.json();
        console.log('Profile save response:', j);
      } catch (e) { console.error('Profile save failed', e); }

      setSavedInfo({ key: uploadedKey || `${profileId}/profileimg/...`, url: uploadedUrl || 'No image uploaded' });
      setShowPopup(true);

    } catch (e) {
      alert('Upload failed: ' + e.message);
    }
    setUploading(false);
  };

  const addMember = async () => {
    if(!newMemberName.trim()) return alert('Enter name');
    setUploading(true);
    try {
      const payload = {
        name: newMemberName, display_name: newMemberName,
        relation: relationType, relation_type: relationType,
        birth_order: 1,
        user_id: storedUser?.id || storedUser?.uname || 'self',
        show_in_deck: 1
      };
      const res = await fetch(`${API_URL}/api/family`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error);
      let newProfile = j.data;

      if (newMemberPhoto) {
        const result = await uploadToBucket(newProfile.id, newMemberPhoto);
        const url = result.url;
        const upd = await fetch(`${API_URL}/api/family/${newProfile.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photo_url: url, photo_compressed_url: url, photo_original_url: url })
        });
        const uj = await upd.json();
        newProfile = uj.data;
      }

      const newFam = [...family, newProfile];
      setFamily(newFam);
      localStorage.setItem('clandeck_family', JSON.stringify(newFam));
      setNewMemberName(''); setNewMemberPhoto(null);
      if (newMemberPreview?.startsWith('blob:')) URL.revokeObjectURL(newMemberPreview);
      setNewMemberPreview('');
    } catch (e) { alert(e.message); }
    setUploading(false);
  };

  const deleteMember = async (id) => {
    if(!confirm('Delete this member?')) return;
    await fetch(`${API_URL}/api/family/${id}`, { method: 'DELETE' });
    const nf = family.filter(f=>f.id!==id);
    setFamily(nf);
    localStorage.setItem('clandeck_family', JSON.stringify(nf));
  };

  const toggleVisible = async (id) => {
    const res = await fetch(`${API_URL}/api/family/${id}/toggle`, { method: 'PATCH' });
    const j = await res.json();
    if (j.success) {
      const nf = family.map(f=> f.id===id ? {...f, ...j.data, visible: j.data.show_in_deck} : f);
      setFamily(nf);
      localStorage.setItem('clandeck_family', JSON.stringify(nf));
    }
  };

  const startEdit = (m) => { setEditingId(m.id); setEditName(m.display_name || m.name); };

  const saveEdit = async (id) => {
    setUploading(true);
    try {
      let url = null;
      if (editPhoto) {
        const result = await uploadToBucket(id, editPhoto);
        url = result.url;
      }
      const payload = { display_name: editName };
      if (url) { payload.photo_url = url; payload.photo_compressed_url = url; }
      const res = await fetch(`${API_URL}/api/family/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const j = await res.json();
      if (j.success) {
        const nf = family.map(f=> f.id===id ? j.data : f);
        setFamily(nf); localStorage.setItem('clandeck_family', JSON.stringify(nf));
        setEditingId(null); setEditPhoto(null);
      }
    } catch(e){ alert(e.message); }
    setUploading(false);
  };

  const quickPhotoUpload = async (id, file) => {
    if(!file) return;
    setUploading(true);
    try {
      const result = await uploadToBucket(id, file);
      const url = result.url;
      const res = await fetch(`${API_URL}/api/family/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_url: url, photo_compressed_url: url })
      });
      const j = await res.json();
      if(j.success){
        const nf = family.map(f=> f.id===id ? j.data : f);
        setFamily(nf); localStorage.setItem('clandeck_family', JSON.stringify(nf));
      }
    } catch(e){ alert(e.message); }
    setUploading(false);
  };

  const createGroup = () => {
    if(!newGroupName) return;
    const ng = {id:'g_'+Date.now(), name: newGroupName, members:[]};
    const newGr = [...groups, ng];
    setGroups(newGr);
    localStorage.setItem('clandeck_groups', JSON.stringify(newGr));
    setNewGroupName('');
  };

  const getInitial = () => (form.display_name || storedUser?.name || 'S')[0]?.toUpperCase();
  const wives = family.filter(f=> ['Spouse','Wife'].includes(f.category || f.relation || f.relation_type));
  const parents = family.filter(f=> ['Father','Mother'].includes(f.category || f.relation || f.relation_type));
  const siblings = family.filter(f=> (f.category||f.relation||f.relation_type)==='Sibling');
  const children = family.filter(f=> (f.category||f.relation||f.relation_type)==='Child');

  return (
    <div style={{minHeight:'100vh', background:'#f7f4ef', width:'100vw'}}>
      <style>{`
        .deck-grid { display: grid; grid-template-columns: 320px 1fr 340px; gap: 16px; width: 100%; padding: 16px 20px; box-sizing: border-box; }
        .card { background: #fffefb; border: 1px solid #e9e2d6; border-radius: 14px; padding: 18px; }
        .input-pill { background:#faf7f2; border:1px solid #f0e9dc; border-radius:20px; padding:9px 14px; font-size:12px; outline:none; width:100%; box-sizing:border-box; }
        .btn-black { background:#000; color:#fff; border-radius:20px; padding:10px 16px; font-size:12px; font-weight:800; border:none; cursor:pointer; width:100%; }
        @media(max-width: 1100px){ .deck-grid { grid-template-columns: 320px 1fr; } }
        @media(max-width: 700px){ .deck-grid { grid-template-columns: 1fr; padding: 12px; } }
      `}</style>

      <CommonHeader self={storedUser} page="profile-edit" onDeck={onGoDeck} onProfile={onGoProfile} onLogout={onLogout} />
      {uploading && <div style={{position:'fixed', top:0, left:0, right:0, background:'black', color:'white', textAlign:'center', padding:'6px', fontSize:'12px', fontWeight:800, zIndex:9999}}>Uploading to clandeck_bucket/{`{id}`}/profileimg... ⏳</div>}

      <div className="deck-grid">
        <div>
          <div className="card" style={{textAlign:'center'}}>
            
            <div style={{display:'flex', flexDirection:'column', alignItems:'center'}}>
              <div style={{display:'flex', alignItems:'flex-start', gap:'10px'}}>
                <div
                  ref={boxRef}
                  onMouseDown={onPointerDown}
                  onMouseMove={onPointerMove}
                  onMouseUp={onPointerUp}
                  onMouseLeave={onPointerUp}
                  onTouchStart={onPointerDown}
                  onTouchMove={onPointerMove}
                  onTouchEnd={onPointerUp}
                  style={{width:'144px', height:'144px', background:'#c9ad83', color:'white', borderRadius:'18px', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'52px', fontWeight:800, cursor: photoPreview ? 'grab' : 'default', touchAction:'none', flexShrink:0}}
                >
                  {photoPreview ? <img src={photoPreview} alt="profile" draggable={false} style={{width:'100%', height:'100%', objectFit:'cover', objectPosition: `${pos.x}% ${pos.y}%`, transform: `scale(${pos.zoom/100})`, userSelect:'none', pointerEvents:'none'}} /> : <span>{getInitial()}</span>}
                </div>

                {photoPreview && (
                  <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:'6px', marginTop:'10px'}}>
                    <button onClick={()=>changeZoom(10)} style={{width:'30px', height:'30px', borderRadius:'50%', border:'1px solid #e9e2d6', background:'white', cursor:'pointer', fontWeight:900, fontSize:'16px'}}>＋</button>
                    <div style={{fontSize:'9px', fontWeight:800, color:'#555', background:'#faf7f2', border:'1px solid #f0e9dc', borderRadius:'8px', padding:'2px 6px'}}>{pos.zoom}%</div>
                    <button onClick={()=>changeZoom(-10)} style={{width:'30px', height:'30px', borderRadius:'50%', border:'1px solid #e9e2d6', background:'white', cursor:'pointer', fontWeight:900, fontSize:'16px'}}>－</button>
                    <button onClick={()=>savePos({x:50,y:50,zoom:100})} style={{marginTop:'4px', fontSize:'7px', fontWeight:800, background:'#e9e2d6', border:'none', borderRadius:'8px', padding:'4px 8px', cursor:'pointer'}}>RESET</button>
                  </div>
                )}
              </div>

              <label style={{marginTop:'12px', background:'black', color:'white', fontSize:'10px', fontWeight:800, padding:'7px 18px', borderRadius:'20px', cursor:'pointer'}}>
                Choose File
                <input type="file" accept="image/*" onChange={handlePhoto} style={{display:'none'}} />
              </label>
              {photoPreview && <p style={{fontSize:'8px', color:'#888', marginTop:'6px'}}>Drag image to move • + / - to zoom</p>}
            </div>

            <h2 style={{fontWeight:800, fontSize:'16px', marginTop:'18px'}}>{form.display_name}{form.nickname ? ` (${form.nickname})` : ''}</h2>

            <div style={{marginTop:'14px', textAlign:'left', display:'grid', gap:'10px'}}>
              <div><label style={{fontSize:'8px', fontWeight:800, color:'#888'}}>FULL NAME</label><input value={form.display_name} onChange={e=>setForm({...form, display_name:e.target.value})} className="input-pill" /></div>

              <div><label style={{fontSize:'8px', fontWeight:800, color:'#888'}}>NICK NAME</label><input value={form.nickname} onChange={e=>setForm({...form, nickname:e.target.value})} placeholder="e.g. Sarath" className="input-pill" /></div>

              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px'}}>
                <div><label style={{fontSize:'8px', fontWeight:800, color:'#888'}}>GENDER</label>
                  <select value={form.gender} onChange={e=>setForm({...form, gender:e.target.value})} className="input-pill">
                    <option>Male</option><option>Female</option><option>Other</option>
                  </select>
                </div>
                <div><label style={{fontSize:'8px', fontWeight:800, color:'#888'}}>DOB</label><input type="date" value={form.dob} onChange={e=>setForm({...form, dob:e.target.value})} className="input-pill" /></div>
              </div>

              <div><label style={{fontSize:'8px', fontWeight:800, color:'#888'}}>EMAIL</label><input type="email" value={form.email} onChange={e=>setForm({...form, email:e.target.value})} placeholder="email@example.com" className="input-pill" /></div>

              <div><label style={{fontSize:'8px', fontWeight:800, color:'#888'}}>PHONE</label><input type="tel" value={form.phone} onChange={e=>setForm({...form, phone:e.target.value})} placeholder="+91 ..." className="input-pill" /></div>

              <div style={{background:'#faf7f2', border:'1px solid #f0e9dc', borderRadius:'10px', padding:'10px'}}>
                <label style={{fontSize:'8px', fontWeight:800, color:'#888', letterSpacing:'1px'}}>PUBLIC VIEW</label>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginTop:'6px'}}>
                  <label style={{display:'flex', alignItems:'center', gap:'6px', fontSize:'11px', fontWeight:700, cursor:'pointer'}}>
                    <input type="radio" name="visibility" checked={form.visibility==='public'} onChange={()=>setForm({...form, visibility:'public'})} /> Public
                  </label>
                  <label style={{display:'flex', alignItems:'center', gap:'6px', fontSize:'11px', fontWeight:700, cursor:'pointer'}}>
                    <input type="radio" name="visibility" checked={form.visibility==='private'} onChange={()=>setForm({...form, visibility:'private'})} /> Private
                  </label>
                </div>
                <div style={{marginTop:'8px'}}>
                  <label style={{fontSize:'8px', fontWeight:800, color:'#888'}}>SHOW IN DECK</label>
                  <select value={form.show_in_deck} onChange={e=>setForm({...form, show_in_deck: parseInt(e.target.value)})} className="input-pill" style={{marginTop:'4px'}}>
                    <option value={1}>Yes - Show in Deck</option>
                    <option value={0}>No - Hide from Deck</option>
                  </select>
                </div>
                <p style={{fontSize:'8px', color:'#aaa', marginTop:'6px'}}>If Private, your name will show as Hidden in Deck.jsx</p>
              </div>

              <button onClick={handleSaveProfile} className="btn-black" style={{marginTop:'8px'}}>Save Profile →</button>
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px'}}>
              <h3 style={{fontWeight:800, fontSize:'13px'}}>Family Members • {family.length}</h3>
              <select value={relationType} onChange={e=>setRelationType(e.target.value)} style={{background:'black', color:'white', borderRadius:'20px', padding:'5px 10px', fontSize:'11px', fontWeight:700, border:'none'}}>
                <option>Father</option><option>Mother</option><option>Sibling</option><option>Spouse</option><option>Child</option><option>Friend</option>
              </select>
            </div>

            <div style={{background:'#faf7f2', border:'1px solid #f0e9dc', borderRadius:'10px', padding:'10px', marginBottom:'12px'}}>
              <div style={{display:'flex', gap:'6px', alignItems:'center'}}>
                <label style={{width:'38px', height:'38px', background:'#e9d8b6', borderRadius:'10px', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', overflow:'hidden', border:'1px dashed #b89e6a', flexShrink:0}}>
                  {newMemberPreview ? <img src={newMemberPreview} style={{width:'100%', height:'100%', objectFit:'cover'}} /> : <span>📷</span>}
                  <input type="file" accept="image/*" onChange={handleNewMemberPhoto} style={{display:'none'}} />
                </label>
                <input value={newMemberName} onChange={e=>setNewMemberName(e.target.value)} placeholder="Name of member" className="input-pill" style={{background:'white', flex:1}} />
                <button onClick={addMember} disabled={uploading} style={{background:'black', color:'white', borderRadius:'20px', padding:'0 14px', fontSize:'11px', fontWeight:800, border:'none', cursor:'pointer', height:'36px'}}>{uploading?'...':'Add'}</button>
              </div>
              <p style={{fontSize:'9px', color:'#888', marginTop:'6px'}}>Will save to: clandeck_bucket/{`{profile_id}`}/profileimg/...</p>
            </div>

            <div style={{maxHeight:'380px', overflowY:'auto', display:'flex', flexDirection:'column', gap:'8px'}}>
              {family.map(m=>(
                <div key={m.id} style={{display:'flex', alignItems:'center', gap:'10px', padding:'8px 10px', background:'#faf7f2', borderRadius:'14px', border:'1px solid #f0e9dc'}}>
                  <label style={{width:'38px', height:'38px', background:'#e9d8b6', borderRadius:'10px', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:'13px', overflow:'hidden', cursor:'pointer', flexShrink:0}}>
                    {m.photo_url ? <img src={m.photo_url} style={{width:'100%', height:'100%', objectFit:'cover'}} /> : (m.display_name||m.name)?.[0]}
                    <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>quickPhotoUpload(m.id, e.target.files[0])} />
                  </label>
                  <div style={{flex:1, minWidth:0}}>
                    {editingId===m.id ? (
                      <div style={{display:'flex', gap:'4px'}}>
                        <input value={editName} onChange={e=>setEditName(e.target.value)} className="input-pill" style={{padding:'4px 8px'}} />
                        <button onClick={()=>saveEdit(m.id)} style={{background:'black', color:'white', border:'none', borderRadius:'8px', padding:'4px 10px', fontSize:'11px'}}>Save</button>
                        <button onClick={()=>setEditingId(null)} style={{background:'#ddd', border:'none', borderRadius:'8px', padding:'4px 8px'}}>✕</button>
                      </div>
                    ) : (
                      <>
                        <p style={{fontSize:'12px', fontWeight:700}}>{m.display_name || m.name}</p>
                        <p style={{fontSize:'9px', color:'#888', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{m.category} • {m.id}/profileimg</p>
                      </>
                    )}
                  </div>
                  {editingId!==m.id && (
                    <div style={{display:'flex', gap:'4px'}}>
                      <button onClick={()=>startEdit(m)} style={{background:'#f0e9dc', border:'none', borderRadius:'8px', padding:'5px 8px', fontSize:'12px'}}>✏️</button>
                      <button onClick={()=>deleteMember(m.id)} style={{background:'#ffe9e9', border:'none', borderRadius:'8px', padding:'5px 8px'}}>🗑️</button>
                      <button onClick={()=>toggleVisible(m.id)} style={{fontSize:'10px', background: m.show_in_deck?'black':'#ddd', color: m.show_in_deck?'white':'#555', borderRadius:'20px', padding:'4px 10px', border:'none', fontWeight:700}}>{m.show_in_deck?'ON':'OFF'}</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="card" style={{background:'black', color:'white'}}>
            <h3 style={{fontWeight:800, fontSize:'12px', marginBottom:'12px'}}>Family Groups</h3>
            <div style={{display:'grid', gap:'6px'}}>
              {[{l:'Parents', c:parents.length},{l:'Siblings', c:siblings.length},{l:'Spouses', c:wives.length},{l:'Children', c:children.length}].map((g,i)=>(
                <div key={i} style={{display:'flex', justifyContent:'space-between', background:'rgba(255,255,255,0.12)', padding:'8px 12px', borderRadius:'20px', fontSize:'12px'}}><span>{g.l}</span><span>{g.c}</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showPopup && (
        <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.65)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:99999}} onClick={()=>setShowPopup(false)}>
          <div style={{background:'white', padding:'22px', borderRadius:'14px', width:'90%', maxWidth:'480px', boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e=>e.stopPropagation()}>
            <h3 style={{margin:'0 0 10px', fontSize:'16px', fontWeight:800}}>✅ Saved to Bucket</h3>
            <p style={{fontSize:'11px', color:'#666', marginBottom:'8px'}}>Image uploaded successfully to clandeck_bucket</p>
            <div style={{background:'#f6f1e8', border:'1px solid #e9e2d6', borderRadius:'10px', padding:'12px', fontSize:'11px', wordBreak:'break-all'}}>
              <div style={{marginBottom:'8px'}}><b>Bucket Key:</b><br/>{savedInfo.key}</div>
              <div><b>Public URL:</b><br/><a href={savedInfo.url} target="_blank" rel="noreferrer" style={{color:'#8a6a3a'}}>{savedInfo.url}</a></div>
            </div>
            <button onClick={()=>setShowPopup(false)} style={{marginTop:'14px', width:'100%', background:'black', color:'white', border:'none', borderRadius:'20px', padding:'10px', fontWeight:800, cursor:'pointer'}}>OK, Stay Here</button>
          </div>
        </div>
      )}
    </div>
  );
}