import React, { useState, useEffect } from 'react';
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

  useEffect(()=>{
    if(!userId) return;
    fetch(`${API_URL}/api/profile/${userId}`)
      .then(r=>r.json())
      .then(d=>{
        if(d.success && d.data){
          const p=d.data;
          setForm({
            display_name: p.display_name || p.user_name || '',
            nickname: p.nickname || '',
            gender: p.gender || 'Male',
            dob: p.dob ? p.dob.split('T')[0] : '',
            email: p.user_email || p.email || storedUser.email || '',
            mobile_number: p.mobile_number || p.user_mobile || storedUser.mobile || '',
            visibility: p.visibility || 'Public',
            show_in_deck: p.show_in_deck ?? 1,
            is_alive: p.is_alive ?? 1,
            dod: p.dod ? p.dod.split('T')[0] : '',
            photo_url: p.photo_url || ''
          });
          setPhoto(p.photo_url || '');
        }
        setLoading(false);
      }).catch(()=>setLoading(false));
  },[userId]);

  // FIX FOR YOUR SCREENSHOT ERROR - Upload returns HTML, not JSON
  const handleImage = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result;
      setPhoto(base64);
      setForm(s=>({...s, photo_url: base64})); // Keep base64 so save works even if upload fails
      
      try {
        const res = await fetch(`${API_URL}/api/upload`, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ image: base64 })
        });
        const text = await res.text();
        try {
          const j = JSON.parse(text);
          if(j.success && j.url){
            setPhoto(j.url);
            setForm(s=>({...s, photo_url: j.url}));
          }
        } catch {
          // If server returns <!DOCTYPE html> - ignore, keep base64
          console.log('Upload endpoint returned HTML, using base64');
        }
      } catch(err){ console.log('Upload skip', err); }
    };
    reader.readAsDataURL(file);
  };

  const handleChange = (k,v) => setForm(s=>({...s,[k]:v}));

  const handleSave = async () => {
    setSaving(true);
    try{
      const res = await fetch(`${API_URL}/api/profile/${userId}`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          display_name: form.display_name, nickname: form.nickname, gender: form.gender,
          dob: form.dob || null, email: form.email, mobile: form.mobile_number,
          mobile_number: form.mobile_number, visibility: form.visibility,
          show_in_deck: parseInt(form.show_in_deck), is_alive: parseInt(form.is_alive),
          dod: form.dod || null, photo_url: form.photo_url
        })
      });
      const j = await res.json();
      if(!j.success) throw new Error(j.error);
      localStorage.setItem('user', JSON.stringify({...storedUser, name: form.display_name, photo_url: form.photo_url}));
      alert('Saved ✅');
      if(onGoDeck) onGoDeck();
    }catch(e){ alert('Save failed: '+e.message); }
    setSaving(false);
  };

  if(loading) return <div style={{padding:40, textAlign:'center'}}>Loading...</div>;

  const inputStyle = {width:'100%', padding:'12px 16px', borderRadius:'20px', border:'none', background:'#f0ede8', fontSize:'13px', boxSizing:'border-box', outline:'none'};
  const labelStyle = {fontSize:'9px', fontWeight:800, color:'#8a7a65', letterSpacing:'0.5px', marginBottom:'6px', display:'block'};

  return (
    <div style={{minHeight:'100vh', background:'#f7f4ef'}}>
      <CommonHeader self={storedUser} page="profile-edit" onDeck={onGoDeck} onProfile={onGoProfile} onLogout={onLogout} />
      <div style={{maxWidth:'480px', margin:'0 auto', padding:'16px'}}>
        
        {/* Top - Choose File */}
        <div style={{background:'white', borderRadius:'14px', padding:'20px', textAlign:'center'}}>
          <div style={{width:'110px', height:'110px', margin:'0 auto', borderRadius:'16px', overflow:'hidden', background:'#e9e2d6'}}>
            {photo ? <img src={photo} style={{width:'100%', height:'100%', objectFit:'cover'}}/> : <div style={{lineHeight:'110px', fontSize:'40px'}}>👤</div>}
          </div>
          <label style={{display:'inline-block', marginTop:'14px', background:'#111', color:'white', padding:'8px 18px', borderRadius:'20px', fontSize:'11px', fontWeight:800, cursor:'pointer'}}>
            Choose File <input type="file" accept="image/*" onChange={handleImage} style={{display:'none'}}/>
          </label>
          <div style={{fontSize:'9px', color:'#aaa', marginTop:'8px'}}>Drag image to move • + / - to zoom</div>
          
          <div style={{fontWeight:800, fontSize:'16px', marginTop:'16px'}}>{form.display_name || 'Your Name'} {form.nickname && `(${form.nickname})`}</div>
        </div>

        {/* Form - Exact old look */}
        <div style={{background:'white', borderRadius:'14px', padding:'16px', marginTop:'12px', display:'flex', flexDirection:'column', gap:'14px'}}>
          
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
              <label style={{display:'flex', gap:'6px', fontSize:'12px', fontWeight:700, cursor:'pointer'}}><input type="radio" checked={form.visibility==='Public'} onChange={()=>handleChange('visibility','Public')}/> Public</label>
              <label style={{display:'flex', gap:'6px', fontSize:'12px', fontWeight:700, cursor:'pointer'}}><input type="radio" checked={form.visibility==='Private'} onChange={()=>handleChange('visibility','Private')}/> Private</label>
            </div>
            <div style={{marginTop:'14px'}}><label style={labelStyle}>SHOW IN DECK</label><select value={form.show_in_deck} onChange={e=>handleChange('show_in_deck', Number(e.target.value))} style={inputStyle}><option value={1}>Yes - Show in Deck</option><option value={0}>No - Hide</option></select></div>
            <div style={{fontSize:'9px', color:'#aaa', marginTop:'8px'}}>If Private, your name will show as Hidden in Deck.jsx</div>
          </div>

          <button onClick={handleSave} disabled={saving} style={{background:'#111', color:'white', padding:'14px', borderRadius:'30px', fontWeight:800, border:'none', marginTop:'8px'}}>
            {saving ? 'Saving...' : 'Save Profile →'}
          </button>
        </div>
      </div>
    </div>
  );
}