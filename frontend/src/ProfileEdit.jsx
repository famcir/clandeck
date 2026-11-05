import React, { useState, useEffect, useRef } from 'react';
import CommonHeader from './CommonHeader.jsx';
const API_URL = import.meta.env.VITE_API_URL || "https://clandeck-production.up.railway.app";

export default function ProfileEdit({ onGoProfile, onLogout, onGoDeck }) {
  const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
  const userId = storedUser?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState('');
  const [form, setForm] = useState({
    display_name: '', nickname: '', gender: 'Male', dob: '', email: '', mobile_number: '',
    visibility: 'Public', show_in_deck: 1, is_alive: 1, dod: '', photo_url: ''
  });

  // PHOTO POSITIONING TOOL - states
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({x:0, y:0});
  const [dragging, setDragging] = useState(false);
  const [startPos, setStartPos] = useState({x:0, y:0});
  const containerRef = useRef(null);
  const [originalFile, setOriginalFile] = useState(null);

  // RIGHT - Family
  const [myProfile, setMyProfile] = useState(null);
  const [family, setFamily] = useState({ father:null, mother:null, siblings:[], spouses:[], children:[] });
  const [showAdd, setShowAdd] = useState(null);
  const [formName, setFormName] = useState('');
  const [formGender, setFormGender] = useState('Male');
  const [selFather, setSelFather] = useState(true);
  const [selMother, setSelMother] = useState(true);
  const [selSpouseId, setSelSpouseId] = useState('');
  const [birthOrder, setBirthOrder] = useState(1);

  useEffect(()=>{
    if(!userId) return;
    fetch(`${API_URL}/api/profiles/family-tree?user_id=${userId}`)
      .then(r=>r.json()).then(async j=>{
        if(j.success){
          setMyProfile(j.myProfile); setFamily(j.family);
          if(j.family.spouses.length>0) setSelSpouseId(j.family.spouses[0].id);
          setBirthOrder((j.family.children.length||0)+(j.family.siblings.length||0)+1);
          const p=j.myProfile;
          setForm({
            display_name: p.display_name || '', nickname: p.nickname || '',
            gender: p.gender || 'Male', dob: p.dob ? p.dob.split('T')[0] : '',
            email: p.email || p.user_email || storedUser.email || '',
            mobile_number: p.mobile_number || p.user_mobile || storedUser.mobile || '',
            visibility: p.visibility || 'Public', show_in_deck: p.show_in_deck ?? 1,
            is_alive: p.is_alive ?? 1, dod: p.dod ? p.dod.split('T')[0] : '',
            photo_url: p.photo_url || ''
          });
          setPhoto(p.photo_url || '');
        }
        setLoading(false);
      }).catch(()=>setLoading(false));
  },[userId]);

  // DRAG LOGIC FOR PHOTO TOOL
  const onMouseDown = (e) => {
    setDragging(true);
    setStartPos({x: (e.touches ? e.touches[0].clientX : e.clientX) - pos.x, y: (e.touches ? e.touches[0].clientY : e.clientY) - pos.y});
  };
  const onMouseMove = (e) => {
    if(!dragging) return;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    setPos({x: cx - startPos.x, y: cy - startPos.y});
  };
  const onMouseUp = () => setDragging(false);

  const handleImage = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    setOriginalFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPhoto(ev.target.result);
      setZoom(1); setPos({x:0, y:0});
    };
    reader.readAsDataURL(file);
  };

  const getCroppedImage = async () => {
    if(!photo || !containerRef.current) return form.photo_url;
    return new Promise((resolve)=>{
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const size = 400;
      canvas.width = size; canvas.height = size;
      const img = new Image();
      img.src = photo;
      img.onload = () => {
        ctx.fillStyle = 'white'; ctx.fillRect(0,0,size,size);
        const scale = zoom;
        const imgW = containerRef.current.clientWidth * scale;
        const imgH = (img.height / img.width) * containerRef.current.clientWidth * scale;
        const centerX = size/2 + pos.x;
        const centerY = size/2 + pos.y;
        ctx.drawImage(img, centerX - imgW/2, centerY - imgH/2, imgW, imgH);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => resolve(photo);
    });
  };

  const handleChange = (k,v) => setForm(s=>({...s,[k]:v}));

  const handleSave = async () => {
    setSaving(true);
    try{
      let finalPhoto = form.photo_url;
      if(photo){
        finalPhoto = await getCroppedImage();
        try{
          const res = await fetch(`${API_URL}/api/upload`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ image: finalPhoto })
          });
          const txt = await res.text();
          try{ const j=JSON.parse(txt); if(j.success&&j.url) finalPhoto=j.url; }catch{}
        }catch{}
      }

      const res = await fetch(`${API_URL}/api/profile/${userId}`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          display_name: form.display_name, nickname: form.nickname, gender: form.gender,
          dob: form.dob || null, email: form.email, mobile: form.mobile_number,
          mobile_number: form.mobile_number, visibility: form.visibility,
          show_in_deck: parseInt(form.show_in_deck), is_alive: parseInt(form.is_alive),
          dod: form.dod || null, photo_url: finalPhoto
        })
      });
      const j = await res.json();
      if(!j.success) throw new Error(j.error);
      localStorage.setItem('user', JSON.stringify({...storedUser, name: form.display_name, photo_url: finalPhoto}));
      alert('Personal saved with positioned photo ✅');
    }catch(e){ alert('Save failed: '+e.message); }
    setSaving(false);
  };

  const handleAdd = async () => {
    if(!formName.trim()) return alert('Enter name');
    if((showAdd==='Sibling') && !family.father && !family.mother) return alert('Add Father/Mother first');
    if((showAdd==='Child') && family.spouses.length===0) return alert('Add Spouse first');
    const payload = {
      user_id: userId, owner_profile_id: myProfile?.id || userId,
      display_name: formName, gender: formGender, relation_type: showAdd,
      father_id: showAdd==='Sibling' ? (selFather && family.father ? family.father.id : null) : null,
      mother_id: showAdd==='Sibling' ? (selMother && family.mother ? family.mother.id : null) : null,
      spouse_id: showAdd==='Child' ? selSpouseId : null,
      birth_order: birthOrder, show_in_deck: 1
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

  const canAddSibling = family.father || family.mother;
  const canAddChild = family.spouses.length > 0;
  if(loading) return <div style={{padding:40, textAlign:'center'}}>Loading...</div>;
  const inputStyle = {width:'100%', padding:'12px 16px', borderRadius:'20px', border:'none', background:'#f0ede8', fontSize:'13px', boxSizing:'border-box', outline:'none'};
  const labelStyle = {fontSize:'9px', fontWeight:800, color:'#8a7a65', letterSpacing:'0.5px', marginBottom:'6px', display:'block'};

  return (
    <div style={{minHeight:'100vh', background:'#f7f4ef'}} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onTouchMove={onMouseMove} onTouchEnd={onMouseUp}>
      <CommonHeader self={storedUser} page="profile-edit" onDeck={onGoDeck} onProfile={onGoProfile} onLogout={onLogout} />
      
      <div style={{maxWidth:'1100px', margin:'0 auto', padding:'16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px'}}>
        
        {/* LEFT - PERSONAL WITH PHOTO POSITIONING TOOL */}
        <div>
          <div style={{background:'white', borderRadius:'14px', padding:'20px', textAlign:'center'}}>
            {/* PHOTO TOOL BOX */}
            <div ref={containerRef} style={{width:'160px', height:'160px', margin:'0 auto', borderRadius:'18px', overflow:'hidden', background:'#e9e2d6', position:'relative', cursor: dragging?'grabbing':'grab', touchAction:'none'}}
                 onMouseDown={onMouseDown} onTouchStart={onMouseDown}>
              {photo ? (
                <img src={photo} draggable={false}
                     style={{width:'100%', height:'100%', objectFit:'cover', transform:`translate(${pos.x}px, ${pos.y}px) scale(${zoom})`, transformOrigin:'center', userSelect:'none', pointerEvents:'none'}}/>
              ) : <div style={{lineHeight:'160px', fontSize:'50px'}}>👤</div>}
              <div style={{position:'absolute', inset:0, border:'2px dashed rgba(0,0,0,0.1)', borderRadius:'18px', pointerEvents:'none'}}></div>
            </div>

            <div style={{display:'flex', alignItems:'center', justifyContent:'center', gap:'10px', marginTop:'12px'}}>
              <button onClick={()=>setZoom(z=>Math.max(1, z-0.1))} style={{width:'30px', height:'30px', borderRadius:'50%', border:'1px solid #ddd', background:'white', fontWeight:800}}>-</button>
              <span style={{fontSize:'10px', color:'#888'}}>Drag to move • + / - to zoom</span>
              <button onClick={()=>setZoom(z=>Math.min(3, z+0.1))} style={{width:'30px', height:'30px', borderRadius:'50%', border:'1px solid #ddd', background:'white', fontWeight:800}}>+</button>
            </div>

            <label style={{display:'inline-block', marginTop:'14px', background:'#111', color:'white', padding:'8px 18px', borderRadius:'20px', fontSize:'11px', fontWeight:800, cursor:'pointer'}}>
              Choose File <input type="file" accept="image/*" onChange={handleImage} style={{display:'none'}}/>
            </label>
            
            <div style={{fontWeight:800, fontSize:'16px', marginTop:'12px'}}>{form.display_name || 'Your Name'} {form.nickname && `(${form.nickname})`}</div>
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
            <div style={{background:'#faf7f2', borderRadius:'12px', padding:'14px', border:'1px solid #e9e2d6'}}>
              <label style={labelStyle}>PUBLIC VIEW</label>
              <div style={{display:'flex', gap:'20px', marginTop:'8px'}}>
                <label style={{display:'flex', gap:'6px', fontSize:'12px', fontWeight:700}}><input type="radio" checked={form.visibility==='Public'} onChange={()=>handleChange('visibility','Public')}/> Public</label>
                <label style={{display:'flex', gap:'6px', fontSize:'12px', fontWeight:700}}><input type="radio" checked={form.visibility==='Private'} onChange={()=>handleChange('visibility','Private')}/> Private</label>
              </div>
              <div style={{marginTop:'12px'}}><label style={labelStyle}>SHOW IN DECK</label><select value={form.show_in_deck} onChange={e=>handleChange('show_in_deck', Number(e.target.value))} style={inputStyle}><option value={1}>Yes - Show in Deck</option><option value={0}>No - Hide</option></select></div>
            </div>
            <button onClick={handleSave} disabled={saving} style={{background:'#111', color:'white', padding:'14px', borderRadius:'30px', fontWeight:800, border:'none'}}>{saving ? 'Saving...' : 'Save Personal →'}</button>
          </div>
        </div>

        {/* RIGHT - FAMILY */}
        <div>
          <div style={{background:'white', borderRadius:'14px', padding:'16px'}}>
            <h3 style={{margin:0, fontWeight:800, fontSize:'14px'}}>Family Members & Groups</h3>
            <div style={{fontSize:'11px', color:'#888', marginTop:'6px'}}>Father: {family.father?.display_name || 'Not added'} | Mother: {family.mother?.display_name || 'Not added'}</div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:'14px'}}>
              {!family.father && <button onClick={()=>setShowAdd('Father')} style={{background:'#111', color:'white', padding:'10px', borderRadius:'20px', fontWeight:700, border:'none', fontSize:'11px'}}> + Add Father</button>}
              {!family.mother && <button onClick={()=>setShowAdd('Mother')} style={{background:'#111', color:'white', padding:'10px', borderRadius:'20px', fontWeight:700, border:'none', fontSize:'11px'}}> + Add Mother</button>}
              <button disabled={!canAddSibling} onClick={()=>{setSelFather(!!family.father); setSelMother(!!family.mother); setShowAdd('Sibling')}} style={{background: canAddSibling?'white':'#eee', border:'1px solid #e9e2d6', padding:'10px', borderRadius:'20px', fontWeight:700, fontSize:'11px', opacity:canAddSibling?1:0.5}}> + Sibling</button>
              <button onClick={()=>setShowAdd('Spouse')} style={{background:'white', border:'1px solid #e9e2d6', padding:'10px', borderRadius:'20px', fontWeight:700, fontSize:'11px'}}> + Spouse {family.spouses.length>0 && `(${family.spouses.length})`}</button>
              <button disabled={!canAddChild} onClick={()=>{setSelSpouseId(family.spouses[0]?.id||''); setShowAdd('Child')}} style={{background: canAddChild?'white':'#eee', border:'1px solid #e9e2d6', padding:'10px', borderRadius:'20px', fontWeight:700, fontSize:'11px', opacity:canAddChild?1:0.5}}> + Child</button>
            </div>
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:'12px', marginTop:'12px'}}>
            <div style={{background:'white', borderRadius:'12px', padding:'14px'}}>
              <b style={{fontSize:'11px'}}>SPOUSES ({family.spouses.length}) - Groups</b>
              <div style={{display:'flex', gap:'8px', flexWrap:'wrap', marginTop:'8px'}}>
                {family.spouses.map(s=><div key={s.id} style={{background:'#faf7f2', padding:'8px 12px', borderRadius:'20px', fontSize:'11px', border:'1px solid #e9e2d6'}}>{s.display_name} - G{s.spouse_group} No{s.spouse_number}</div>)}
                {family.spouses.length===0 && <span style={{fontSize:'11px', color:'#aaa'}}>No spouse</span>}
              </div>
            </div>
            <div style={{background:'white', borderRadius:'12px', padding:'14px'}}>
              <b style={{fontSize:'11px'}}>SIBLINGS ({family.siblings.length})</b>
              <div style={{display:'flex', gap:'8px', flexWrap:'wrap', marginTop:'8px'}}>
                {family.siblings.map(s=><div key={s.id} style={{background:'#faf7f2', padding:'8px 12px', borderRadius:'20px', fontSize:'11px', border:'1px solid #e9e2d6'}}>{s.display_name}</div>)}
                {family.siblings.length===0 && <span style={{fontSize:'11px', color:'#aaa'}}>No siblings</span>}
              </div>
            </div>
            <div style={{background:'white', borderRadius:'12px', padding:'14px'}}>
              <b style={{fontSize:'11px'}}>CHILDREN ({family.children.length})</b>
              <div style={{display:'flex', gap:'8px', flexWrap:'wrap', marginTop:'8px'}}>
                {family.children.map(c=><div key={c.id} style={{background:'#faf7f2', padding:'8px 12px', borderRadius:'20px', fontSize:'11px', border:'1px solid #e9e2d6'}}>{c.display_name} - O{c.birth_order}</div>)}
                {family.children.length===0 && <span style={{fontSize:'11px', color:'#aaa'}}>No children</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAdd && (
        <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'16px'}} onClick={()=>setShowAdd(null)}>
          <div style={{background:'white', borderRadius:'16px', padding:'20px', width:'100%', maxWidth:'400px'}} onClick={e=>e.stopPropagation()}>
            <h3 style={{fontWeight:800, margin:0}}>Add {showAdd}</h3>
            <input value={formName} onChange={e=>setFormName(e.target.value)} placeholder={`${showAdd} Name*`} style={{width:'100%', marginTop:'14px', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}} />
            <select value={formGender} onChange={e=>setFormGender(e.target.value)} disabled={showAdd==='Father'||showAdd==='Mother'} style={{width:'100%', marginTop:'10px', padding:'12px', borderRadius:'10px', border:'1px solid #ddd'}}><option>Male</option><option>Female</option></select>
            {showAdd==='Child' && <div style={{marginTop:'12px'}}>{family.spouses.map(sp=><label key={sp.id} style={{display:'flex', gap:'8px', fontSize:'12px', marginTop:'8px'}}><input type="radio" name="spouse" checked={selSpouseId===sp.id} onChange={()=>setSelSpouseId(sp.id)}/> {sp.display_name}</label>)}</div>}
            <div style={{display:'flex', gap:'10px', marginTop:'16px'}}>
              <button onClick={()=>setShowAdd(null)} style={{flex:1, padding:'12px', borderRadius:'20px', border:'1px solid #ddd', background:'white', fontWeight:700}}>Cancel</button>
              <button onClick={handleAdd} style={{flex:2, padding:'12px', borderRadius:'20px', border:'none', background:'black', color:'white', fontWeight:800}}>Add {showAdd}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}