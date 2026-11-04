import React, { useState, useEffect } from 'react';
import CommonHeader from './CommonHeader.jsx';
const API_URL = import.meta.env.VITE_API_URL || 'https://api.clandeck.com';

export default function ProfileEdit({ onGoProfile, onLogout, onGoDeck }) {
  const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
  const myUserId = storedUser?.id;

  const [form, setForm] = useState({
    display_name: '',
    nickname: '',
    gender: 'Male',
    dob: '',
    email: '',
    mobile_number: '',
    visibility: 'Public',
    show_in_deck: 1,
    is_alive: 1,
    dod: '',
    location: '',
    bio: '',
    photo_url: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState('');

  // ===== FAMILY STATES - ADDED IN SAME FORMAT =====
  const [myProfile, setMyProfile] = useState(null);
  const [family, setFamily] = useState({ father:null, mother:null, siblings:[], spouses:[], children:[] });
  const [showAdd, setShowAdd] = useState(null);
  const [formName, setFormName] = useState('');
  const [formGender, setFormGender] = useState('Male');
  const [selSpouseId, setSelSpouseId] = useState('');
  const [birthOrder, setBirthOrder] = useState(1);

  useEffect(() => {
    const load = async () => {
      try {
        // Try family-tree first (gets both own + family)
        const res = await fetch(`${API_URL}/api/profiles/family-tree?user_id=${myUserId}`);
        const j = await res.json();
        if (j.success && j.myProfile) {
          const d = j.myProfile;
          setMyProfile(d);
          setFamily(j.family);
          setForm({
            display_name: d.display_name || d.name || storedUser.name || '',
            nickname: d.nickname || '',
            gender: d.gender || 'Male',
            dob: d.dob ? d.dob.split('T')[0] : '',
            email: d.email || storedUser.email || '',
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
        } else {
          // Fallback to old single profile API
          const res2 = await fetch(`${API_URL}/api/profile/${myUserId}`);
          const j2 = await res2.json();
          if (j2.success && j2.data) {
            const d = j2.data;
            setForm({
              display_name: d.display_name || d.name || storedUser.name || '',
              nickname: d.nickname || '',
              gender: d.gender || 'Male',
              dob: d.dob ? d.dob.split('T')[0] : '',
              email: d.email || d.user_email || storedUser.email || '',
              mobile_number: d.mobile_number || d.user_mobile || storedUser.mobile || '',
              visibility: d.visibility || 'Public',
              show_in_deck: d.show_in_deck ?? 1,
              is_alive: d.is_alive ?? 1,
              dod: d.dod ? d.dod.split('T')[0] : '',
              location: d.location || '',
              bio: d.bio || '',
              photo_url: d.photo_url || d.user_photo || storedUser.photo_url || ''
            });
            setPreview(d.photo_url || d.user_photo || '');
          }
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    if (myUserId) load();
  }, [myUserId]);

  useEffect(()=>{
    if(showAdd==='Father') setFormGender('Male');
    if(showAdd==='Mother') setFormGender('Female');
    if(showAdd==='Spouse' && myProfile) setFormGender(myProfile.gender==='Male' ? 'Female' : 'Male');
  }, [showAdd]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(p => ({ ...p, [name]: value }));
  };

  // ===== IMAGE UPLOAD FIX - NO MORE <!DOCTYPE ERROR =====
  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return alert('Max 5MB image');

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result;
      setPreview(base64);
      setForm(p => ({ ...p, photo_url: base64 }));
      try {
        const res = await fetch(`${API_URL}/api/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64 })
        });
        const j = await res.json();
        if (j.success && j.url) {
          setForm(p => ({ ...p, photo_url: j.url }));
          setPreview(j.url);
        }
      } catch (err) {
        console.log('Using base64 directly, upload API fallback', err.message);
      }
    };
    reader.readAsDataURL(file);
  };

  // ===== SAVE OWN PROFILE =====
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/profile/${myUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: form.display_name,
          nickname: form.nickname,
          gender: form.gender,
          dob: form.dob || null,
          email: form.email,
          mobile_number: form.mobile_number,
          mobile: form.mobile_number,
          visibility: form.visibility,
          show_in_deck: parseInt(form.show_in_deck),
          is_alive: parseInt(form.is_alive),
          dod: form.dod || null,
          location: form.location,
          bio: form.bio,
          photo_url: form.photo_url
        })
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || 'Save failed');
      
      const updatedUser = { ...storedUser, name: form.display_name, email: form.email, mobile: form.mobile_number, photo_url: form.photo_url };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      
      alert('Profile saved! Same ID updated in both users & profiles table');
      if (onGoProfile) onGoProfile();
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
    setSaving(false);
  };

  // ===== SAVE FAMILY MEMBER - SEPARATE SAVE BUTTON =====
  const handleAddFamily = async () => {
    if(!formName.trim()) return alert('Enter name');
    if(!myProfile) return alert('My profile not loaded yet');
    const payload = {
      user_id: myUserId,
      owner_profile_id: myProfile.id,
      display_name: formName,
      gender: formGender,
      relation_type: showAdd,
      birth_order: birthOrder,
      spouse_id: showAdd==='Child' ? selSpouseId : null,
      show_in_deck: 1
    };
    const res = await fetch(`${API_URL}/api/profiles/family-add`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const j = await res.json();
    if(!j.success) return alert(j.error);
    setShowAdd(null); setFormName('');
    // reload
    const res2 = await fetch(`${API_URL}/api/profiles/family-tree?user_id=${myUserId}`);
    const j2 = await res2.json();
    if(j2.success){ setFamily(j2.family); }
  };

  if (loading) return <div style={{padding:40, textAlign:'center'}}>Loading...</div>;

  return (
    <div style={{minHeight:'100vh', background:'#f7f4ef'}}>
      <CommonHeader self={storedUser} page="profile-edit" onDeck={onGoDeck} onProfile={onGoProfile} onLogout={onLogout} />
      
      <div style={{maxWidth:'480px', margin:'0 auto', padding:'16px'}}>
        {/* Photo Upload - SAME FORMAT */}
        <div style={{background:'white', borderRadius:'14px', padding:'20px', textAlign:'center'}}>
          <div style={{width:'100px', height:'100px', margin:'0 auto', borderRadius:'50%', background:'#eee', overflow:'hidden'}}>
            {preview ? <img src={preview} style={{width:'100%', height:'100%', objectFit:'cover'}}/> : <div style={{lineHeight:'100px', fontSize:'32px'}}>👤</div>}
          </div>
          <label style={{display:'inline-block', marginTop:'12px', background:'black', color:'white', padding:'8px 16px', borderRadius:'20px', fontSize:'12px', cursor:'pointer'}}>
            Choose File
            <input type="file" accept="image/*" onChange={handleImageChange} style={{display:'none'}}/>
          </label>
          <div style={{fontSize:'10px', color:'#999', marginTop:'6px'}}>Drag image to move + / - to zoom</div>
          <h3 style={{marginTop:'14px'}}>{form.display_name} {form.nickname && `(${form.nickname})`}</h3>
        </div>

        <div style={{background:'white', borderRadius:'14px', padding:'16px', marginTop:'12px', display:'grid', gap:'12px'}}>
          <div><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>FULL NAME</label><input name="display_name" value={form.display_name} onChange={handleChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>
          
          <div><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>NICK NAME</label><input name="nickname" value={form.nickname} onChange={handleChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>

          <div style={{display:'flex', gap:'10px'}}>
            <div style={{flex:1}}><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>GENDER</label><select name="gender" value={form.gender} onChange={handleChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd'}}><option>Male</option><option>Female</option><option>Other</option></select></div>
            <div style={{flex:1}}><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>DOB</label><input type="date" name="dob" value={form.dob} onChange={handleChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>
          </div>

          <div><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>EMAIL</label><input name="email" value={form.email} onChange={handleChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>

          <div><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>PHONE</label><input name="mobile_number" value={form.mobile_number} onChange={handleChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>

          <div style={{background:'#faf7f2', padding:'12px', borderRadius:'10px', border:'1px solid #e9e2d6'}}>
            <label style={{fontSize:'10px', fontWeight:800}}>PUBLIC VIEW</label>
            <div style={{display:'flex', gap:'20px', marginTop:'6px'}}>
              <label style={{fontSize:'12px', display:'flex', gap:'6px'}}><input type="radio" name="visibility" value="Public" checked={form.visibility==='Public'} onChange={handleChange}/> Public</label>
              <label style={{fontSize:'12px', display:'flex', gap:'6px'}}><input type="radio" name="visibility" value="Private" checked={form.visibility==='Private'} onChange={handleChange}/> Private</label>
            </div>
            <label style={{fontSize:'10px', fontWeight:800, marginTop:'10px', display:'block'}}>SHOW IN DECK</label>
            <select name="show_in_deck" value={form.show_in_deck} onChange={handleChange} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd', marginTop:'6px'}}>
              <option value={1}>Yes - Show in Deck</option>
              <option value={0}>No - Hide in Deck</option>
            </select>
            <div style={{fontSize:'10px', color:'#999', marginTop:'6px'}}>If Private, your name will show as Hidden in Deck.jsx</div>
          </div>

          <div style={{display:'flex', gap:'10px'}}>
            <div style={{flex:1}}><label style={{fontSize:'10px', fontWeight:800}}>IS ALIVE</label><select name="is_alive" value={form.is_alive} onChange={handleChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd'}}><option value={1}>Yes</option><option value={0}>No</option></select></div>
            {parseInt(form.is_alive)===0 && <div style={{flex:1}}><label style={{fontSize:'10px', fontWeight:800}}>DOD</label><input type="date" name="dod" value={form.dod} onChange={handleChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd'}}/></div>}
          </div>

          <button onClick={handleSave} disabled={saving} style={{background:'black', color:'white', padding:'14px', borderRadius:'30px', border:'none', fontWeight:800, marginTop:'8px'}}>
            {saving ? 'Saving...' : 'Save Profile (Same ID)'}
          </button>
        </div>

        {/* ===== FAMILY SECTION - SAME FORMAT, SEPARATE SAVE ===== */}
        <div style={{background:'white', borderRadius:'14px', padding:'16px', marginTop:'12px', display:'grid', gap:'12px'}}>
          <label style={{fontSize:'12px', fontWeight:800}}>FAMILY MEMBERS</label>
          <div style={{fontSize:'10px', color:'#888'}}>Spouses: {family.spouses.length} | Children: {family.children.length} | Siblings: {family.siblings.length}</div>
          
          <div style={{display:'flex', gap:'8px', flexWrap:'wrap'}}>
            {!family.father && <button onClick={()=>setShowAdd('Father')} style={{background:'black', color:'white', borderRadius:'20px', padding:'10px 16px', fontSize:'11px', fontWeight:800, border:'none'}}> + Add Father</button>}
            {!family.mother && <button onClick={()=>setShowAdd('Mother')} style={{background:'black', color:'white', borderRadius:'20px', padding:'10px 16px', fontSize:'11px', fontWeight:800, border:'none'}}> + Add Mother</button>}
            <button onClick={()=>setShowAdd('Sibling')} style={{background:'#fff', border:'1px solid #ddd', borderRadius:'20px', padding:'10px 16px', fontSize:'11px', fontWeight:800}}> + Add Sibling</button>
            <button onClick={()=>setShowAdd('Spouse')} style={{background:'#fff', border:'1px solid #ddd', borderRadius:'20px', padding:'10px 16px', fontSize:'11px', fontWeight:800}}> + Add Spouse</button>
            <button onClick={()=>setShowAdd('Child')} style={{background:'#fff', border:'1px solid #ddd', borderRadius:'20px', padding:'10px 16px', fontSize:'11px', fontWeight:800}}> + Add Child</button>
          </div>

          <div style={{background:'#faf7f2', padding:'12px', borderRadius:'10px', border:'1px solid #e9e2d6', display:'grid', gap:'6px'}}>
            {family.father && <div style={{fontSize:'11px'}}>Father: <b>{family.father.display_name}</b></div>}
            {family.mother && <div style={{fontSize:'11px'}}>Mother: <b>{family.mother.display_name}</b></div>}
            {family.spouses.map(s=> <div key={s.id} style={{fontSize:'11px'}}>Spouse {s.spouse_number}: <b>{s.display_name}</b></div>)}
            {family.children.map(c=> <div key={c.id} style={{fontSize:'11px'}}>Child: <b>{c.display_name}</b></div>)}
            {family.siblings.map(s=> <div key={s.id} style={{fontSize:'11px'}}>Sibling: <b>{s.display_name}</b></div>)}
            {family.spouses.length===0 && family.children.length===0 && family.siblings.length===0 && !family.father && !family.mother && <div style={{fontSize:'11px', color:'#aaa'}}>No family members added yet</div>}
          </div>
        </div>

        {/* FAMILY ADD MODAL */}
        {showAdd && (
          <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'16px'}} onClick={()=>setShowAdd(null)}>
            <div style={{background:'white', borderRadius:'14px', padding:'16px', width:'100%', maxWidth:'400px', display:'grid', gap:'12px'}} onClick={e=>e.stopPropagation()}>
              <label style={{fontSize:'12px', fontWeight:800}}>ADD {showAdd?.toUpperCase()}</label>
              <div><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>FULL NAME</label><input value={formName} onChange={e=>setFormName(e.target.value)} placeholder={`${showAdd} Name*`} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>
              <div><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>GENDER</label><select value={formGender} onChange={e=>setFormGender(e.target.value)} disabled={showAdd==='Father'||showAdd==='Mother'} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', background: (showAdd==='Father'||showAdd==='Mother')?'#f5f5f5':'white'}}><option>Male</option><option>Female</option></select></div>
              {showAdd==='Child' && family.spouses.length>0 && (
                <div><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>SELECT SPOUSE</label><select value={selSpouseId} onChange={e=>setSelSpouseId(e.target.value)} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd'}}>{family.spouses.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select></div>
              )}
              <div style={{display:'flex', gap:'10px', marginTop:'8px'}}>
                <button onClick={()=>setShowAdd(null)} style={{flex:1, padding:'12px', borderRadius:'30px', border:'1px solid #ddd', background:'white', fontWeight:700}}>Cancel</button>
                <button onClick={handleAddFamily} style={{flex:1, padding:'12px', borderRadius:'30px', border:'none', background:'black', color:'white', fontWeight:800}}>Save {showAdd}</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}