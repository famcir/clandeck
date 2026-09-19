import React, { useState, useEffect } from 'react';
import logo from './assets/clandeck_h.png';

export default function Deck({ onGoProfile, onLogout }) {
  const currentUserId = localStorage.getItem('userId') || 'ur001';
  const [loggedProfile, setLoggedProfile] = useState(null); // LEFT PANEL - NEVER CHANGES
  const [treeProfiles, setTreeProfiles] = useState([]);
  const [treeSelf, setTreeSelf] = useState(null); // CENTER TREE
  const [viewUserId, setViewUserId] = useState(currentUserId);
  const [selected, setSelected] = useState(null);
  const [shareLink, setShareLink] = useState('');
  const [sharing, setSharing] = useState(false);

  // 1. Fetch logged-in user for LEFT PANEL - once
  useEffect(() => {
    fetch(`/api/profiles?owner_user_id=${currentUserId}`)
    .then(r => r.json())
    .then(data => {
        const me = data?.find(p => p.id === currentUserId) || data?.find(p => p.relation_label?.toLowerCase() === 'self') || data?.[0];
        setLoggedProfile(me);
        if (viewUserId === currentUserId) {
          setTreeProfiles(data || []);
          setTreeSelf(me);
        }
      });
  }, [currentUserId]);

  // 2. Fetch tree for viewUserId - CENTER ONLY
  useEffect(() => {
    if (viewUserId === currentUserId) return; // already loaded
    fetch(`/api/profiles?owner_user_id=${viewUserId}`)
    .then(r => r.json())
    .then(data => {
        // If selected user has no family yet, show at least selected as root
        if (!data || data.length === 0) {
          setTreeProfiles(selected? [selected] : []);
          setTreeSelf(selected || null);
        } else {
          setTreeProfiles(data);
          const me = data?.find(p => p.id === viewUserId) || data[0];
          setTreeSelf(me || selected || null);
        }
      });
  }, [viewUserId]);

  const get = (label) => treeProfiles.find(p => p.relation_label?.toLowerCase() === label.toLowerCase());
  const getAll = (label) => treeProfiles.filter(p => p.relation_label?.toLowerCase() === label.toLowerCase());

  const father = get('Father');
  const mother = get('Mother');
  const spouse = get('Spouse');
  const siblings = getAll('Sibling');
  const children = getAll('Child');

  const Node = ({ p, big }) => {
    if (!p) return null;
    return (
      <div onClick={() => setSelected(p)} className="flex flex-col items-center cursor-pointer hover:scale-105 transition-transform">
        <div className={`${big? 'w-[72px] h-[72px] bg-[#c9ad83] text-white text-[24px]' : 'w-[62px] h-[62px] bg-[#f8f5f0] text-[22px]'} rounded-[16px] border flex items-center justify-center overflow-hidden shadow-sm hover:ring-2 hover:ring-black`}>
          {p.photo_url? <img src={p.photo_url} className="w-full h-full object-cover" /> : p.display_name?.[0]}
        </div>
        <p className="text-[11px] font-bold mt-1 text-center leading-none">{p.display_name}</p>
        <p className="text-[9px] text-gray-500">{p.relation_label}</p>
      </div>
    );
  };

  const handleViewTree = () => {
    if(!selected) return;
    setViewUserId(selected.id);
    setSelected(null);
  };

  const handleShare = async () => {
    if(!selected || sharing) return;
    setSharing(true);
    try {
      const firstName = (selected.display_name || 'User').split(' ')[0].replace(/[^a-zA-Z0-9]/g,'');
      const tempUsername = `UN${firstName}`;
      const tempPassword = 'pw1234';
      const tempId = `tmp_${Date.now()}_${Math.random().toString(36).substr(2,4)}`;
      const res = await fetch('/api/share-temp-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tempId, name: selected.display_name, email: tempUsername, password: tempPassword, profile_id: selected.id, invited_by_user_id: currentUserId })
      });
      const data = await res.json();
      if(!res.ok) throw new Error(data.error);
      const link = `${window.location.origin}/login?u=${tempUsername}&p=${tempPassword}`;
      setShareLink(link);
      await navigator.clipboard.writeText(`Username: ${tempUsername}\nPassword: ${tempPassword}\nLink: ${link}`);
      alert(`Temp login created!\nUsername: ${tempUsername}\nPassword: ${tempPassword}`);
    } catch(e) { alert('Share failed: ' + e.message); }
    setSharing(false);
  };

  return (
    <div className="min-h-screen w-full bg-[#f2efe8]" style={{ fontFamily: 'Plus Jakarta Sans' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&display=swap');.card{background:#fffefb;border:1px solid #e9e2d6;border-radius:28px}`}</style>

      <header className="h-[68px] bg-[#fffefb] border-b border-[#e9e2d6] flex items-center px-6 justify-between sticky top-0 z-20 w-full">
        <img src={logo} alt="Clandeck" className="h-[60px] w-auto object-contain" />
        <div className="flex items-center gap-3">
          {viewUserId!== currentUserId && <button onClick={() => { setViewUserId(currentUserId); setTreeProfiles([]); fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json()).then(d=>{ setTreeProfiles(d||[]); const me = d?.find(p=>p.id===currentUserId)||d?.[0]; setTreeSelf(me); }); }} className="px-4 h-9 bg-[#f8f5f0] border rounded-full text-[12px] font-bold">Back to My Tree</button>}
          <button onClick={onLogout} className="px-5 h-9 bg-black text-white rounded-full text-[12px] font-bold">Logout</button>
          <img src={loggedProfile?.photo_url} onClick={onGoProfile} className="w-9 h-9 rounded-full object-cover cursor-pointer border-2 border-[#c9ad83]" alt="profile" />
        </div>
      </header>

      <div className="p-4 grid grid-cols-12 gap-4 w-full">
        {/* LEFT - FIXED TO LOGGED USER */}
        <div className="col-span-12 lg:col-span-3 space-y-4">
          <div className="card p-6 text-center">
            <img src={loggedProfile?.photo_url} className="w-[110px] h-[110px] rounded-[22px] mx-auto object-cover border" alt="" />
            <h2 className="font-extrabold text-[18px] mt-3">{loggedProfile?.display_name || 'Loading...'}</h2>
            <p className="text-[11px] text-gray-500">@{currentUserId} • {loggedProfile?.relation_label}</p>
            <button onClick={onGoProfile} className="w-full mt-4 py-2.5 bg-black text-white rounded-full font-bold text-[12px]">View Full Profile</button>
            <div className="mt-5 bg-[#f8f5f0] border border-[#e9e2d6] rounded-[18px] p-4 text-left">
              <h4 className="font-extrabold text-[12px] mb-2">My Points</h4>
              <div className="flex items-end justify-between"><div><p className="text-[24px] font-extrabold leading-none">1,240</p><p className="text-[10px] text-gray-500">Clandeck Score</p></div><span className="text-[10px] font-bold bg-[#c9ad83] text-white px-3 py-1 rounded-full">Level 4</span></div>
              <div className="mt-3 h-2 bg-[#fffefb] rounded-full overflow-hidden"><div className="h-full bg-black w-[68%] rounded-full"></div></div>
            </div>
            <div className="mt-5 text-left space-y-2 text-[12px]">
              <div className="flex justify-between"><span className="text-gray-500">Bio</span></div>
              <p className="bg-[#f8f5f0] p-3 rounded-xl text-[11px]">{loggedProfile?.bio || 'No bio added yet.'}</p>
              <div className="flex justify-between"><span>DOB</span><b>{loggedProfile?.dob? loggedProfile.dob.split('T')[0] : '—'}</b></div>
              <div className="flex justify-between"><span>Members</span><b>{treeProfiles.length}</b></div>
            </div>
          </div>
        </div>

        {/* CENTER - DYNAMIC TREE */}
        <div className="col-span-12 lg:col-span-6 card p-6 w-full">
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-extrabold text-[18px]">{viewUserId === currentUserId? 'My Family Tree' : `${treeSelf?.display_name || 'Member'}'s Tree`}</h2>
            <span className="text-[11px] bg-[#f2efe8] px-3 py-1 rounded-full font-bold">{treeProfiles.length} Members</span>
          </div>
          <div className="relative mx-auto w-full" style={{ height: '440px' }}>
            <div className="absolute" style={{ left: '130px', top: '0' }}><Node p={father} /></div>
            <div className="absolute" style={{ left: '250px', top: '0' }}><Node p={mother} /></div>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10"><Node p={treeSelf} big /></div>
            <div className="absolute flex gap-2" style={{ left: '340px', top: '40px' }}>{siblings.map(s => <Node key={s.id} p={s} />)}</div>
            <div className="absolute" style={{ left: '60px', top: '180px' }}><Node p={spouse} /></div>
            <div className="absolute flex gap-3" style={{ left: '110px', top: '310px' }}>{children.map(c => <Node key={c.id} p={c} />)}</div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-3 space-y-4">
          <div className="card p-5"><h3 className="font-extrabold text-[13px] mb-3">My Groups</h3><div className="space-y-3"><div className="flex items-center justify-between bg-[#f8f5f0] p-3 rounded-xl"><div className="flex items-center gap-2"><div className="w-8 h-8 bg-black text-white rounded-lg flex items-center justify-center">👨‍👩‍👧</div><div><p className="text-[12px] font-bold">Menon Family</p><p className="text-[10px] text-gray-500">8 members</p></div></div><span className="text-[10px] bg-white border px-2 py-1 rounded-full">Active</span></div></div></div>
          <div className="card p-5"><h3 className="font-extrabold text-[13px] mb-3">Notification Wall</h3><div className="space-y-3 text-[11px]"><p>✅ <b>{loggedProfile?.display_name || 'You'}</b> added a photo<br/><span className="text-[10px] text-gray-500">2h ago</span></p><p>👤 <b>{father?.display_name || 'Father'}</b> updated<br/><span className="text-[10px] text-gray-500">5h ago</span></p></div></div>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-[24px] w-full max-w-[340px] p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4"><h3 className="font-extrabold text-[16px]">{selected.display_name}</h3><button onClick={() => setSelected(null)} className="w-8 h-8 bg-gray-100 rounded-full">✕</button></div>
            <img src={selected.photo_url} className="w-24 h-24 rounded-[18px] object-cover mx-auto" alt="" />
            <div className="mt-4 space-y-2 text-[12px]">
              <div className="flex justify-between"><span className="text-gray-500">Relation</span><b>{selected.relation_label}</b></div>
              <div className="flex justify-between"><span className="text-gray-500">Location</span><b>{selected.location || '—'}</b></div>
              <div className="bg-[#f8f5f0] p-3 rounded-xl mt-2"><p className="text-[10px] font-bold text-gray-500">BIO</p><p className="text-[12px] mt-1">{selected.bio || 'No bio'}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-5">
              <button onClick={handleShare} disabled={sharing} className="h-11 bg-[#f8f5f0] border border-black rounded-full font-bold text-[12px] hover:bg-black hover:text-white transition">{sharing? 'Sharing...' : 'Share'}</button>
              <button onClick={handleViewTree} className="h-11 bg-black text-white rounded-full font-bold text-[12px]">View Tree</button>
            </div>
            {shareLink && <p className="text-[10px] text-green-600 mt-3 break-all">{shareLink}</p>}
          </div>
        </div>
      )}
    </div>
  );
}