import React, { useState, useEffect, useRef } from 'react';
import CommonHeader from './CommonHeader.jsx';
const API_URL = import.meta.env.VITE_API_URL || "https://api.clandeck.com";

// Longest side of the saved "original" photo (keeps uploads small and fast)
const MAX_ORIGINAL_SIDE = 1600;

export default function ProfileEdit({ onGoProfile, onLogout, onGoDeck }) {
  const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
  const userId = storedUser?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // PHOTO
  const [photoOriginal, setPhotoOriginal] = useState(''); // photo_original_url
  const [photoCompressed, setPhotoCompressed] = useState(''); // photo_compressed_url
  const [photoUrl, setPhotoUrl] = useState(''); // photo_url (for compatibility)
  const [photoDirty, setPhotoDirty] = useState(false); // true when a new photo was chosen or moved/zoomed
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({x:0, y:0});
  const [dragging, setDragging] = useState(false);
  const [startPos, setStartPos] = useState({x:0, y:0});
  const containerRef = useRef(null);

  const [form, setForm] = useState({
    display_name: '', nickname: '', gender: 'Male', dob: '', email: '', mobile_number: '',
    visibility: 'Public', show_in_deck: 1, is_alive: 1, dod: '', bio: '', location: ''
  });

  // RIGHT - Family
  const [myProfile, setMyProfile] = useState(null);
  const [family, setFamily] = useState({ father:null, mother:null, siblings:[], spouses:[], children:[] });
  const [showAdd, setShowAdd] = useState(null);
  const [formName, setFormName] = useState('');
  const [formGender, setFormGender] = useState('Male');
  const [selSpouseId, setSelSpouseId] = useState('');

  useEffect(()=>{
    if(!userId) return;
    fetch(`${API_URL}/api/profiles/family-tree?user_id=${userId}`)
      .then(r=>r.json()).then(async j=>{
        let p = null;
        if(j.success && j.myProfile){
          p = j.myProfile;
          setMyProfile(p); setFamily(j.family);
          if(j.family.spouses.length>0) setSelSpouseId(j.family.spouses[0].id);
        } else {
          const r = await fetch(`${API_URL}/api/profile/${userId}`);
          const d = await r.json();
          if(d.success) p = d.data;
        }
        if(p){
          setForm({
            display_name: p.display_name || '', nickname: p.nickname || '',
            gender: p.gender || 'Male', dob: p.dob ? p.dob.split('T')[0] : '',
            email: p.email || p.user_email || storedUser.email || '',
            mobile_number: p.mobile_number || p.user_mobile || storedUser.mobile || '',
            visibility: p.visibility || 'Public', show_in_deck: p.show_in_deck ?? 1,
            is_alive: p.is_alive ?? 1, dod: p.dod ? p.dod.split('T')[0] : '',
            bio: p.bio || '', location: p.location || ''
          });
          // PHOTO FIELDS FROM DB
          setPhotoOriginal(p.photo_original_url || p.photo_url || '');
          setPhotoCompressed(p.photo_compressed_url || p.photo_url || '');
          setPhotoUrl(p.photo_url || '');
          setZoom(parseFloat(p.photo_zoom) || 1);
          setPos({x: parseFloat(p.photo_x) || 0, y: parseFloat(p.photo_y) || 0});
        }
        setLoading(false);
      }).catch(()=>setLoading(false));
  },[userId]);

  // Drag logic
  const onMouseDown = (e) => {
    setDragging(true);
    setStartPos({x: (e.touches ? e.touches[0].clientX : e.clientX) - pos.x, y: (e.touches ? e.touches[0].clientY : e.clientY) - pos.y});
  };
  const onMouseMove = (e) => {
    if(!dragging) return;
    setPos({x: (e.touches ? e.touches[0].clientX : e.clientX) - startPos.x, y: (e.touches ? e.touches[0].clientY : e.clientY) - startPos.y});
    setPhotoDirty(true);
  };
  const onMouseUp = () => setDragging(false);

  const changeZoom = (fn) => { setZoom(fn); setPhotoDirty(true); };

  // Choose a file: shrink it (longest side 1600px) and keep it as the "original"
  const handleImage = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, MAX_ORIGINAL_SIDE / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const base64 = canvas.toDataURL('image/jpeg', 0.9);
        setPhotoOriginal(base64);
        setPhotoUrl(base64);
        setPhotoCompressed('');
        setZoom(1); setPos({x:0, y:0});
        setPhotoDirty(true);
      };
      img.onerror = () => alert('This image could not be read. Please choose a JPG or PNG photo.');
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Makes the 400x400 "compressed" picture exactly as it looks in the preview box
  const getCroppedImage = async () => {
    if(!photoOriginal) return '';
    return new Promise((resolve, reject)=>{
      const size = 400;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.crossOrigin = 'anonymous'; // needed when the original comes from the bucket URL
      img.onload = () => {
        const contW = containerRef.current?.clientWidth || 160;
        const k = size / contW;
        const base = Math.max(contW / img.width, contW / img.height); // same as objectFit: cover
        const drawW = img.width * base * zoom * k;
        const drawH = img.height * base * zoom * k;
        const cx = size / 2 + pos.x * k;
        const cy = size / 2 + pos.y * k;
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
        try { resolve(canvas.toDataURL('image/jpeg', 0.8)); }
        catch { reject(new Error('Could not process the photo')); }
      };
      img.onerror = () => reject(new Error('Could not load the photo'));
      img.src = photoOriginal;
    });
  };

  const handleChange = (k,v) => setForm(s=>({...s,[k]:v}));

  const handleSave = async () => {
    setSaving(true);
    try{
      let finalOriginalUrl = photoOriginal;
      let finalCompressedUrl = photoCompressed || photoUrl;
      let bucketKey = '';

      // Upload to the bucket only when the photo was changed (new file, moved or zoomed)
      if(photoOriginal && photoDirty){
        const compressed = await getCroppedImage();
        const body = { compressed };
        if(photoOriginal.startsWith('data:')) body.original = photoOriginal;
        const pr = await fetch(`${API_URL}/api/profile/${userId}/photo`, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify(body)
        });
        const pj = await pr.json().catch(()=>({}));
        if(!pr.ok || !pj.success) throw new Error(pj.error || 'Photo upload failed');
        finalCompressedUrl = pj.compressed_url;
        if(pj.original_url) finalOriginalUrl = pj.original_url;
        bucketKey = pj.bucket_key || '';
      }

      const payload = {
        display_name: form.display_name, nickname: form.nickname, gender: form.gender,
        dob: form.dob || null, email: form.email, mobile: form.mobile_number,
        mobile_number: form.mobile_number, visibility: form.visibility,
        show_in_deck: parseInt(form.show_in_deck), is_alive: parseInt(form.is_alive),
        dod: form.dod || null, bio: form.bio, location: form.location,
        photo_url: finalCompressedUrl || null,
        photo_original_url: finalOriginalUrl || null,
        photo_compressed_url: finalCompressedUrl || null,
        photo_bucket_key: bucketKey || null,
        photo_x: pos.x,
        photo_y: pos.y,
        photo_zoom: zoom
      };

      const res = await fetch(`${API_URL}/api/profile/${userId}`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const j = await res.json();
      if(!j.success) throw new Error(j.error);

      // Photo is now stored in the bucket: switch the page to the short URLs
      setPhotoOriginal(finalOriginalUrl || '');
      setPhotoCompressed(finalCompressedUrl || '');
      setPhotoUrl(finalCompressedUrl || '');
      setPhotoDirty(false);

      localStorage.setItem('user', JSON.stringify({...storedUser, name: form.display_name, photo_url: finalCompressedUrl}));
      alert('Saved ✅');
    }catch(e){ alert('Save failed: '+e.message); }
    setSaving(false);
  };

  const handleAdd = async () => {
    if(!formName.trim()) return alert('Enter name');
    const payload = {
      user_id: userId, owner_profile_id: myProfile?.id || userId,
      display_name: formName, gender: formGender, relation_type: showAdd,
      father_id: null, mother_id: null, spouse_id: showAdd==='Child' ? selSpouseId : null,
      birth_order: 1, show_in_deck: 1
    };
    const res = await fetch(`${API_URL}/api/profiles/family-add`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const j = await res.json();
    if(!j.success) return alert(j.error);
    setShowAdd(null); setFormName('');
    const fres = await fetch(`${API_URL}/api/profiles/family-tree?user_id=${userId}`);
    const fj = await fres.json();
    if(fj.success){ setFamily(fj.family); setMyProfile(fj.myProfile); }
  };

  if(loading) return <div style={{padding:40, textAlign:'center'}}>Loading...</div>;
  const inputStyle = {width:'100%', padding:'12px 16px', borderRadius:'20px', border:'none', background:'#f0ede8', fontSize:'13px', boxSizing:'border-box', outline:'none'};
  const labelStyle = {fontSize:'9px', fontWeight:800, color:'#8a7a65', letterSpacing:'0.5px', marginBottom:'6px', display:'block'};

  return (
    <div style={{minHeight:'100vh', width:'100%', background:'#f7f4ef'}} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onTouchMove={onMouseMove} onTouchEnd={onMouseUp}>
      <CommonHeader self={storedUser} page="profile-edit" onDeck={onGoDeck} onProfile={onGoProfile} onLogout={onLogout} />
      {/* FULL WIDTH: two columns on wide screens, one column on small screens */}
      <div style={{width:'100%', boxSizing:'border-box', padding:'16px 24px', display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap:'16px', alignItems:'start'}}>
        
        {/* LEFT - PERSONAL WITH PHOTO TOOL */}
        <div>
          <div style={{background:'white', borderRadius:'14px', padding:'20px', textAlign:'center'}}>
            <div ref={containerRef} style={{width:'160px', height:'160px', margin:'0 auto', borderRadius:'18px', overflow:'hidden', background:'#e9e2d6', position:'relative', cursor: dragging?'grabbing':'grab', touchAction:'none'}}
                 onMouseDown={onMouseDown} onTouchStart={onMouseDown}>
              {(photoOriginal || photoUrl) ? (
                <img src={photoOriginal || photoUrl} draggable={false}
                     style={{width:'100%', height:'100%', objectFit:'cover', transform:`translate(${pos.x}px, ${pos.y}px) scale(${zoom})`, transformOrigin:'center', userSelect:'none', pointerEvents:'none'}}/>
              ) : <div style={{lineHeight:'160px', fontSize:'50px'}}>👤</div>}
            </div>
            <div style={{display:'flex', alignItems:'center', justifyContent:'center', gap:'10px', marginTop:'12px'}}>
              <button onClick={()=>changeZoom(z=>Math.max(1, z-0.1))} style={{width:'30px', height:'30px', borderRadius:'50%', border:'1px solid #ddd', background:'white', fontWeight:800}}>-</button>
              <span style={{fontSize:'10px', color:'#888'}}>Drag to move • +/- zoom</span>
              <button onClick={()=>changeZoom(z=>Math.min(3, z+0.1))} style={{width:'30px', height:'30px', borderRadius:'50%', border:'1px solid #ddd', background:'white', fontWeight:800}}>+</button>
            </div>
            <label style={{display:'inline-block', marginTop:'14px', background:'#111', color:'white', padding:'8px 18px', borderRadius:'20px', fontSize:'11px', fontWeight:800, cursor:'pointer'}}>
              Choose File <input type="file" accept="image/*" onChange={handleImage} style={{display:'none'}}/>
            </label>
            <div style={{fontWeight:800, fontSize:'16px', marginTop:'12px'}}>{form.display_name || 'Your Name'} {form.nickname && `(${form.nickname})`}</div>
            <div style={{fontSize:'10px', color:'#999', marginTop:'4px'}}>
              {photoDirty ? 'Photo changed - press Save to upload' : (photoOriginal ? 'Photo saved ✓' : 'No photo yet')}
            </div>
          </div>

          <div style={{background:'white', borderRadius:'14px', padding:'16px', marginTop:'12px', display:'flex', flexDirection:'column', gap:'14px'}}>
            <h3 style={{margin:0, fontWeight:800, fontSize:'14px'}}>Personal Details</h3>
            <div><label style={labelStyle}>FULL NAME</label><input value={form.display_name} onChange={e=>handleChange('display_name', e.target.value)} style={inputStyle}/></div>
            <div><label style={labelStyle}>NICK NAME</label><input value={form.nickname} onChange={e=>handleChange('nickname', e.target.value)} style={inputStyle}/></div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
              <div><label style={labelStyle}>GENDER</label><select value={form.gender} onChange={e=>handleChange('gender', e.target.value)} style={inputStyle}><option>Male</option><option>Female</option></select></div>
              <div><label style={labelStyle}>DOB</label><input type="date" value={form.dob} onChange={e=>handleChange('dob', e.target.value)} style={inputStyle}/></div>
            </div>
            <div><label style={labelStyle}>EMAIL</label><input value={form.email} onChange={e=>handleChange('email', e.target.value)} style={inputStyle}/></div>
            <div><label style={labelStyle}>PHONE</label><input value={form.mobile_number} onChange={e=>handleChange('mobile_number', e.target.value)} style={inputStyle}/></div>
            <div><label style={labelStyle}>LOCATION</label><input value={form.location} onChange={e=>handleChange('location', e.target.value)} style={inputStyle}/></div>
            <div><label style={labelStyle}>BIO</label><textarea value={form.bio} onChange={e=>handleChange('bio', e.target.value)} style={{...inputStyle, borderRadius:'14px'}} rows={3}/></div>
            <div style={{background:'#faf7f2', borderRadius:'12px', padding:'14px', border:'1px solid #e9e2d6'}}>
              <label style={labelStyle}>PUBLIC VIEW</label>
              <div style={{display:'flex', gap:'20px', marginTop:'8px'}}>
                <label style={{display:'flex', gap:'6px', fontSize:'12px', fontWeight:700}}><input type="radio" checked={form.visibility==='Public'} onChange={()=>handleChange('visibility','Public')}/> Public</label>
                <label style={{display:'flex', gap:'6px', fontSize:'12px', fontWeight:700}}><input type="radio" checked={form.visibility==='Private'} onChange={()=>handleChange('visibility','Private')}/> Private</label>
              </div>
              <div style={{marginTop:'12px'}}><label style={labelStyle}>SHOW IN DECK</label><select value={form.show_in_deck} onChange={e=>handleChange('show_in_deck', Number(e.target.value))} style={inputStyle}><option value={1}>Yes</option><option value={0}>No</option></select></div>
            </div>
            <button onClick={handleSave} disabled={saving} style={{background:'#111', color:'white', padding:'14px', borderRadius:'30px', fontWeight:800, border:'none'}}>{saving ? 'Saving...' : 'Save Personal →'}</button>
          </div>
        </div>

        {/* RIGHT - FAMILY */}
        <div>
          <div style={{background:'white', borderRadius:'14px', padding:'16px'}}>
            <h3 style={{margin:0, fontWeight:800, fontSize:'14px'}}>Family Members & Groups</h3>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:'14px'}}>
              {!family.father && <button onClick={()=>setShowAdd('Father')} style={{background:'#111', color:'white', padding:'10px', borderRadius:'20px', fontWeight:700, border:'none', fontSize:'11px'}}> + Father</button>}
              {!family.mother && <button onClick={()=>setShowAdd('Mother')} style={{background:'#111', color:'white', padding:'10px', borderRadius:'20px', fontWeight:700, border:'none', fontSize:'11px'}}> + Mother</button>}
              <button onClick={()=>setShowAdd('Sibling')} style={{background:'white', border:'1px solid #e9e2d6', padding:'10px', borderRadius:'20px', fontWeight:700, fontSize:'11px'}}> + Sibling</button>
              <button onClick={()=>setShowAdd('Spouse')} style={{background:'white', border:'1px solid #e9e2d6', padding:'10px', borderRadius:'20px', fontWeight:700, fontSize:'11px'}}> + Spouse ({family.spouses.length})</button>
              <button onClick={()=>setShowAdd('Child')} style={{background:'white', border:'1px solid #e9e2d6', padding:'10px', borderRadius:'20px', fontWeight:700, fontSize:'11px'}}> + Child</button>
            </div>
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:'12px', marginTop:'12px'}}>
            <div style={{background:'white', borderRadius:'12px', padding:'14px'}}><b style={{fontSize:'11px'}}>SPOUSES ({family.spouses.length})</b><div style={{display:'flex', gap:'8px', flexWrap:'wrap', marginTop:'8px'}}>{family.spouses.map(s=><div key={s.id} style={{background:'#faf7f2', padding:'8px 12px', borderRadius:'20px', fontSize:'11px', border:'1px solid #e9e2d6'}}>{s.display_name}</div>)} {family.spouses.length===0 && <span style={{fontSize:'11px', color:'#aaa'}}>None</span>}</div></div>
            <div style={{background:'white', borderRadius:'12px', padding:'14px'}}><b style={{fontSize:'11px'}}>SIBLINGS ({family.siblings.length})</b><div style={{display:'flex', gap:'8px', flexWrap:'wrap', marginTop:'8px'}}>{family.siblings.map(s=><div key={s.id} style={{background:'#faf7f2', padding:'8px 12px', borderRadius:'20px', fontSize:'11px', border:'1px solid #e9e2d6'}}>{s.display_name}</div>)} {family.siblings.length===0 && <span style={{fontSize:'11px', color:'#aaa'}}>None</span>}</div></div>
            <div style={{background:'white', borderRadius:'12px', padding:'14px'}}><b style={{fontSize:'11px'}}>CHILDREN ({family.children.length})</b><div style={{display:'flex', gap:'8px', flexWrap:'wrap', marginTop:'8px'}}>{family.children.map(c=><div key={c.id} style={{background:'#faf7f2', padding:'8px 12px', borderRadius:'20px', fontSize:'11px', border:'1px solid #e9e2d6'}}>{c.display_name}</div>)} {family.children.length===0 && <span style={{fontSize:'11px', color:'#aaa'}}>None</span>}</div></div>
          </div>
        </div>
      </div>

      {showAdd && (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'16px'}} onClick={()=>setShowAdd(null)}>
          <div style={{background:'white', borderRadius:'16px', padding:'20px', width:'100%', maxWidth:'400px'}} onClick={e=>e.stopPropagation()}>
            <h3 style={{fontWeight:800, margin:0}}>Add {showAdd}</h3>
            <input value={formName} onChange={e=>setFormName(e.target.value)} placeholder={`${showAdd} Name*`} style={{width:'100%', marginTop:'14px', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}} />
            <div style={{display:'flex', gap:'10px', marginTop:'16px'}}>
              <button onClick={()=>setShowAdd(null)} style={{flex:1, padding:'12px', borderRadius:'20px', border:'1px solid #ddd', background:'white', fontWeight:700}}>Cancel</button>
              <button onClick={handleAdd} style={{flex:2, padding:'12px', borderRadius:'20px', border:'none', background:'black', color:'white', fontWeight:800}}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}