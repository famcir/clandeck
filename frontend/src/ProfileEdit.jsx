import React, { useState, useEffect, useRef, useMemo } from 'react';
import CommonHeader from './CommonHeader.jsx';

const API_URL = import.meta.env.VITE_API_URL || "https://api.clandeck.com";

// Longest side of the saved "original" photo (keeps uploads small and fast)
const MAX_ORIGINAL_SIDE = 1600;
const EMPTY_FAMILY = { father: null, mother: null, siblings: [], spouses: [], children: [] };

// ---------- shared styles ----------
const inputStyle = { width: '100%', padding: '12px 16px', borderRadius: '20px', border: 'none', background: '#f0ede8', fontSize: '13px', boxSizing: 'border-box', outline: 'none' };
const labelStyle = { fontSize: '9px', fontWeight: 600, color: '#8a7a65', letterSpacing: '0.5px', marginBottom: '6px', display: 'block' };
const cardStyle = { background: 'white', borderRadius: '14px', padding: '16px' };
const pillBtn = (dark, disabled) => ({
  background: dark ? '#111' : 'white', color: dark ? 'white' : '#111', border: dark ? 'none' : '1px solid #e9e2d6',
  padding: '10px', borderRadius: '20px', fontWeight: 500, fontSize: '11px',
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1
});
const smallBtn = { background: 'white', border: '1px solid #e9e2d6', padding: '5px 12px', borderRadius: '14px', fontWeight: 500, fontSize: '10px', cursor: 'pointer' };

// ---------- small helpers ----------
const fetchJSON = async (path, options) => {
  const r = await fetch(`${API_URL}${path}`, options);
  let data = {};
  try { data = await r.json(); } catch { /* not JSON */ }
  return { ok: r.ok, status: r.status, data };
};

const loadTree = async (id) => {
  const { data } = await fetchJSON(`/api/profiles/family-tree?user_id=${encodeURIComponent(id)}`);
  if (!data.success) throw new Error(data.error || 'Could not load the family');
  return data;
};

// Loads a picture from a data URL or a web address (web pictures are fetched with CORS so the canvas can use them)
const loadImage = async (src) => {
  let url = src;
  if (/^https?:/i.test(src)) {
    const r = await fetch(src + (src.includes('?') ? '&' : '?') + 'cors=1', { mode: 'cors' });
    if (!r.ok) throw new Error('Could not download the photo');
    url = URL.createObjectURL(await r.blob());
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the photo'));
    img.src = url;
  });
};

// Re-draws a picture as a JPEG whose longest side is at most maxSide
const shrinkToJpeg = async (src, maxSide, quality) => {
  const img = await loadImage(src);
  const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
};

const dateOnly = (v) => (v ? String(v).split('T')[0] : '');

const initForm = (p, isSelf, storedUser) => ({
  display_name: p.display_name || '',
  nickname: p.nickname || '',
  gender: p.gender || 'Male',
  dob: dateOnly(p.dob),
  email: p.email || (isSelf ? (p.user_email || storedUser?.email) : '') || '',
  mobile_number: p.mobile_number || (isSelf ? (p.user_mobile || storedUser?.mobile) : '') || '',
  visibility: p.visibility || 'Public',
  show_in_deck: p.show_in_deck ?? 1,
  is_alive: p.is_alive ?? 1,
  dod: dateOnly(p.dod),
  bio: p.bio || '',
  location: p.location || ''
});

const isGone = (p) => p && (p.is_alive === 0 || p.is_alive === false);

// =====================================================================
// PersonEditor: photo tool + ALL personal fields. Used for you (left column)
// and for every family member (pop-up window).
// =====================================================================
function PersonEditor({ profile, isSelf, storedUser, onSaved, onCancel }) {
  const apiId = isSelf ? (storedUser?.id || profile.id) : profile.id;

  const [saving, setSaving] = useState(false);
  const [photoOriginal, setPhotoOriginal] = useState(profile.photo_original_url || profile.photo_url || '');
  const [photoUrl, setPhotoUrl] = useState(profile.photo_url || '');
  const [photoDirty, setPhotoDirty] = useState(false); // true when a new photo was chosen or moved/zoomed
  const [zoom, setZoom] = useState(parseFloat(profile.photo_zoom) || 1);
  const [pos, setPos] = useState({ x: parseFloat(profile.photo_x) || 0, y: parseFloat(profile.photo_y) || 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);
  const containerRef = useRef(null);
  const [form, setForm] = useState(() => initForm(profile, isSelf, storedUser));

  const handleChange = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  // ----- drag to move the photo -----
  const onPointerDown = (e) => {
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
    setDragging(true);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    setPos({ x: d.px + (e.clientX - d.sx), y: d.py + (e.clientY - d.sy) });
    setPhotoDirty(true);
  };
  const endDrag = () => { dragRef.current = null; setDragging(false); };
  const changeZoom = (fn) => { setZoom(fn); setPhotoDirty(true); };

  // ----- choose a file: shrink it and keep it as the "original" -----
  const handleImage = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const jpeg = await shrinkToJpeg(ev.target.result, MAX_ORIGINAL_SIDE, 0.9);
        setPhotoOriginal(jpeg);
        setPhotoUrl(jpeg);
        setZoom(1); setPos({ x: 0, y: 0 });
        setPhotoDirty(true);
      } catch {
        alert('This image could not be read. Please choose a JPG or PNG photo.');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ----- makes the 400x400 "compressed" picture exactly as it looks in the preview box -----
  const getCroppedImage = async () => {
    const img = await loadImage(photoOriginal);
    const size = 400;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const contW = containerRef.current?.clientWidth || 160;
    const k = size / contW;
    const base = Math.max(contW / img.width, contW / img.height); // same as objectFit: cover
    const drawW = img.width * base * zoom * k;
    const drawH = img.height * base * zoom * k;
    const cx = size / 2 + pos.x * k;
    const cy = size / 2 + pos.y * k;
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
    return canvas.toDataURL('image/jpeg', 0.8);
  };

  const handleSave = async () => {
    if (!form.display_name.trim()) return alert('Please enter the full name');
    setSaving(true);
    try {
      let finalOriginal = photoOriginal || '';
      let finalCompressed = photoUrl || '';
      let bucketKey = null;

      // Upload to the bucket when the photo changed, or when an old photo is still stored inside the database
      const needsUpload = photoOriginal && (photoDirty || photoOriginal.startsWith('data:'));
      if (needsUpload) {
        const compressed = await getCroppedImage();
        const body = { compressed };
        if (photoOriginal.startsWith('data:')) {
          let orig = photoOriginal;
          if (!orig.startsWith('data:image/jpeg') || orig.length > 6000000) orig = await shrinkToJpeg(orig, MAX_ORIGINAL_SIDE, 0.9);
          body.original = orig;
        }
        const pr = await fetchJSON(`/api/profile/${apiId}/photo`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        if (!pr.ok || !pr.data.success) throw new Error(pr.data.error || 'Photo upload failed');
        finalCompressed = pr.data.compressed_url;
        if (pr.data.original_url) finalOriginal = pr.data.original_url;
        bucketKey = pr.data.bucket_key || null;
      }

      const payload = {
        display_name: form.display_name.trim(), nickname: form.nickname, gender: form.gender,
        dob: form.dob || null, email: form.email, mobile: form.mobile_number,
        mobile_number: form.mobile_number, visibility: form.visibility,
        show_in_deck: Number(form.show_in_deck), is_alive: Number(form.is_alive),
        dod: Number(form.is_alive) ? null : (form.dod || null),
        bio: form.bio, location: form.location,
        photo_url: finalCompressed || null,
        photo_original_url: finalOriginal || null,
        photo_compressed_url: finalCompressed || null,
        photo_bucket_key: bucketKey,
        photo_x: pos.x, photo_y: pos.y, photo_zoom: zoom
      };

      const res = await fetchJSON(`/api/profile/${apiId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (!res.ok || !res.data.success) throw new Error(res.data.error || 'Save failed');

      // Photo is now stored in the bucket: switch the page to the short web addresses
      setPhotoOriginal(finalOriginal);
      setPhotoUrl(finalCompressed);
      setPhotoDirty(false);

      if (isSelf) {
        try { localStorage.setItem('user', JSON.stringify({ ...storedUser, name: form.display_name.trim(), photo_url: finalCompressed })); } catch { /* ignore */ }
      }
      if (onSaved) onSaved(res.data.data || { ...profile, ...payload });
      alert('Saved ✅');
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
    setSaving(false);
  };

  return (
    <div>
      {/* PHOTO */}
      <div style={{ ...cardStyle, padding: '20px', textAlign: 'center' }}>
        <div
          ref={containerRef}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
          style={{ width: '160px', height: '160px', margin: '0 auto', borderRadius: '18px', overflow: 'hidden', background: '#e9e2d6', position: 'relative', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        >
          {(photoOriginal || photoUrl) ? (
            <img src={photoOriginal || photoUrl} alt="" draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`, transformOrigin: 'center', userSelect: 'none', pointerEvents: 'none' }} />
          ) : <div style={{ lineHeight: '160px', fontSize: '50px' }}>👤</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginTop: '12px' }}>
          <button type="button" onClick={() => changeZoom((z) => Math.max(1, z - 0.1))} style={{ width: '30px', height: '30px', borderRadius: '50%', border: '1px solid #ddd', background: 'white', fontWeight: 600 }}>-</button>
          <span style={{ fontSize: '10px', color: '#888' }}>Drag to move • +/- zoom</span>
          <button type="button" onClick={() => changeZoom((z) => Math.min(3, z + 0.1))} style={{ width: '30px', height: '30px', borderRadius: '50%', border: '1px solid #ddd', background: 'white', fontWeight: 600 }}>+</button>
        </div>
        <label style={{ display: 'inline-block', marginTop: '14px', background: '#111', color: 'white', padding: '8px 18px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
          Choose File <input type="file" accept="image/*" onChange={handleImage} style={{ display: 'none' }} />
        </label>
        <div style={{ fontWeight: 600, fontSize: '16px', marginTop: '12px' }}>{form.display_name || 'Name'} {form.nickname && `(${form.nickname})`}</div>
        <div style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>
          {photoDirty ? 'Photo changed - press Save to upload' : (photoOriginal ? 'Photo saved ✓' : 'No photo yet')}
        </div>
      </div>

      {/* DETAILS */}
      <div style={{ ...cardStyle, marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <h3 style={{ margin: 0, fontWeight: 600, fontSize: '14px' }}>Personal Details</h3>
        <div><label style={labelStyle}>FULL NAME</label><input value={form.display_name} onChange={(e) => handleChange('display_name', e.target.value)} style={inputStyle} /></div>
        <div><label style={labelStyle}>NICK NAME</label><input value={form.nickname} onChange={(e) => handleChange('nickname', e.target.value)} style={inputStyle} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={labelStyle}>GENDER</label>
            <select value={form.gender} onChange={(e) => handleChange('gender', e.target.value)} style={inputStyle}><option>Male</option><option>Female</option></select></div>
          <div><label style={labelStyle}>DOB</label><input type="date" value={form.dob} onChange={(e) => handleChange('dob', e.target.value)} style={inputStyle} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={labelStyle}>LIVING</label>
            <select value={form.is_alive} onChange={(e) => handleChange('is_alive', Number(e.target.value))} style={inputStyle}><option value={1}>Alive</option><option value={0}>Passed away</option></select></div>
          {Number(form.is_alive) === 0 && (
            <div><label style={labelStyle}>DATE OF DEATH</label><input type="date" value={form.dod} onChange={(e) => handleChange('dod', e.target.value)} style={inputStyle} /></div>
          )}
        </div>
        <div><label style={labelStyle}>EMAIL</label><input value={form.email} onChange={(e) => handleChange('email', e.target.value)} style={inputStyle} /></div>
        <div><label style={labelStyle}>PHONE</label><input value={form.mobile_number} onChange={(e) => handleChange('mobile_number', e.target.value)} style={inputStyle} /></div>
        <div><label style={labelStyle}>LOCATION</label><input value={form.location} onChange={(e) => handleChange('location', e.target.value)} style={inputStyle} /></div>
        <div><label style={labelStyle}>BIO</label><textarea value={form.bio} onChange={(e) => handleChange('bio', e.target.value)} style={{ ...inputStyle, borderRadius: '14px' }} rows={3} /></div>
        <div style={{ background: '#faf7f2', borderRadius: '12px', padding: '14px', border: '1px solid #e9e2d6' }}>
          <label style={labelStyle}>PUBLIC VIEW</label>
          <div style={{ display: 'flex', gap: '20px', marginTop: '8px' }}>
            <label style={{ display: 'flex', gap: '6px', fontSize: '12px', fontWeight: 500 }}><input type="radio" checked={form.visibility === 'Public'} onChange={() => handleChange('visibility', 'Public')} /> Public</label>
            <label style={{ display: 'flex', gap: '6px', fontSize: '12px', fontWeight: 500 }}><input type="radio" checked={form.visibility === 'Private'} onChange={() => handleChange('visibility', 'Private')} /> Private</label>
          </div>
          <div style={{ marginTop: '12px' }}><label style={labelStyle}>SHOW IN DECK</label>
            <select value={form.show_in_deck} onChange={(e) => handleChange('show_in_deck', Number(e.target.value))} style={inputStyle}><option value={1}>Yes</option><option value={0}>No</option></select></div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {onCancel && <button type="button" onClick={onCancel} style={{ flex: 1, padding: '14px', borderRadius: '30px', border: '1px solid #ddd', background: 'white', fontWeight: 500, cursor: 'pointer' }}>Cancel</button>}
          <button type="button" onClick={handleSave} disabled={saving} style={{ flex: 2, background: '#111', color: 'white', padding: '14px', borderRadius: '30px', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
            {saving ? 'Saving...' : (isSelf ? 'Save Personal →' : 'Save Details →')}
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// One family member row: photo, name, Edit and "Family" buttons
// =====================================================================
function PersonCard({ p, relation, onEdit, onOpen }) {
  const img = p.photo_compressed_url || p.photo_url;
  const bits = [relation, p.gender, isGone(p) ? 'passed away' : null].filter(Boolean);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'white', border: '1px solid #e9e2d6', borderRadius: '14px', padding: '8px 10px', marginTop: '8px' }}>
      <div style={{ width: '44px', height: '44px', borderRadius: '12px', overflow: 'hidden', background: '#e9e2d6', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
        {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.display_name}{p.nickname ? ` (${p.nickname})` : ''}
        </div>
        <div style={{ fontSize: '10px', color: '#8a7a65', marginTop: '2px' }}>{bits.join(' • ')}</div>
      </div>
      <div style={{ display: 'flex', gap: '6px', flex: '0 0 auto', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '190px' }}>
        <button type="button" onClick={() => onEdit(p)} style={smallBtn}>✏️ Edit</button>
        <button type="button" onClick={() => onOpen(p, relation)} style={{ ...smallBtn, background: '#111', color: 'white', border: '1px solid #111' }}>Family →</button>
      </div>
    </div>
  );
}

function Modal({ children, onClose, maxWidth = 400 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }} onClick={onClose}>
      <div style={{ background: '#f7f4ef', borderRadius: '16px', padding: '20px', width: '100%', maxWidth, maxHeight: '92vh', overflowY: 'auto', boxSizing: 'border-box' }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// =====================================================================
// The page
// =====================================================================
export default function ProfileEdit({ onGoProfile, onLogout, onGoDeck }) {
  const storedUser = useMemo(() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } }, []);
  const userId = storedUser?.id;

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);                       // your own profile (left column)
  const [focus, setFocus] = useState(null);                 // whose family the right column shows: { id, profile, family }
  const [trail, setTrail] = useState([]);                   // breadcrumb: You > Father > ...
  const [editing, setEditing] = useState(null);             // family member being edited in the pop-up
  const [showAdd, setShowAdd] = useState(null);             // { type } while the "add" pop-up is open
  const [addName, setAddName] = useState('');
  const [addGender, setAddGender] = useState('Male');
  const [addSpouse, setAddSpouse] = useState('');
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState([]);                // people who already exist and match the typed name
  const [picked, setPicked] = useState(null);                // an existing person chosen from that list
  const [removePlan, setRemovePlan] = useState(null);        // preview of what removing a member will do
  const [tempLogin, setTempLogin] = useState(false);         // this login still uses a temporary password
  const [credsOpen, setCredsOpen] = useState(false);
  const [creds, setCreds] = useState({ current: '', uname: '', pass: '', pass2: '' });

  // ----- look for people who already exist while a name is typed in the Add pop-up -----
  useEffect(() => {
    if (!showAdd || picked || addName.trim().length < 2 || !focus) { setMatches([]); return undefined; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const { data } = await fetchJSON(`/api/profiles/search?q=${encodeURIComponent(addName.trim())}&owner_profile_id=${encodeURIComponent(focus.id)}`);
        if (alive && data.success) setMatches(data.data || []);
      } catch { if (alive) setMatches([]); }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [addName, showAdd, picked, focus]);

  // ----- is this login still a temporary one? (shows the "set your own username & password" reminder) -----
  useEffect(() => {
    if (!userId) return;
    fetchJSON(`/api/account/status/${encodeURIComponent(userId)}`).then(({ data }) => setTempLogin(!!(data && data.is_temp))).catch(() => {});
  }, [userId]);

  // ----- first load -----
  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    (async () => {
      try {
        // quietly make sure every family link is mirrored on the other people (fixes anything added earlier)
        try {
          await fetchJSON('/api/profiles/family-repair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner_profile_id: userId }) });
        } catch { /* not important */ }
        let j = null;
        try { j = await loadTree(userId); } catch { /* fall back below */ }
        if (j) {
          setMe(j.myProfile);
          setFocus({ id: j.myProfile.id, profile: j.myProfile, family: j.family });
          setTrail([{ id: j.myProfile.id, name: j.myProfile.display_name || 'You', rel: 'You' }]);
        } else {
          const { data } = await fetchJSON(`/api/profile/${encodeURIComponent(userId)}`);
          const p = data.success ? data.data : { id: userId, display_name: storedUser.name || '' };
          setMe(p);
          setFocus({ id: p.id, profile: p, family: EMPTY_FAMILY });
          setTrail([{ id: p.id, name: p.display_name || 'You', rel: 'You' }]);
        }
      } finally { setLoading(false); }
    })();
  }, [userId]);

  const refreshFocus = async (id) => {
    const target = id || focus.id;
    const j = await loadTree(target);
    setFocus({ id: target, profile: j.myProfile, family: j.family });
  };

  const openFamily = async (member, rel) => {
    try {
      const j = await loadTree(member.id);
      setFocus({ id: member.id, profile: j.myProfile, family: j.family });
      setTrail((t) => [...t, { id: member.id, name: member.display_name, rel: rel || 'Family' }]);
    } catch (e) { alert(e.message); }
  };

  const goTrail = async (idx) => {
    try {
      const t = trail[idx];
      await refreshFocus(t.id);
      setTrail(trail.slice(0, idx + 1));
    } catch (e) { alert(e.message); }
  };

  // ----- adding family -----
  const openAdd = (type, spouseId) => {
    const fam = focus.family;
    let g = 'Male';
    if (type === 'Mother') g = 'Female';
    if (type === 'Spouse') g = focus.profile.gender === 'Female' ? 'Male' : 'Female';
    setAddName(''); setAddGender(g); setPicked(null); setMatches([]);
    setAddSpouse(spouseId || (fam.spouses.length === 1 ? fam.spouses[0].id : ''));
    setShowAdd({ type });
  };

  const handleAdd = async () => {
    if (!picked && !addName.trim()) return alert('Enter name');
    if (showAdd.type === 'Child' && !addSpouse) return alert('Please select the spouse this child belongs to');
    setBusy(true);
    try {
      const res = await fetchJSON('/api/profiles/family-add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_profile_id: focus.id, display_name: picked ? picked.display_name : addName.trim(), gender: addGender,
          existing_profile_id: picked ? picked.id : null,
          relation_type: showAdd.type, spouse_id: showAdd.type === 'Child' ? addSpouse : null
        })
      });
      if (!res.ok || !res.data.success) throw new Error(res.data.error || 'Could not add');
      setShowAdd(null); setAddName(''); setPicked(null); setMatches([]);
      await refreshFocus();
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  // ----- saved from the editors -----
  const onSelfSaved = (data) => {
    setMe((m) => ({ ...m, ...data }));
    setTrail((t) => t.map((x, i) => (i === 0 ? { ...x, name: data.display_name || x.name } : x)));
    refreshFocus().catch(() => {});
  };
  const onMemberSaved = (data) => {
    setEditing(null);
    setTrail((t) => t.map((x) => (x.id === data.id ? { ...x, name: data.display_name || x.name } : x)));
    refreshFocus().catch(() => {});
  };

  // ----- the invited person sets their own username / password -----
  const saveCreds = async () => {
    if (creds.pass && creds.pass !== creds.pass2) return alert('The two new passwords do not match');
    setBusy(true);
    try {
      const res = await fetchJSON('/api/account/set-credentials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, current_password: creds.current, new_uname: creds.uname, new_password: creds.pass })
      });
      if (!res.ok || !res.data.success) throw new Error(res.data.error || 'Could not save');
      try { localStorage.setItem('user', JSON.stringify({ ...storedUser, uname: res.data.uname, username: res.data.uname, is_temp: 0 })); } catch { /* ignore */ }
      setTempLogin(false); setCredsOpen(false); setCreds({ current: '', uname: '', pass: '', pass2: '' });
      alert('Saved. Use your new username and password next time you log in.');
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  // ----- removing a family member: first ask the server what would happen, then confirm -----
  const startRemove = async (member) => {
    setBusy(true);
    try {
      const res = await fetchJSON('/api/profiles/family-remove', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_profile_id: focus.id, profile_id: member.id, home_id: me.id, confirm: false })
      });
      if (!res.ok || !res.data.success) throw new Error(res.data.error || 'Could not remove');
      setRemovePlan(res.data);
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  const confirmRemove = async () => {
    setBusy(true);
    try {
      const res = await fetchJSON('/api/profiles/family-remove', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_profile_id: focus.id, profile_id: removePlan.person.id, home_id: me.id, confirm: true })
      });
      if (!res.ok || !res.data.success) throw new Error(res.data.error || 'Could not remove');
      const goneIds = new Set((res.data.delete || []).map((x) => x.id).concat(res.data.person ? [res.data.person.id] : []));
      setRemovePlan(null); setEditing(null);
      if (goneIds.has(focus.id)) {                      // the page we are on was removed: go back to your own family
        await refreshFocus(me.id);
        setTrail((t) => t.slice(0, 1));
      } else {
        setTrail((t) => t.filter((x) => !goneIds.has(x.id)));
        await refreshFocus();
      }
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;
  if (!me || !focus) return <div style={{ padding: 40, textAlign: 'center' }}>Please log in again to edit your profile.</div>;

  const fam = focus.family;
  const viewingMe = focus.id === me.id;
  const hasParent = !!(fam.father || fam.mother);
  const hasSpouse = fam.spouses.length > 0;
  const spouseGroups = new Set(fam.spouses.map((s) => String(s.spouse_group)));
  const otherKids = fam.children.filter((c) => !spouseGroups.has(String(c.spouse_group)));

  return (
    <div className="pg-font" style={{ minHeight: '100vh', width: '100%', background: '#f7f4ef' }}>
      <style>{`.pg-font :not(header):not(header *) { font-family: Arial, Helvetica, sans-serif; }`}</style>
      <CommonHeader self={storedUser} page="profile-edit" onDeck={onGoDeck} onProfile={onGoProfile} onLogout={onLogout} />
      {tempLogin && (
        <div style={{ margin: '12px 24px 0', padding: '10px 14px', background: '#fff8e1', border: '1px solid #f1dc9a', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '13px' }}>
          <span style={{ flex: 1, minWidth: 200 }}>🔑 You are using a <b>temporary login</b>. Please set your own username and password.</span>
          <button type="button" onClick={() => setCredsOpen(true)} style={{ ...pillBtn(true), padding: '8px 16px' }}>Set now</button>
        </div>
      )}
      {/* FULL WIDTH: two columns on wide screens, one column on small screens */}
      <div style={{ width: '100%', boxSizing: 'border-box', padding: '16px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: '16px', alignItems: 'start' }}>

        {/* LEFT - YOUR PERSONAL DETAILS */}
        <div>
          <PersonEditor key={me.id} profile={me} isSelf storedUser={storedUser} onSaved={onSelfSaved} />
        </div>

        {/* RIGHT - FAMILY */}
        <div>
          <div style={cardStyle}>
            <h3 style={{ margin: 0, fontWeight: 600, fontSize: '14px' }}>Family Members & Groups</h3>

            {/* breadcrumb */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginTop: '10px', fontSize: '11px' }}>
              {trail.map((t, i) => (
                <span key={`${t.id}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  {i > 0 && <span style={{ color: '#aaa' }}>›</span>}
                  {i === trail.length - 1
                    ? <b>{t.name}</b>
                    : <button type="button" onClick={() => goTrail(i)} style={{ background: 'none', border: 'none', padding: 0, color: '#8a7a65', textDecoration: 'underline', cursor: 'pointer', fontSize: '11px' }}>{t.name}</button>}
                </span>
              ))}
            </div>
            {!viewingMe && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '10px', background: '#faf7f2', border: '1px solid #e9e2d6', borderRadius: '12px', padding: '8px 12px' }}>
                <span style={{ fontSize: '11px' }}>Adding family for <b>{focus.profile.display_name}</b></span>
                <button type="button" onClick={() => setEditing(focus.profile)} style={smallBtn}>✏️ Edit details</button>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: '14px' }}>
              {!fam.father && <button type="button" onClick={() => openAdd('Father')} style={pillBtn(true)}> + Father</button>}
              {!fam.mother && <button type="button" onClick={() => openAdd('Mother')} style={pillBtn(true)}> + Mother</button>}
              <button type="button" onClick={() => hasParent && openAdd('Sibling')} disabled={!hasParent} title={hasParent ? '' : 'Add a parent first'} style={pillBtn(false, !hasParent)}> + Sibling</button>
              <button type="button" onClick={() => openAdd('Spouse')} style={pillBtn(false)}> + Spouse ({fam.spouses.length})</button>
              <button type="button" onClick={() => hasSpouse && openAdd('Child')} disabled={!hasSpouse} title={hasSpouse ? '' : 'Add a spouse first'} style={pillBtn(false, !hasSpouse)}> + Child</button>
            </div>
            {(!hasParent || !hasSpouse) && (
              <div style={{ fontSize: '10px', color: '#8a7a65', marginTop: '10px' }}>
                {!hasParent && 'Siblings can be added after a parent. '}{!hasSpouse && 'Children can be added after a spouse.'}
              </div>
            )}
          </div>

          {/* PARENTS */}
          <div style={{ ...cardStyle, marginTop: '12px' }}>
            <b style={{ fontSize: '11px' }}>PARENTS</b>
            {fam.father && <PersonCard p={fam.father} relation="Father" onEdit={setEditing} onOpen={openFamily} />}
            {fam.mother && <PersonCard p={fam.mother} relation="Mother" onEdit={setEditing} onOpen={openFamily} />}
            {!fam.father && !fam.mother && <div style={{ fontSize: '11px', color: '#aaa', marginTop: '8px' }}>None</div>}
          </div>

          {/* SPOUSES, each with their own children */}
          <div style={{ ...cardStyle, marginTop: '12px' }}>
            <b style={{ fontSize: '11px' }}>SPOUSES ({fam.spouses.length})</b>
            {fam.spouses.length === 0 && <div style={{ fontSize: '11px', color: '#aaa', marginTop: '8px' }}>None</div>}
            {fam.spouses.map((sp, i) => {
              const kids = fam.children.filter((c) => String(c.spouse_group) === String(sp.spouse_group));
              return (
                <div key={sp.id} style={{ background: '#faf7f2', border: '1px solid #e9e2d6', borderRadius: '14px', padding: '8px 10px 12px', marginTop: '10px' }}>
                  <PersonCard p={sp} relation={fam.spouses.length > 1 ? `Spouse ${i + 1}` : 'Spouse'} onEdit={setEditing} onOpen={openFamily} />
                  <div style={{ marginLeft: '14px', paddingLeft: '12px', borderLeft: '2px solid #e9e2d6', marginTop: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <b style={{ fontSize: '10px' }}>CHILDREN WITH {String(sp.display_name || '').toUpperCase()} ({kids.length})</b>
                      <button type="button" onClick={() => openAdd('Child', sp.id)} style={smallBtn}>+ Add child</button>
                    </div>
                    {kids.length === 0 && <div style={{ fontSize: '11px', color: '#aaa', marginTop: '6px' }}>None</div>}
                    {kids.map((c) => <PersonCard key={c.id} p={c} relation="Child" onEdit={setEditing} onOpen={openFamily} />)}
                  </div>
                </div>
              );
            })}
            {otherKids.length > 0 && (
              <div style={{ marginTop: '14px' }}>
                <b style={{ fontSize: '10px' }}>OTHER CHILDREN ({otherKids.length})</b>
                {otherKids.map((c) => <PersonCard key={c.id} p={c} relation="Child" onEdit={setEditing} onOpen={openFamily} />)}
              </div>
            )}
          </div>

          {/* SIBLINGS */}
          <div style={{ ...cardStyle, marginTop: '12px' }}>
            <b style={{ fontSize: '11px' }}>SIBLINGS ({fam.siblings.length})</b>
            {fam.siblings.length === 0 && <div style={{ fontSize: '11px', color: '#aaa', marginTop: '8px' }}>None</div>}
            {fam.siblings.map((s) => <PersonCard key={s.id} p={s} relation="Sibling" onEdit={setEditing} onOpen={openFamily} />)}
          </div>
        </div>
      </div>

      {/* ADD POP-UP */}
      {showAdd && (
        <Modal onClose={() => setShowAdd(null)}>
          <h3 style={{ fontWeight: 600, margin: 0 }}>Add {showAdd.type}</h3>
          <div style={{ fontSize: '11px', color: '#8a7a65', marginTop: '4px' }}>for {focus.profile.display_name}</div>
          {picked ? (
            <div style={{ marginTop: '14px', padding: '10px 12px', borderRadius: '10px', background: '#f1f8f1', border: '1px solid #cfe5cf', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ flex: 1, fontSize: '13px' }}>
                <b>{picked.display_name}</b>{picked.nickname ? ` (${picked.nickname})` : ''}
                <div style={{ fontSize: '11px', color: '#5b7a5b' }}>Existing person will be linked as {showAdd.type}</div>
              </div>
              <button type="button" onClick={() => { setPicked(null); }} style={smallBtn}>Change</button>
            </div>
          ) : (
            <input autoFocus value={addName} onChange={(e) => setAddName(e.target.value)} placeholder={`${showAdd.type} Name*  (or search by email / phone)`}
              style={{ width: '100%', marginTop: '14px', padding: '12px', borderRadius: '10px', border: '1px solid #ddd', boxSizing: 'border-box' }} />
          )}
          {!picked && matches.length > 0 && (
            <div style={{ marginTop: '10px', border: '1px solid #e9e2d6', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ padding: '6px 10px', fontSize: '10px', fontWeight: 600, color: '#8a7a65', background: '#faf7f2' }}>ALREADY ON CLANDECK - TAP TO LINK</div>
              {matches.map((m) => (
                <button key={m.id} type="button" onClick={() => { setPicked(m); setMatches([]); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '8px 10px', border: 'none', borderTop: '1px solid #f0e9dc', background: 'white', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: '#e9d8b6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, overflow: 'hidden', flexShrink: 0 }}>
                    {m.photo ? <img src={m.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.target.style.display = 'none'; }} /> : (m.display_name || '?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>{m.display_name}{m.nickname ? ` (${m.nickname})` : ''}</div>
                    <div style={{ fontSize: '10px', color: '#8a7a65' }}>{[m.gender, m.location].filter(Boolean).join(' • ')}</div>
                  </div>
                  <span style={{ fontSize: '9px', fontWeight: 600, padding: '3px 8px', borderRadius: 10, background: m.is_claimed ? '#e8f3e8' : '#fff3df', color: m.is_claimed ? '#2f6b2f' : '#8a5a10' }}>{m.is_claimed ? 'HAS ACCOUNT' : 'ADDED BY YOU'}</span>
                </button>
              ))}
              <div style={{ padding: '7px 10px', fontSize: '10px', color: '#8a7a65', borderTop: '1px solid #f0e9dc' }}>Not in the list? Just press Add and a new person is created.</div>
            </div>
          )}

          {showAdd.type === 'Father' && <div style={{ fontSize: '11px', color: '#8a7a65', marginTop: '10px' }}>Gender: Male</div>}
          {showAdd.type === 'Mother' && <div style={{ fontSize: '11px', color: '#8a7a65', marginTop: '10px' }}>Gender: Female</div>}
          {!picked && (showAdd.type === 'Spouse' || showAdd.type === 'Child' || showAdd.type === 'Sibling') && (
            <div style={{ marginTop: '12px' }}>
              <label style={labelStyle}>GENDER</label>
              <select value={addGender} onChange={(e) => setAddGender(e.target.value)} style={inputStyle}><option>Male</option><option>Female</option></select>
            </div>
          )}
          {showAdd.type === 'Child' && (
            <div style={{ marginTop: '12px' }}>
              <label style={labelStyle}>SPOUSE (OTHER PARENT)*</label>
              <select value={addSpouse} onChange={(e) => setAddSpouse(e.target.value)} style={inputStyle}>
                <option value="">Select spouse...</option>
                {fam.spouses.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
              </select>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button type="button" onClick={() => setShowAdd(null)} style={{ flex: 1, padding: '12px', borderRadius: '20px', border: '1px solid #ddd', background: 'white', fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
            <button type="button" onClick={handleAdd} disabled={busy} style={{ flex: 2, padding: '12px', borderRadius: '20px', border: 'none', background: 'black', color: 'white', fontWeight: 600, cursor: 'pointer' }}>{busy ? 'Adding...' : picked ? 'Link' : 'Add'}</button>
          </div>
        </Modal>
      )}

      {/* EDIT POP-UP FOR ANY FAMILY MEMBER */}
      {editing && (
        <Modal onClose={() => setEditing(null)} maxWidth={520}>
          <h3 style={{ fontWeight: 600, margin: '0 0 12px' }}>Edit {editing.display_name}</h3>
          <PersonEditor key={editing.id} profile={editing} isSelf={false} storedUser={storedUser} onSaved={onMemberSaved} onCancel={() => setEditing(null)} />
          <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #f0e9dc', textAlign: 'center' }}>
            <button type="button" disabled={busy} onClick={() => startRemove(editing)}
              style={{ padding: '10px 18px', borderRadius: '20px', border: '1px solid #ffd1d1', background: '#fff5f5', color: '#d33', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}>
              {busy ? 'Checking...' : '🗑 Remove from family'}
            </button>
          </div>
        </Modal>
      )}

      {/* SET YOUR OWN LOGIN (for people who came in with a temporary one) */}
      {credsOpen && (
        <Modal onClose={() => !busy && setCredsOpen(false)} maxWidth={400}>
          <h3 style={{ fontWeight: 600, margin: 0 }}>Set your own login</h3>
          <label style={{ ...labelStyle, marginTop: '14px', display: 'block' }}>TEMPORARY PASSWORD (CURRENT)</label>
          <input type="password" value={creds.current} onChange={(e) => setCreds((c) => ({ ...c, current: e.target.value }))} style={inputStyle} autoComplete="current-password" />
          <label style={{ ...labelStyle, marginTop: '12px', display: 'block' }}>NEW USERNAME</label>
          <input value={creds.uname} onChange={(e) => setCreds((c) => ({ ...c, uname: e.target.value }))} placeholder="3-30 letters, numbers . _ -" style={inputStyle} autoComplete="username" />
          <label style={{ ...labelStyle, marginTop: '12px', display: 'block' }}>NEW PASSWORD</label>
          <input type="password" value={creds.pass} onChange={(e) => setCreds((c) => ({ ...c, pass: e.target.value }))} placeholder="at least 6 characters" style={inputStyle} autoComplete="new-password" />
          <label style={{ ...labelStyle, marginTop: '12px', display: 'block' }}>REPEAT NEW PASSWORD</label>
          <input type="password" value={creds.pass2} onChange={(e) => setCreds((c) => ({ ...c, pass2: e.target.value }))} style={inputStyle} autoComplete="new-password" />
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button type="button" onClick={() => setCredsOpen(false)} style={{ flex: 1, padding: '12px', borderRadius: '20px', border: '1px solid #ddd', background: 'white', fontWeight: 500, cursor: 'pointer' }}>Later</button>
            <button type="button" disabled={busy} onClick={saveCreds} style={{ flex: 2, padding: '12px', borderRadius: '20px', border: 'none', background: 'black', color: 'white', fontWeight: 600, cursor: 'pointer' }}>{busy ? 'Saving...' : 'Save'}</button>
          </div>
        </Modal>
      )}

      {/* CONFIRM REMOVE: shows exactly what will happen first */}
      {removePlan && (
        <Modal onClose={() => !busy && setRemovePlan(null)} maxWidth={420}>
          <h3 style={{ fontWeight: 600, margin: 0 }}>{removePlan.action === 'unlink' ? 'Remove link with' : 'Delete'} {removePlan.person.name}?</h3>
          {removePlan.action === 'unlink' ? (
            <p style={{ fontSize: '13px', color: '#555', lineHeight: 1.5 }}>{removePlan.person.name} has their own ClanDeck account, so only the link to this family is removed. Their account and their own family stay safe.</p>
          ) : (
            <p style={{ fontSize: '13px', color: '#555', lineHeight: 1.5 }}>This person and their photo will be deleted. This cannot be undone.</p>
          )}
          {removePlan.delete && removePlan.delete.length > 1 && (
            <div style={{ fontSize: '12px', background: '#fff5f5', border: '1px solid #ffd1d1', borderRadius: '10px', padding: '10px', marginBottom: '8px' }}>
              <b>Also deleted</b> (only connected through {removePlan.person.name}):<br />{removePlan.delete.filter((x) => x.id !== removePlan.person.id).map((x) => x.name).join(', ')}
            </div>
          )}
          {removePlan.detach && removePlan.detach.length > 0 && (
            <div style={{ fontSize: '12px', background: '#faf7f2', border: '1px solid #e9e2d6', borderRadius: '10px', padding: '10px', marginBottom: '8px' }}>
              <b>Kept, but no longer linked here:</b><br />{removePlan.detach.map((x) => x.name).join(', ')}
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
            <button type="button" disabled={busy} onClick={() => setRemovePlan(null)} style={{ flex: 1, padding: '12px', borderRadius: '20px', border: '1px solid #ddd', background: 'white', fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
            <button type="button" disabled={busy} onClick={confirmRemove} style={{ flex: 2, padding: '12px', borderRadius: '20px', border: 'none', background: '#d33', color: 'white', fontWeight: 600, cursor: 'pointer' }}>{busy ? 'Removing...' : removePlan.action === 'unlink' ? 'Remove link' : 'Yes, delete'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}