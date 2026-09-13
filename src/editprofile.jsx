import React, { useState } from 'react';

export default function EditProfile({ onBack }) {
  const [name, setName] = useState(localStorage.getItem('userName') || '');
  const [photoUrl, setPhotoUrl] = useState(localStorage.getItem('userPhoto') || '');
  const [preview, setPreview] = useState(localStorage.getItem('userPhoto') || '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Show instant preview
    setPreview(URL.createObjectURL(file));
    setUploading(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      console.log("✅ Bucket URL:", data);

      if (data.success) {
        setPhotoUrl(data.url);
        setPreview(data.url);
      } else {
        alert("Upload failed: " + data.error);
      }
    } catch (err) {
      console.error(err);
      alert("Upload failed - check Railway logs");
    }
    setUploading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    localStorage.setItem('userName', name);
    localStorage.setItem('userPhoto', photoUrl);

    // Optional: save to DB too if you have user id
    const userId = localStorage.getItem('userId');
    if (userId && photoUrl) {
      try {
        await fetch(`/api/profiles/${userId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name: name,
            photo_url: photoUrl,
            relation_label: 'self'
          })
        });
      } catch (e) { console.log("DB save optional failed", e) }
    }

    setSaving(false);
    alert("Profile saved!");
    onBack();
  };

  return (
    <div style={{padding:'40px', maxWidth:'500px', margin:'0 auto', fontFamily:'Arial'}}>
      <button onClick={onBack} style={{marginBottom:'20px', cursor:'pointer', background:'#eee', border:'none', padding:'8px 16px', borderRadius:'8px'}}>← Back to Profile</button>

      <h2>Edit Profile</h2>
      <p style={{color:'#999', marginBottom:'20px'}}>Update your details</p>

      {/* PHOTO UPLOAD SECTION - NEW */}
      <div style={{marginBottom:'25px', textAlign:'center'}}>
        <div style={{width:'100px', height:'100px', borderRadius:'50%', background:'#f0f0f0', margin:'0 auto 15px', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center'}}>
          {preview? (
            <img src={preview} alt="preview" style={{width:'100%', height:'100%', objectFit:'cover'}} />
          ) : (
            <span style={{fontSize:'40px'}}>👤</span>
          )}
        </div>
        <label style={{background:'#000', color:'#fff', padding:'8px 18px', borderRadius:'20px', cursor:'pointer', fontSize:'14px'}}>
          {uploading? 'Uploading to Bucket...' : 'Change Photo'}
          <input type="file" accept="image/*" onChange={handleImageChange} style={{display:'none'}} />
        </label>
        {photoUrl && <p style={{fontSize:'11px', color:'green', marginTop:'8px', wordBreak:'break-all'}}>{photoUrl}</p>}
      </div>

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
        disabled={saving || uploading}
        style={{width:'100%', padding:'14px', background:'#000', color:'#fff', border:'none', borderRadius:'10px', cursor:'pointer', fontWeight:'bold', opacity: (saving||uploading)?0.6:1}}
      >
        {saving? 'Saving...' : uploading? 'Wait uploading...' : 'Save Changes'}
      </button>
    </div>
  );
}