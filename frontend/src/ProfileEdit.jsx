import React, { useState, useEffect } from 'react';
import CommonHeader from './CommonHeader.jsx';
const API_URL = import.meta.env.VITE_API_URL || 'https://api.clandeck.com';

export default function ProfileEdit({ onGoProfile, onLogout, onGoDeck }) {
  const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
  const myUserId = storedUser?.id;

  // ===== OWN PROFILE FORM (Screenshot fields) =====
  const [form, setForm] = useState({
    display_name: '', nickname: '', gender: 'Male', dob: '', email: '',
    mobile_number: '', visibility: 'Public', show_in_deck: 1, is_alive: 1,
    dod: '', location: '', bio: '', photo_url: ''
  });
  const [preview, setPreview] = useState('');
  const [savingOwn, setSavingOwn] = useState(false);

  // ===== FAMILY STATES =====
  const [myProfile, setMyProfile] = useState(null);
  const [family, setFamily] = useState({ father:null, mother:null, siblings:[], spouses:[], children:[] });
  const [showAdd, setShowAdd] = useState(null);
  const [formName, setFormName] = useState('');
  const [formGender, setFormGender] = useState('Male');
  const [selFather, setSelFather] = useState(true);
  const [selMother, setSelMother] = useState(true);
  const [selSpouseId, setSelSpouseId] = useState('');
  const [birthOrder, setBirthOrder] = useState(1);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/profiles/family-tree?user_id=${myUserId}`);
      const j = await res.json();
      if (j.success) {
        const d = j.myProfile;
        setMyProfile(d);
        setFamily(j.family);
        // Fill own profile form from same data
        setForm({
          display_name: d.display_name || d.name || storedUser.name || '',
          nickname: d.nickname || '',
          gender: d.gender || 'Male',
          dob: d.dob ? d.dob.split('T')[0] : '',
          email: d.email || j.myProfile?.email || storedUser.email || '',
          mobile_number: d.mobile_number || storedUser.mobile || '',
          visibility: d.visibility || 'Public',
          show_in_deck: d.show_in_deck ?? 1,
          is_alive: d.is_alive ?? 1,
          dod: d.dod ? d.dod.split('T')[0] : '',
          location: d.location || '',
          bio: d.bio || '',
          photo_url: d.photo_url || storedUser.photo_url || ''
        });
        setPreview(d.photo_url || '');
        if (j.family.spouses.length > 0) setSelSpouseId(j.family.spouses[0].id);
        setBirthOrder((j.family.children.length || 0) + (j.family.siblings.length || 0) + 1);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { if(myUserId) loadAll(); }, []);
  useEffect(() => {
    if (showAdd === 'Father') setFormGender('Male');
    if (showAdd === 'Mother') setFormGender('Female');
    if (showAdd === 'Spouse' && myProfile) setFormGender(myProfile.gender === 'Male' ? 'Female' : 'Male');
  }, [showAdd]);

  const handleChange = (e) => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  // ===== FIXED IMAGE UPLOAD =====
  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result;
      setPreview(base64);
      setForm(p => ({ ...p, photo_url: base64 }));
      try {
        const res = await fetch(`${API_URL}/api/upload`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64 })
        });
        const j = await res.json();
        if (j.success && j.url) { setForm(p => ({ ...p, photo_url: j.url })); setPreview(j.url); }
      } catch {}
    };
    reader.readAsDataURL(file);
  };

  // ===== SAVE OWN PROFILE - BUTTON 1 =====
  const handleSaveOwn = async () => {
    setSavingOwn(true);
    try {
      const res = await fetch(`${API_URL}/api/profile/${myUserId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: form.display_name, nickname: form.nickname, gender: form.gender,
          dob: form.dob || null, email: form.email, mobile_number: form.mobile_number,
          mobile: form.mobile_number, visibility: form.visibility,
          show_in_deck: parseInt(form.show_in_deck), is_alive: parseInt(form.is_alive),
          dod: form.dod || null, location: form.location, bio: form.bio, photo_url: form.photo_url
        })
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error);
      localStorage.setItem('user', JSON.stringify({ ...storedUser, name: form.display_name, email: form.email, mobile: form.mobile_number, photo_url: form.photo_url }));
      alert('Own Profile Saved to both tables ✅');
    } catch (e) { alert('Save failed: ' + e.message); }
    setSavingOwn(false);
  };

  // ===== SAVE FAMILY MEMBER - BUTTON 2 =====
  const handleAddFamily = async () => {
    if (!formName.trim()) return alert('Enter name');
    if (!myProfile) return alert('My profile not loaded');
    if (showAdd === 'Sibling' && !family.father && !family.mother) return alert('Add Father/Mother first');
    if (showAdd === 'Child' && family.spouses.length === 0) return alert('Add Spouse first');

    const payload = {
      user_id: myUserId, owner_profile_id: myProfile.id, display_name: formName,
      gender: formGender, relation_type: showAdd,
      father_id: showAdd === 'Sibling' && selFather && family.father ? family.father.id : null,
      mother_id: showAdd === 'Sibling' && selMother && family.mother ? family.mother.id : null,
      spouse_id: showAdd === 'Child' ? selSpouseId : null,
      birth_order: birthOrder, show_in_deck: 1
    };
    const res = await fetch(`${API_URL}/api/profiles/family-add`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const j = await res.json();
    if (!j.success) return alert(j.error);
    setShowAdd(null); setFormName(''); loadAll();
  };

  if (loading) return <div style={{padding:40, textAlign:'center'}}>Loading...</div>;

  return (
    <div style={{minHeight:'100vh', background:'#f7f4ef'}}>
      <CommonHeader self={storedUser} page="profile-edit" onDeck={onGoDeck} onProfile={onGoProfile} onLogout={onLogout} />
      <div style={{maxWidth:'520px', margin:'0 auto', padding:'16px'}}>

        {/* ===== SECTION 1: OWN PROFILE - FROM YOUR SCREENSHOT ===== */}
        <div style={{background:'white', borderRadius:'14px', padding:'20px', textAlign:'center'}}>
          <div style={{width:'100px', height:'100px', margin:'0 auto', borderRadius:'50%', background:'#eee', overflow:'hidden'}}>
            {preview ? <img src={preview} style={{width:'100%', height:'100%', objectFit:'cover'}}/> : <div style={{lineHeight:'100px', fontSize:'32px'}}>👤</div>}
          </div>
          <label style={{display:'inline-block', marginTop:'12px', background:'black', color:'white', padding:'8px 16px', borderRadius:'20px', fontSize:'12px', cursor:'pointer'}}>
            Choose File<input type="file" accept="image/*" onChange={handleImageChange} style={{display:'none'}}/>
          </label>
        </div>

        <div style={{background:'white', borderRadius:'14px', padding:'16px', marginTop:'12px', display:'grid', gap:'12px'}}>
          <h3 style={{margin:0}}>Edit Own Profile</h3>
          <div><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>FULL NAME</label><input name="display_name" value={form.display_name} onChange={handleChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>
          <div><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>NICK NAME</label><input name="nickname" value={form.nickname} onChange={handleChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>
          <div style={{display:'flex', gap:'10px'}}>
            <div style={{flex:1}}><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>GENDER</label><select name="gender" value={form.gender} onChange={handleChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd'}}><option>Male</option><option>Female</option></select></div>
            <div style={{flex:1}}><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>DOB</label><input type="date" name="dob" value={form.dob} onChange={handleChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>
          </div>
          <div><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>EMAIL</label><input name="email" value={form.email} onChange={handleChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>
          <div><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>PHONE</label><input name="mobile_number" value={form.mobile_number} onChange={handleChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>
          <div style={{display:'flex', gap:'10px'}}>
            <select name="visibility" value={form.visibility} onChange={handleChange} style={{flex:1, padding:'12px', borderRadius:'10px', border:'1px solid #ddd'}}><option>Public</option><option>Private</option></select>
            <select name="show_in_deck" value={form.show_in_deck} onChange={handleChange} style={{flex:1, padding:'12px', borderRadius:'10px', border:'1px solid #ddd'}}><option value={1}>Show in Deck</option><option value={0}>Hide in Deck</option></select>
          </div>
          <button onClick={handleSaveOwn} disabled={savingOwn} style={{background:'black', color:'white', padding:'14px', borderRadius:'30px', border:'none', fontWeight:800}}>{savingOwn ? 'Saving...' : 'Save Own Profile'}</button>
        </div>

        {/* ===== SECTION 2: FAMILY MEMBERS ===== */}
        <div style={{background:'white', borderRadius:'14px', padding:'16px', marginTop:'16px'}}>
          <h3 style={{margin:0, fontSize:'14px'}}>Family Members</h3>
          <div style={{display:'flex', gap:'8px', flexWrap:'wrap', marginTop:'12px'}}>
            {!family.father && <button onClick={()=>setShowAdd('Father')} style={{background:'black', color:'white', borderRadius:'20px', padding:'10px 18px', fontSize:'12px', fontWeight:800, border:'none'}}> + Add Father</button>}
            {!family.mother && <button onClick={()=>setShowAdd('Mother')} style={{background:'black', color:'white', borderRadius:'20px', padding:'10px 18px', fontSize:'12px', fontWeight:800, border:'none'}}> + Add Mother</button>}
            <button onClick={()=>setShowAdd('Sibling')} style={{background:'#fff', border:'1px solid #e9e2d6', borderRadius:'20px', padding:'10px 18px', fontSize:'12px', fontWeight:800}}> + Add Sibling</button>
            <button onClick={()=>setShowAdd('Spouse')} style={{background:'#fff', border:'1px solid #e9e2d6', borderRadius:'20px', padding:'10px 18px', fontSize:'12px', fontWeight:800}}> + Add Spouse ({family.spouses.length})</button>
            <button onClick={()=>setShowAdd('Child')} disabled={family.spouses.length===0} style={{background: family.spouses.length?'#fff':'#eee', border:'1px solid #e9e2d6', borderRadius:'20px', padding:'10px 18px', fontSize:'12px', fontWeight:800}}> + Add Child</button>
          </div>
          <div style={{marginTop:'12px', fontSize:'11px', color:'#666'}}>
            Spouses: {family.spouses.map(s=>s.display_name).join(', ') || 'None'} | Children: {family.children.length} | Siblings: {family.siblings.length}
          </div>
        </div>

        {/* ===== FAMILY ADD MODAL - SAVE BUTTON 2 ===== */}
        {showAdd && (
          <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'16px'}} onClick={()=>setShowAdd(null)}>
            <div style={{background:'white', borderRadius:'16px', padding:'22px', width:'100%', maxWidth:'400px'}} onClick={e=>e.stopPropagation()}>
              <h3 style={{fontWeight:800, margin:0}}>Add {showAdd}</h3>
              <input value={formName} onChange={e=>setFormName(e.target.value)} placeholder={`${showAdd} Name*`} style={{width:'100%', marginTop:'14px', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}} />
              <select value={formGender} onChange={e=>setFormGender(e.target.value)} disabled={showAdd==='Father'||showAdd==='Mother'} style={{width:'100%', marginTop:'10px', padding:'12px', borderRadius:'10px', border:'1px solid #ddd'}}>
                <option>Male</option><option>Female</option>
              </select>
              <div style={{display:'flex', gap:'10px', marginTop:'20px'}}>
                <button onClick={()=>setShowAdd(null)} style={{flex:1, padding:'12px', borderRadius:'20px', border:'1px solid #ddd', background:'white', fontWeight:700}}>Cancel</button>
                <button onClick={handleAddFamily} style={{flex:2, padding:'12px', borderRadius:'20px', border:'none', background:'black', color:'white', fontWeight:800}}>Save {showAdd}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}