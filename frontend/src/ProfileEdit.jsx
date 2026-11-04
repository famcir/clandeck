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

  // ===== FAMILY STATES - SAME TWO-COLUMN FORMAT =====
  const [myProfile, setMyProfile] = useState(null);
  const [family, setFamily] = useState({ father:null, mother:null, siblings:[], spouses:[], children:[] });
  const [showAdd, setShowAdd] = useState(null);
  const [formName, setFormName] = useState('');
  const [formGender, setFormGender] = useState('Male');
  const [selFather, setSelFather] = useState(true);
  const [selMother, setSelMother] = useState(true);
  const [selSpouseId, setSelSpouseId] = useState('');
  const [birthOrder, setBirthOrder] = useState(1);

  const loadFamily = async () => {
    try {
      const res = await fetch(`${API_URL}/api/profiles/family-tree?user_id=${userId}`);
      const j = await res.json();
      if(j.success){
        setMyProfile(j.myProfile);
        setFamily(j.family);
        if(j.family.spouses.length>0) setSelSpouseId(j.family.spouses[0].id);
        setBirthOrder((j.family.children.length||0)+(j.family.siblings.length||0)+1);
        // Fill own form from same myProfile
        const p = j.myProfile;
        setForm({
          display_name: p.display_name || p.user_name || '',
          nickname: p.nickname || '',
          gender: p.gender || 'Male',
          dob: p.dob ? p.dob.split('T')[0] : '',
          email: p.email || p.user_email || user.email || '',
          mobile_number: p.mobile_number || p.user_mobile || '',
          visibility: p.visibility || 'Private',
          show_in_deck: p.show_in_deck ?? 1,
          is_alive: p.is_alive ?? 1,
          dod: p.dod ? p.dod.split('T')[0] : '',
          location: p.location || '',
          bio: p.bio || '',
          photo_url: p.photo_url || ''
        });
      } else {
        // fallback to old api
        const r = await fetch(`${API_URL}/api/profile/${userId}`);
        const d = await r.json();
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
      }
    } catch(e){ console.error(e); }
    setLoading(false);
  };

  useEffect(() => {
    if(!userId) return;
    loadFamily();
  }, [userId]);

  useEffect(()=>{
    if(showAdd==='Father') setFormGender('Male');
    if(showAdd==='Mother') setFormGender('Female');
    if(showAdd==='Spouse' && myProfile) setFormGender(myProfile.gender==='Male' ? 'Female' : 'Male');
  }, [showAdd]);

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
        alert('Profile saved successfully! ✅ Same ID updated');
        localStorage.setItem('user', JSON.stringify({...user, name: form.display_name, email: form.email, mobile: form.mobile_number}));
      } else throw new Error(data.error);
    }catch(e){ alert('Save failed: '+e.message); }
    setSaving(false);
  };

  // ===== FAMILY ADD - SEPARATE SAVE BUTTON =====
  const handleAdd = async () => {
    if(!formName.trim()) return alert('Enter name');
    if(!myProfile) return alert('My profile not loaded yet');
    if((showAdd==='Sibling') && !family.father && !family.mother) return alert('Add Father/Mother first');
    if((showAdd==='Child') && family.spouses.length===0) return alert('Add Spouse first');
    if((showAdd==='Child') && !selSpouseId) return alert('Select spouse');

    const payload = {
      user_id: userId,
      owner_profile_id: myProfile.id,
      display_name: formName,
      gender: formGender,
      relation_type: showAdd,
      father_id: showAdd==='Sibling' ? (selFather && family.father ? family.father.id : null) : null,
      mother_id: showAdd==='Sibling' ? (selMother && family.mother ? family.mother.id : null) : null,
      spouse_id: showAdd==='Child' ? selSpouseId : null,
      birth_order: birthOrder,
      show_in_deck: 1
    };

    const res = await fetch(`${API_URL}/api/profiles/family-add`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const j = await res.json();
    if(!j.success) return alert(j.error);
    setShowAdd(null); setFormName('');
    loadFamily();
  };

  const canAddSibling = family.father || family.mother;
  const canAddChild = family.spouses.length > 0;

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

      {/* ===== FAMILY SECTION - SAME TWO-COLUMN FORMAT ===== */}
      <div style={{marginTop:'30px', borderTop:'2px solid #111', paddingTop:'20px'}}>
        <h2 style={{fontWeight:800, marginBottom:10}}>Family Members</h2>
        <div style={{fontSize:'12px', color:'#666', marginBottom:'14px'}}>Father: {family.father?.display_name || 'Not added'} | Mother: {family.mother?.display_name || 'Not added'} • Spouses: {family.spouses.length} • Children: {family.children.length}</div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:'16px'}}>
          {!family.father && <button onClick={()=>setShowAdd('Father')} style={{background:'#111', color:'white', padding:'10px', borderRadius:'8px', fontWeight:700, border:'none'}}> + Add Father</button>}
          {!family.mother && <button onClick={()=>setShowAdd('Mother')} style={{background:'#111', color:'white', padding:'10px', borderRadius:'8px', fontWeight:700, border:'none'}}> + Add Mother</button>}
          <button disabled={!canAddSibling} onClick={()=>{setSelFather(!!family.father); setSelMother(!!family.mother); setShowAdd('Sibling')}} style={{background: canAddSibling?'#fff':'#eee', border:'1px solid #ddd', padding:'10px', borderRadius:'8px', fontWeight:700, opacity:canAddSibling?1:0.5}}> + Add Sibling {!canAddSibling && '(Parents first)'}</button>
          <button onClick={()=>setShowAdd('Spouse')} style={{background:'#fff', border:'1px solid #ddd', padding:'10px', borderRadius:'8px', fontWeight:700}}> + Add Spouse {family.spouses.length>0 && `(${family.spouses.length})`}</button>
          <button disabled={!canAddChild} onClick={()=>{setSelSpouseId(family.spouses[0]?.id||''); setShowAdd('Child')}} style={{background: canAddChild?'#fff':'#eee', border:'1px solid #ddd', padding:'10px', borderRadius:'8px', fontWeight:700, opacity:canAddChild?1:0.5}}> + Add Child {!canAddChild && '(Spouse first)'}</button>
        </div>

        <div style={{display:'flex', flexDirection:'column', gap:12}}>
          <div style={{border:'1px solid #ddd', borderRadius:'8px', padding:'12px'}}><b style={{fontSize:'12px'}}>Spouses ({family.spouses.length})</b><div style={{display:'flex', gap:'8px', flexWrap:'wrap', marginTop:'8px'}}>{family.spouses.map(s=><div key={s.id} style={{background:'#f5f5f5', padding:'6px 10px', borderRadius:'20px', fontSize:'11px', border:'1px solid #ddd'}}>{s.display_name} - Group {s.spouse_group} No {s.spouse_number}</div>)}{family.spouses.length===0 && <span style={{fontSize:'11px', color:'#999'}}>No spouse</span>}</div></div>
          <div style={{border:'1px solid #ddd', borderRadius:'8px', padding:'12px'}}><b style={{fontSize:'12px'}}>Siblings ({family.siblings.length})</b><div style={{display:'flex', gap:'8px', flexWrap:'wrap', marginTop:'8px'}}>{family.siblings.map(s=><div key={s.id} style={{background:'#f5f5f5', padding:'6px 10px', borderRadius:'20px', fontSize:'11px', border:'1px solid #ddd'}}>{s.display_name} - {s.father_id && s.mother_id ? 'Full' : s.father_id ? 'Paternal' : 'Maternal'}</div>)}{family.siblings.length===0 && <span style={{fontSize:'11px', color:'#999'}}>No siblings</span>}</div></div>
          <div style={{border:'1px solid #ddd', borderRadius:'8px', padding:'12px'}}><b style={{fontSize:'12px'}}>Children ({family.children.length})</b><div style={{display:'flex', gap:'8px', flexWrap:'wrap', marginTop:'8px'}}>{family.children.map(c=><div key={c.id} style={{background:'#f5f5f5', padding:'6px 10px', borderRadius:'20px', fontSize:'11px', border:'1px solid #ddd'}}>{c.display_name} - from {family.spouses.find(s=>s.id===c.spouse_parent_id)?.display_name||'Spouse'} (Order {c.birth_order})</div>)}{family.children.length===0 && <span style={{fontSize:'11px', color:'#999'}}>No children</span>}</div></div>
        </div>
      </div>

      {/* ===== MODAL - SAME FORMAT ===== */}
      {showAdd && (
        <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'16px'}} onClick={()=>setShowAdd(null)}>
          <div style={{background:'white', borderRadius:'12px', padding:'20px', width:'100%', maxWidth:'400px'}} onClick={e=>e.stopPropagation()}>
            <h3 style={{fontWeight:800, margin:0}}>Add {showAdd}</h3>
            
            <div style={{display:'flex', flexDirection:'column', gap:12, marginTop:'16px'}}>
              <label>Full Name<input value={formName} onChange={e=>setFormName(e.target.value)} placeholder={`${showAdd} Name*`} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd', boxSizing:'border-box'}}/></label>
              
              <label>Gender<select value={formGender} onChange={e=>setFormGender(e.target.value)} disabled={showAdd==='Father'||showAdd==='Mother'} style={{width:'100%', padding:'10px', borderRadius:'8px', border:'1px solid #ddd', background: (showAdd==='Father'||showAdd==='Mother')?'#f5f5f5':'white'}}><option>Male</option><option>Female</option></select></label>

              {showAdd==='Sibling' && (
                <div style={{background:'#f9f9f9', padding:'12px', borderRadius:'8px', border:'1px solid #ddd'}}>
                  <p style={{fontSize:'11px', fontWeight:800, margin:0}}>Select Parents:</p>
                  {family.father && <label style={{display:'flex', gap:'8px', fontSize:'12px', marginTop:'10px'}}><input type="checkbox" checked={selFather} onChange={e=>setSelFather(e.target.checked)}/> Father: {family.father.display_name}</label>}
                  {family.mother && <label style={{display:'flex', gap:'8px', fontSize:'12px', marginTop:'8px'}}><input type="checkbox" checked={selMother} onChange={e=>setSelMother(e.target.checked)}/> Mother: {family.mother.display_name}</label>}
                  <div style={{marginTop:'10px', fontSize:'10px', fontWeight:800, background:'white', padding:'6px 10px', borderRadius:'20px', display:'inline-block', border:'1px solid #ddd'}}>{selFather && selMother ? '→ Full Sibling' : selFather ? '→ Paternal Half' : selMother ? '→ Maternal Half' : '→ Select one'}</div>
                </div>
              )}

              {showAdd==='Child' && (
                <div style={{background:'#f9f9f9', padding:'12px', borderRadius:'8px', border:'1px solid #ddd'}}>
                  <p style={{fontSize:'11px', fontWeight:800, margin:0}}>Child is from which spouse?</p>
                  {family.spouses.map(sp=><label key={sp.id} style={{display:'flex', gap:'8px', fontSize:'12px', marginTop:'8px'}}><input type="radio" name="spouse" checked={selSpouseId===sp.id} onChange={()=>setSelSpouseId(sp.id)}/> {sp.display_name} (Spouse {sp.spouse_number})</label>)}
                  <div style={{marginTop:'12px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}><label>Birth Order<input type="number" min="1" value={birthOrder} onChange={e=>setBirthOrder(parseInt(e.target.value)||1)} style={{width:'100%', padding:'8px', borderRadius:'8px', border:'1px solid #ddd'}}/></label></div>
                </div>
              )}

              {showAdd!=='Child' && showAdd!=='Sibling' && (
                <label>Birth Order<input type="number" min="1" value={birthOrder} onChange={e=>setBirthOrder(parseInt(e.target.value)||1)} style={{width:'100%', padding:'8px', borderRadius:'8px', border:'1px solid #ddd'}}/></label>
              )}
            </div>

            <div style={{display:'grid', gridTemplateColumns:'1fr 2fr', gap:10, marginTop:'20px'}}>
              <button onClick={()=>setShowAdd(null)} style={{padding:'12px', borderRadius:'8px', border:'1px solid #ddd', background:'white', fontWeight:700}}>Cancel</button>
              <button onClick={handleAdd} style={{padding:'12px', borderRadius:'8px', border:'none', background:'#111', color:'white', fontWeight:800}}>Add {showAdd} + Auto Update</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}