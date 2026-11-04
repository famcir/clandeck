import { useEffect, useState } from 'react';
const API_URL = import.meta.env.VITE_API_URL || "https://clandeck-production.up.railway.app";

export default function ProfileEdit() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const userId = user.id || localStorage.getItem('userId');
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    display_name: '', nickname: '', gender: 'Male', dob: '', email: '', mobile_number: '', visibility: 'Private', show_in_deck: 1, is_alive: 1, dod: '', location: '', bio: '', photo_url: ''
  });

  useEffect(() => {
    if(!userId) return;
    fetch(`${API_URL}/api/profile/${userId}`)
      .then(r=>r.json())
      .then(d=>{
        if(d.success && d.data){
          const p = d.data;
          setForm({
            display_name: p.display_name || p.user_name || '',
            nickname: p.nickname || '',
            gender: p.gender || 'Male',
            dob: p.dob ? p.dob.split('T')[0] : '',
            email: p.user_email || p.email || '',
            mobile_number: p.mobile_number || p.user_mobile || '',
            visibility: p.visibility || 'Private',
            show_in_deck: p.show_in_deck ?? 1,
            is_alive: p.is_alive ?? 1,
            dod: p.dod ? p.dod.split('T')[0] : '',
            location: p.location || '',
            bio: p.bio || '',
            photo_url: p.photo_url || ''
          });
        }
        setLoading(false);
      }).catch(()=>setLoading(false));
  }, [userId]);

  const handleChange = (k,v) => setForm(s=>({...s, [k]:v}));

  const handleSave = async () => {
    setSaving(true);
    try{
      const res = await fetch(`${API_URL}/api/profile/${userId}`, {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          display_name: form.display_name,
          nickname: form.nickname,
          gender: form.gender,
          dob: form.dob,
          email: form.email,
          mobile: form.mobile_number,
          mobile_number: form.mobile_number,
          visibility: form.visibility,
          show_in_deck: form.show_in_deck,
          is_alive: form.is_alive,
          dod: form.dod,
          location: form.location,
          bio: form.bio,
          photo_url: form.photo_url
        })
      });
      const data = await res.json();
      if(data.success){
        alert('Profile saved successfully! ✅');
        localStorage.setItem('user', JSON.stringify({...user, name: form.display_name, email: form.email, mobile: form.mobile_number}));
        window.location.href = '/deck';
      } else throw new Error(data.error);
    }catch(e){ alert('Save failed: '+e.message); }
    setSaving(false);
  };

  if(loading) return <div style={{padding:20}}>Loading...</div>;

  return (
    <div style={{maxWidth:'600px', margin:'0 auto', padding:'20px', background:'#fff', minHeight:'100vh'}}>
      <h2 style={{fontWeight:800, marginBottom:20}}>Edit Profile</h2>
      
      <div style={{display:'flex', flexDirection:'column', gap:14}}>
        <label>Full Name<input value={form.display_name} onChange={e=>handleChange('display_name', e.target.value)} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd'}}/></label>
        <label>Nick Name<input value={form.nickname} onChange={e=>handleChange('nickname', e.target.value)} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd'}}/></label>
        
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
          <label>Gender<select value={form.gender} onChange={e=>handleChange('gender', e.target.value)} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd'}}><option>Male</option><option>Female</option><option>Other</option></select></label>
          <label>DOB<input type="date" value={form.dob} onChange={e=>handleChange('dob', e.target.value)} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd'}}/></label>
        </div>

        <label>Email<input value={form.email} onChange={e=>handleChange('email', e.target.value)} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd'}}/></label>
        <label>Phone<input value={form.mobile_number} onChange={e=>handleChange('mobile_number', e.target.value)} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd'}}/></label>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
          <label>Public/Private<select value={form.visibility} onChange={e=>handleChange('visibility', e.target.value)} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd'}}><option>Private</option><option>Public</option></select></label>
          <label>Show in Deck<select value={form.show_in_deck} onChange={e=>handleChange('show_in_deck', Number(e.target.value))} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd'}}><option value={1}>Yes</option><option value={0}>No</option></select></label>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
          <label>Is Alive<select value={form.is_alive} onChange={e=>handleChange('is_alive', Number(e.target.value))} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd'}}><option value={1}>Alive</option><option value={0}>Deceased</option></select></label>
          {form.is_alive===0 && <label>DOD<input type="date" value={form.dod} onChange={e=>handleChange('dod', e.target.value)} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd'}}/></label>}
        </div>

        <label>Location<input value={form.location} onChange={e=>handleChange('location', e.target.value)} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd'}}/></label>
        <label>Bio<textarea value={form.bio} onChange={e=>handleChange('bio', e.target.value)} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd'}} rows={3}/></label>

        <button onClick={handleSave} disabled={saving} style={{background:'#111', color:'white', padding:'12px', borderRadius:'10px', fontWeight:800, cursor:'pointer', marginTop:10}}>
          {saving ? 'Saving...' : 'Save Profile →'}
        </button>
      </div>
    </div>
  );
}