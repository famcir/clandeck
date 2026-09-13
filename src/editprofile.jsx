import React, { useState } from 'react';

export default function EditProfile({ onBack }) {
  const [name, setName] = useState(localStorage.getItem('userName') || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    // TODO: later we will connect to /api/update-profile
    localStorage.setItem('userName', name);
    setSaving(false);
    alert("Profile saved!");
    onBack();
  };

  return (
    <div style={{padding:'40px', maxWidth:'500px', margin:'0 auto', fontFamily:'Arial'}}>
      <button onClick={onBack} style={{marginBottom:'20px', cursor:'pointer', background:'#eee', border:'none', padding:'8px 16px', borderRadius:'8px'}}>← Back to Profile</button>
      
      <h2>Edit Profile</h2>
      <p style={{color:'#999', marginBottom:'20px'}}>Update your details</p>

      <div style={{marginBottom:'15px'}}>
        <label>Full Name</label>
        <input 
          value={name} 
          onChange={(e) => setName(e.target.value)}
          style={{width:'100%', padding:'12px', borderRadius:'8px', border:'1px solid #ddd', marginTop:'6px'}}
          placeholder="Your name"
        />
      </div>

      <button 
        onClick={handleSave}
        disabled={saving}
        style={{width:'100%', padding:'14px', background:'#000', color:'#fff', border:'none', borderRadius:'10px', cursor:'pointer', fontWeight:'bold'}}
      >
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  );
}