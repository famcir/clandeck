import React, { useState, useEffect } from 'react';
import CommonHeader from './CommonHeader.jsx';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export default function ProfileEdit({ onGoProfile, onLogout, onGoDeck }) {
  const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
  const myUserId = storedUser?.id;
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

  // ===== OWN PROFILE EDIT STATES - ADDED, SAME FORMAT =====
  const [ownForm, setOwnForm] = useState({
    display_name: '', nickname: '', gender: 'Male', dob: '', email: '',
    mobile_number: '', visibility: 'Public', show_in_deck: 1, is_alive: 1, dod: '', photo_url: ''
  });
  const [preview, setPreview] = useState('');
  const [savingOwn, setSavingOwn] = useState(false);
  const [showOwnEdit, setShowOwnEdit] = useState(false);

  const loadFamily = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/profiles/family-tree?user_id=${myUserId}`);
      const j = await res.json();
      if(j.success){
        setMyProfile(j.myProfile);
        setFamily(j.family);
        if(j.family.spouses.length>0) setSelSpouseId(j.family.spouses[0].id);
        setBirthOrder((j.family.children.length||0) + (j.family.siblings.length||0) + 1);
        // Fill own form from same myProfile
        const d = j.myProfile;
        setOwnForm({
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
          photo_url: d.photo_url || storedUser.photo_url || ''
        });
        setPreview(d.photo_url || '');
      } else {
        if(j.error?.includes('Profile not found')){
          const createRes = await fetch(`${API_URL}/api/profiles/auto-create`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ user_id: myUserId, display_name: storedUser.name, gender: 'Male' })
          });
          const cj = await createRes.json();
          if(cj.success) loadFamily();
        }
      }
    } catch(e){ console.error(e); } 
    setLoading(false);
  };
  useEffect(()=>{ loadFamily(); }, []);

  useEffect(()=>{
    if(showAdd==='Father') setFormGender('Male');
    if(showAdd==='Mother') setFormGender('Female');
    if(showAdd==='Spouse' && myProfile){
      setFormGender(myProfile.gender==='Male' ? 'Female' : 'Male');
    }
  }, [showAdd]);

  // ===== OWN PROFILE: IMAGE UPLOAD FIX =====
  const handleOwnImageChange = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result;
      setPreview(base64);
      setOwnForm(p => ({ ...p, photo_url: base64 }));
      try {
        const res = await fetch(`${API_URL}/api/upload`, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ image: base64 })
        });
        const j = await res.json();
        if(j.success && j.url){ setOwnForm(p=>({...p, photo_url:j.url})); setPreview(j.url); }
      } catch{}
    };
    reader.readAsDataURL(file);
  };

  const handleOwnChange = (e) => {
    const { name, value } = e.target;
    setOwnForm(p => ({ ...p, [name]: value }));
  };

  // ===== SAVE OWN PROFILE - SEPARATE BUTTON =====
  const handleSaveOwn = async () => {
    setSavingOwn(true);
    try{
      const res = await fetch(`${API_URL}/api/profile/${myUserId}`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          display_name: ownForm.display_name, nickname: ownForm.nickname,
          gender: ownForm.gender, dob: ownForm.dob || null,
          email: ownForm.email, mobile_number: ownForm.mobile_number, mobile: ownForm.mobile_number,
          visibility: ownForm.visibility, show_in_deck: parseInt(ownForm.show_in_deck),
          is_alive: parseInt(ownForm.is_alive), dod: ownForm.dod || null,
          photo_url: ownForm.photo_url
        })
      });
      const j = await res.json();
      if(!j.success) throw new Error(j.error);
      localStorage.setItem('user', JSON.stringify({ ...storedUser, name: ownForm.display_name, email: ownForm.email, mobile: ownForm.mobile_number, photo_url: ownForm.photo_url }));
      alert('Own profile saved to both tables ✅');
      setShowOwnEdit(false);
      loadFamily();
    }catch(e){ alert('Save failed: '+e.message); }
    setSavingOwn(false);
  };

  const handleAdd = async () => {
    if(!formName.trim()) return alert('Enter name');
    if(!myProfile) return alert('My profile not loaded yet');
    if((showAdd==='Sibling') && !family.father && !family.mother) return alert('Add Father/Mother first');
    if((showAdd==='Child') && family.spouses.length===0) return alert('Add Spouse first');
    if((showAdd==='Child') && !selSpouseId) return alert('Select spouse');

    const payload = {
      user_id: myUserId,
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

  if(loading) return <div style={{padding:'40px', textAlign:'center'}}>Loading family...</div>;

  return (
    <div style={{minHeight:'100vh', background:'#f7f4ef'}}>
      <CommonHeader self={storedUser} page="profile-edit" onDeck={onGoDeck} onProfile={onGoProfile} onLogout={onLogout} />
      <div style={{padding:'16px', maxWidth:'900px', margin:'0 auto'}}>
        
        {/* ===== OWN PROFILE CARD - SAME FORMAT, TOP ===== */}
        <div style={{background:'white', borderRadius:'14px', padding:'16px', display:'flex', gap:'12px', alignItems:'center'}}>
          <div style={{width:'64px', height:'64px', borderRadius:'12px', background:'#c9ad83', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:'24px', color:'white', overflow:'hidden'}}>
            {preview ? <img src={preview} style={{width:'100%', height:'100%', objectFit:'cover'}}/> : myProfile?.display_name?.[0] || 'U'}
          </div>
          <div style={{flex:1}}>
            <b>{ownForm.display_name || storedUser.name}</b>
            <div style={{fontSize:'11px', color:'#888'}}>{ownForm.email} | {ownForm.mobile_number} | {family.father?'Father: '+family.father.display_name:'No Father'} | {family.mother?'Mother: '+family.mother.display_name:'No Mother'} • Spouses: {family.spouses.length} • Children: {family.children.length}</div>
          </div>
          <button onClick={()=>setShowOwnEdit(!showOwnEdit)} style={{background:'black', color:'white', borderRadius:'20px', padding:'10px 18px', fontSize:'11px', fontWeight:800, border:'none'}}> {showOwnEdit ? 'Close' : 'Edit Own Profile'}</button>
        </div>

        {/* ===== OWN EDIT FORM - EXPANDABLE, SAME INPUT STYLE ===== */}
        {showOwnEdit && (
          <div style={{background:'white', borderRadius:'14px', padding:'16px', marginTop:'12px', display:'grid', gap:'12px'}}>
            <div style={{textAlign:'center'}}>
              <div style={{width:'100px', height:'100px', margin:'0 auto', borderRadius:'12px', background:'#eee', overflow:'hidden'}}>
                {preview ? <img src={preview} style={{width:'100%', height:'100%', objectFit:'cover'}}/> : <div style={{lineHeight:'100px'}}>👤</div>}
              </div>
              <label style={{display:'inline-block', marginTop:'10px', background:'black', color:'white', padding:'8px 16px', borderRadius:'20px', fontSize:'11px', cursor:'pointer'}}>
                Choose File <input type="file" accept="image/*" onChange={handleOwnImageChange} style={{display:'none'}}/>
              </label>
            </div>

            <div><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>FULL NAME</label><input name="display_name" value={ownForm.display_name} onChange={handleOwnChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>
            <div><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>NICK NAME</label><input name="nickname" value={ownForm.nickname} onChange={handleOwnChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>
            <div style={{display:'flex', gap:'10px'}}>
              <div style={{flex:1}}><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>GENDER</label><select name="gender" value={ownForm.gender} onChange={handleOwnChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd'}}><option>Male</option><option>Female</option></select></div>
              <div style={{flex:1}}><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>DOB</label><input type="date" name="dob" value={ownForm.dob} onChange={handleOwnChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>
            </div>
            <div><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>EMAIL</label><input name="email" value={ownForm.email} onChange={handleOwnChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>
            <div><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>PHONE</label><input name="mobile_number" value={ownForm.mobile_number} onChange={handleOwnChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>
            <div style={{display:'flex', gap:'10px'}}>
              <div style={{flex:1}}><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>PUBLIC VIEW</label><select name="visibility" value={ownForm.visibility} onChange={handleOwnChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd'}}><option>Public</option><option>Private</option></select></div>
              <div style={{flex:1}}><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>SHOW IN DECK</label><select name="show_in_deck" value={ownForm.show_in_deck} onChange={handleOwnChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd'}}><option value={1}>Yes</option><option value={0}>No</option></select></div>
            </div>
            <div style={{display:'flex', gap:'10px'}}>
              <div style={{flex:1}}><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>IS ALIVE</label><select name="is_alive" value={ownForm.is_alive} onChange={handleOwnChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd'}}><option value={1}>Yes</option><option value={0}>No</option></select></div>
              {parseInt(ownForm.is_alive)===0 && <div style={{flex:1}}><label style={{fontSize:'10px', fontWeight:800, color:'#888'}}>DOD</label><input type="date" name="dod" value={ownForm.dod} onChange={handleOwnChange} style={{width:'100%', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}}/></div>}
            </div>
            <button onClick={handleSaveOwn} disabled={savingOwn} style={{background:'black', color:'white', padding:'14px', borderRadius:'30px', border:'none', fontWeight:800}}>{savingOwn ? 'Saving...' : 'Save Own Profile (Same ID)'}</button>
          </div>
        )}

        <div style={{display:'flex', gap:'8px', flexWrap:'wrap', marginTop:'16px'}}>
          {!family.father && <button onClick={()=>setShowAdd('Father')} style={{background:'black', color:'white', borderRadius:'20px', padding:'10px 18px', fontSize:'12px', fontWeight:800, border:'none'}}> + Add Father</button>}
          {!family.mother && <button onClick={()=>setShowAdd('Mother')} style={{background:'black', color:'white', borderRadius:'20px', padding:'10px 18px', fontSize:'12px', fontWeight:800, border:'none'}}> + Add Mother</button>}
          <button disabled={!canAddSibling} onClick={()=>{setSelFather(!!family.father); setSelMother(!!family.mother); setShowAdd('Sibling')}} style={{background: canAddSibling?'#fff':'#eee', border:'1px solid #e9e2d6', borderRadius:'20px', padding:'10px 18px', fontSize:'12px', fontWeight:800, opacity: canAddSibling?1:0.5, cursor: canAddSibling?'pointer':'not-allowed'}}> + Add Sibling {!canAddSibling && '(Add parents first)'}</button>
          <button onClick={()=>setShowAdd('Spouse')} style={{background:'#fff', border:'1px solid #e9e2d6', borderRadius:'20px', padding:'10px 18px', fontSize:'12px', fontWeight:800}}> + Add Spouse {family.spouses.length>0 && `(${family.spouses.length})`}</button>
          <button disabled={!canAddChild} onClick={()=>{setSelSpouseId(family.spouses[0]?.id||''); setShowAdd('Child')}} style={{background: canAddChild?'#fff':'#eee', border:'1px solid #e9e2d6', borderRadius:'20px', padding:'10px 18px', fontSize:'12px', fontWeight:800, opacity: canAddChild?1:0.5, cursor: canAddChild?'pointer':'not-allowed'}}> + Add Child {!canAddChild && '(Add spouse first)'}</button>
        </div>

        <div style={{marginTop:'16px', display:'grid', gap:'12px'}}>
          <div style={{background:'white', borderRadius:'12px', padding:'14px'}}><b style={{fontSize:'12px'}}>Spouses ({family.spouses.length}) - Multiple supported</b><div style={{display:'flex', gap:'8px', marginTop:'8px', flexWrap:'wrap'}}>{family.spouses.map(s=><div key={s.id} style={{background:'#faf7f2', padding:'8px 12px', borderRadius:'20px', fontSize:'11px', border:'1px solid #e9e2d6'}}>{s.display_name} - Group {s.spouse_group} No {s.spouse_number}</div>)}{family.spouses.length===0 && <span style={{fontSize:'11px', color:'#aaa'}}>No spouse added</span>}</div></div>
          <div style={{background:'white', borderRadius:'12px', padding:'14px'}}><b style={{fontSize:'12px'}}>Siblings ({family.siblings.length}) - Step detection</b><div style={{display:'flex', gap:'8px', marginTop:'8px', flexWrap:'wrap'}}>{family.siblings.map(s=><div key={s.id} style={{background:'#faf7f2', padding:'8px 12px', borderRadius:'20px', fontSize:'11px', border:'1px solid #e9e2d6'}}>{s.display_name} - {s.father_id && s.mother_id ? 'Full' : s.father_id ? 'Paternal (Father side)' : 'Maternal (Mother side)'}</div>)}{family.siblings.length===0 && <span style={{fontSize:'11px', color:'#aaa'}}>No siblings</span>}</div></div>
          <div style={{background:'white', borderRadius:'12px', padding:'14px'}}><b style={{fontSize:'12px'}}>Children ({family.children.length}) - From different spouses</b><div style={{display:'flex', gap:'8px', marginTop:'8px', flexWrap:'wrap'}}>{family.children.map(c=><div key={c.id} style={{background:'#faf7f2', padding:'8px 12px', borderRadius:'20px', fontSize:'11px', border:'1px solid #e9e2d6'}}>{c.display_name} - from {family.spouses.find(s=>s.id===c.spouse_parent_id)?.display_name||'Spouse'} (Order {c.birth_order})</div>)}{family.children.length===0 && <span style={{fontSize:'11px', color:'#aaa'}}>No children</span>}</div></div>
        </div>

        {showAdd && (
          <div style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'16px'}} onClick={()=>setShowAdd(null)}>
            <div style={{background:'white', borderRadius:'16px', padding:'22px', width:'100%', maxWidth:'400px'}} onClick={e=>e.stopPropagation()}>
              <h3 style={{fontWeight:800, margin:0}}>Add {showAdd}</h3>
              <p style={{fontSize:'11px', color:'#888', marginTop:'4px'}}>{showAdd==='Father'?'Father will be auto-linked as your father': showAdd==='Mother'?'Mother will be auto-linked': showAdd==='Sibling'?'Select parents to identify step sibling': showAdd==='Spouse'?'Supports multiple spouses with group': 'Select which spouse is parent'}</p>
              
              <input value={formName} onChange={e=>setFormName(e.target.value)} placeholder={`${showAdd} Name*`} style={{width:'100%', marginTop:'14px', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', boxSizing:'border-box'}} />
              
              <select value={formGender} onChange={e=>setFormGender(e.target.value)} disabled={showAdd==='Father' || showAdd==='Mother'} style={{width:'100%', marginTop:'10px', padding:'12px', borderRadius:'10px', border:'1px solid #ddd', background: (showAdd==='Father'||showAdd==='Mother')?'#f5f5f5':'white'}}>
                <option>Male</option><option>Female</option>
              </select>

              {showAdd==='Sibling' && (
                <div style={{marginTop:'14px', background:'#faf7f2', padding:'12px', borderRadius:'10px', border:'1px solid #e9e2d6'}}>
                  <p style={{fontSize:'11px', fontWeight:800, margin:0}}>Select Parents (step logic):</p>
                  {family.father && <label style={{display:'flex', gap:'8px', fontSize:'12px', marginTop:'10px', cursor:'pointer'}}><input type="checkbox" checked={selFather} onChange={e=>setSelFather(e.target.checked)}/> Father: {family.father.display_name}</label>}
                  {family.mother && <label style={{display:'flex', gap:'8px', fontSize:'12px', marginTop:'8px', cursor:'pointer'}}><input type="checkbox" checked={selMother} onChange={e=>setSelMother(e.target.checked)}/> Mother: {family.mother.display_name}</label>}
                  {!family.father && !family.mother && <p style={{fontSize:'11px', color:'red'}}>Add parents first</p>}
                  <div style={{marginTop:'10px', fontSize:'10px', fontWeight:800, color:'#8a6a3a', background:'white', padding:'6px 10px', borderRadius:'20px', display:'inline-block'}}>{selFather && selMother ? '→ Full Sibling' : selFather ? '→ Paternal Half Sibling (Step)' : selMother ? '→ Maternal Half Sibling (Step)' : '→ Select at least one'}</div>
                </div>
              )}

              {showAdd==='Child' && (
                <div style={{marginTop:'14px', background:'#faf7f2', padding:'12px', borderRadius:'10px', border:'1px solid #e9e2d6'}}>
                  <p style={{fontSize:'11px', fontWeight:800, margin:0}}>Child is from which spouse? (Required)</p>
                  {family.spouses.map(sp=>(
                    <label key={sp.id} style={{display:'flex', gap:'8px', fontSize:'12px', marginTop:'10px', cursor:'pointer', background: selSpouseId===sp.id ? 'white' : 'transparent', padding:'6px', borderRadius:'8px', border: selSpouseId===sp.id ? '1px solid #c9ad83' : '1px solid transparent'}}><input type="radio" name="spouse" checked={selSpouseId===sp.id} onChange={()=>setSelSpouseId(sp.id)}/> {sp.display_name} (Spouse {sp.spouse_number} - Group {sp.spouse_group})</label>
                  ))}
                  <div style={{marginTop:'12px', display:'flex', alignItems:'center', gap:'8px'}}><label style={{fontSize:'11px', fontWeight:700}}>Birth Order:</label><input type="number" min="1" value={birthOrder} onChange={e=>setBirthOrder(parseInt(e.target.value)||1)} style={{width:'70px', padding:'8px', borderRadius:'8px', border:'1px solid #ddd'}} /></div>
                </div>
              )}

              {showAdd!=='Child' && showAdd!=='Sibling' && (
                <div style={{marginTop:'12px'}}><label style={{fontSize:'11px', fontWeight:700}}>Birth Order:</label><input type="number" min="1" value={birthOrder} onChange={e=>setBirthOrder(parseInt(e.target.value)||1)} style={{width:'70px', marginLeft:'8px', padding:'8px', borderRadius:'8px', border:'1px solid #ddd'}} /></div>
              )}

              <div style={{display:'flex', gap:'10px', marginTop:'20px'}}>
                <button onClick={()=>setShowAdd(null)} style={{flex:1, padding:'12px', borderRadius:'20px', border:'1px solid #ddd', background:'white', fontWeight:700}}>Cancel</button>
                <button onClick={handleAdd} style={{flex:2, padding:'12px', borderRadius:'20px', border:'none', background:'black', color:'white', fontWeight:800}}>Add {showAdd} + Auto Update</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}