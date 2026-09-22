import React, { useState, useEffect } from 'react';
import logo from './assets/clandeck_h.png';

export default function Deck({ onGoProfile, onLogout }) {
  const currentUserId = localStorage.getItem('userId') || 'ur001';
  const [loggedProfile, setLoggedProfile] = useState(null);
  const [treeProfiles, setTreeProfiles] = useState([]);
  const [treeSelf, setTreeSelf] = useState(null);
  const [viewUserId, setViewUserId] = useState(currentUserId);
  const [selected, setSelected] = useState(null);
  const [shareLink, setShareLink] = useState('');
  const [sharing, setSharing] = useState(false);
  const [viewProfile, setViewProfile] = useState(null);
  const [displayProfile, setDisplayProfile] = useState(null);
  const [isViewingOther, setIsViewingOther] = useState(false);

  // helper to load family-tree using new backend (father_id/mother_id)
  const loadTree = async (profileId, shouldUpdateDisplay = false) => {
    try {
      const res = await fetch(`/api/family-tree/${profileId}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setTreeProfiles(data);
        const self = data.find(p => p.computed_relation === 'Self' || p.id === profileId) || data[0];
        setTreeSelf(self);
        if (shouldUpdateDisplay) {
          setDisplayProfile(self);
        }
        return;
      }
    } catch(e) { console.log('family-tree fallback', e.message); }
    const [all] = await Promise.all([
      fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json()).catch(()=>[])
    ]);
    setTreeProfiles(all || []);
    const self = all?.find(p=>p.id===profileId) || all?.[0] || null;
    setTreeSelf(self);
    if (shouldUpdateDisplay) setDisplayProfile(self);
  };

  useEffect(() => {
    fetch(`/api/profiles?owner_user_id=${currentUserId}`)
.then(r => r.json())
.then(data => {
        const me = data?.find(p => p.id === currentUserId) || data?.find(p => p.father_id === null && p.mother_id === null) || data?.[0];
        setLoggedProfile(me);
        setDisplayProfile(me);
        if (viewUserId === currentUserId) {
          if (me?.id) loadTree(me.id, false);
          else {
            setTreeProfiles(data || []);
            setTreeSelf(me);
          }
        }
      });
  }, [currentUserId]);

  useEffect(() => {
    if (viewUserId === currentUserId) return;
    if (viewUserId) loadTree(viewUserId, false);
  }, [viewUserId]);

  const father = treeProfiles.find(p => p.computed_relation === 'Father' || (treeSelf && p.id === treeSelf.father_id));
  const mother = treeProfiles.find(p => p.computed_relation === 'Mother' || (treeSelf && p.id === treeSelf.mother_id));
  const spouse = treeProfiles.find(p => p.computed_relation === 'Spouse');
  const siblings = treeProfiles.filter(p => p.computed_relation === 'Sibling');
  const children = treeProfiles.filter(p => p.computed_relation === 'Child');

  const Node = ({ p, big }) => {
    if (!p) return null;
    const label = p.computed_relation || p.relation_label || '';
    const hasPhoto = p.photo_url && p.photo_url.trim()!== '';
    const initial = (p.display_name || '?').trim().charAt(0).toUpperCase();
    return (
      <div onClick={() => setSelected(p)} className="flex flex-col items-center cursor-pointer hover:scale-105 transition-transform shrink-0">
        <div className={`${big? 'tree-node-big' : 'tree-node'} ${big? 'bg-[#c9ad83] text-white' : 'bg-[#f8f5f0] text-[#5a4a32]'} rounded-[14px] border flex items-center justify-center overflow-hidden shadow-sm hover:ring-2 hover:ring-black shrink-0`}>
          {hasPhoto? <img src={p.photo_url} className="w-full h-full object-cover" alt={p.display_name} /> : <span className="font-extrabold text-[clamp(14px,3cqw,22px)]">{initial}</span>}
        </div>
        <p className="tree-label font-bold mt-1 text-center leading-none max-w-[64px] truncate">{p.display_name}</p>
        <p className="text-[8px] text-gray-500 leading-none">{label}</p>
      </div>
    );
  };

  const handleViewProfile = () => {
    if(!selected) return;
    setDisplayProfile(selected);
    setViewProfile(selected);
    setViewUserId(selected.id);
    setIsViewingOther(selected.id!== currentUserId && selected.id!== loggedProfile?.id);
    loadTree(selected.id, true);
    setSelected(null);
  };

  const handleViewTree = () => {
    if(!selected) return;
    setViewProfile(selected);
    setViewUserId(selected.id);
    loadTree(selected.id, false);
    setSelected(null);
  };

  const handleBackToMyTree = () => {
    setViewProfile(null);
    setViewUserId(currentUserId);
    setDisplayProfile(loggedProfile);
    setIsViewingOther(false);
    if (loggedProfile?.id) loadTree(loggedProfile.id, false);
  };

  const handleShare = async () => {
    if(!selected || sharing) return; setSharing(true);
    try {
      const firstName = (selected.display_name || 'User').split(' ')[0].replace(/[^a-zA-Z0-9]/g,''); const tempUsername = `UN${firstName}`; const tempPassword = 'pw1234'; const tempId = `tmp_${Date.now()}_${Math.random().toString(36).substr(2,4)}`;
      const res = await fetch('/api/share-temp-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: tempId, name: selected.display_name, email: tempUsername, password: tempPassword, profile_id: selected.id, invited_by_user_id: currentUserId }) });
      const data = await res.json(); if(!res.ok) throw new Error(data.error); const link = `${window.location.origin}/login?u=${tempUsername}&p=${tempPassword}`; setShareLink(link); await navigator.clipboard.writeText(`Username: ${tempUsername}\nPassword: ${tempPassword}\nLink: ${link}`); alert(`Temp login created!\nUsername: ${tempUsername}\nPassword: ${tempPassword}`);
    } catch(e) { alert('Share failed: ' + e.message); } setSharing(false);
  };

  const isClaimedSelected = selected && (selected.id === selected.owner_user_id || selected.is_claimed === 1 || selected.is_claimed === true);

  return (
    <div className="min-h-screen w-full bg-[#f2efe8]" style={{ fontFamily: 'Plus Jakarta Sans' }}>
      <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&display=swap');
.card{background:#fffefb;border:1px solid #e9e2d6;border-radius:28px}
.tree-node{ width: clamp(44px, 8.5cqw, 62px); height: clamp(44px, 8.5cqw, 62px); }
.tree-node-big{ width: clamp(58px, 11cqw, 76px); height: clamp(58px, 11cqw, 76px); font-size: clamp(20px, 4cqw, 26px); }
.tree-label{ font-size: clamp(8px, 2cqw, 11px); }
      `}</style>
      <header className="h-[68px] bg-[#fffefb] border-b border-[#e9e2d6] flex items-center px-6 justify-between sticky top-0 z-20 w-full">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Clandeck" className="h-[60px] w-auto object-contain" />
          {isViewingOther && (
            <button onClick={handleBackToMyTree} className="ml-2 px-4 h-8 bg-black text-white rounded-full text-[11px] font-bold">Deck</button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onLogout} className="px-5 h-9 bg-black text-white rounded-full text-[12px] font-bold">Logout</button>
          {loggedProfile?.photo_url? <img src={loggedProfile?.photo_url} onClick={onGoProfile} className="w-9 h-9 rounded-full object-cover cursor-pointer border-2 border-[#c9ad83]" alt="profile" /> : <div onClick={onGoProfile} className="w-9 h-9 rounded-full bg-[#c9ad83] text-white flex items-center justify-center text-[12px] font-bold cursor-pointer border-2 border-[#c9ad83]">{(loggedProfile?.display_name?.[0] || '?').toUpperCase()}</div>}
        </div>
      </header>
      <div className="p-4 grid grid-cols-12 gap-4 w-full">
        <div className="col-span-12 lg:col-span-3 space-y-4">
          <div className="card p-6 text-center">
            {(displayProfile?.photo_url || loggedProfile?.photo_url)? <img src={displayProfile?.photo_url || loggedProfile?.photo_url} className="w-[110px] h-[110px] rounded-[22px] mx-auto object-cover border" alt="" /> : <div className="w-[110px] h-[110px] rounded-[22px] mx-auto bg-[#c9ad83] text-white flex items-center justify-center text-[36px] font-extrabold border">{((displayProfile?.display_name || loggedProfile?.display_name || '?')[0] || '?').toUpperCase()}</div>}
            <h2 className="font-extrabold text-[18px] mt-3">{displayProfile?.display_name || loggedProfile?.display_name || 'Loading...'}</h2>
            <p className="text-[11px] text-gray-500">@{displayProfile?.id || currentUserId} • {displayProfile?.gender || loggedProfile?.gender || 'Self'}</p>
            <button onClick={() => isViewingOther? null : onGoProfile()} className="w-full mt-4 py-2.5 bg-black text-white rounded-full font-bold text-[12px]">
              {isViewingOther? `${displayProfile?.display_name}'s Profile` : 'View Full Profile'}
            </button>
            {isViewingOther && <p className="text-[10px] text-gray-400 mt-2">Viewing {displayProfile?.display_name}'s profile</p>}
          </div>
        </div>
        <div className="col-span-12 lg:col-span-6 card p-6 w-full">
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-extrabold text-[18px]">{viewUserId === currentUserId? 'My Family Tree' : `${treeSelf?.display_name || viewProfile?.display_name || 'Member'}'s Tree`}</h2>
            <div className="flex items-center gap-2">
              {viewUserId!== currentUserId && <button onClick={handleBackToMyTree} className="px-3 h-7 bg-black text-white rounded-full text-[10px] font-bold">← Back to My Tree</button>}
              <span className="text-[11px] bg-[#f2efe8] px-3 py-1 rounded-full font-bold">{treeProfiles.length} Members</span>
            </div>
          </div>
          {treeProfiles.length <= 1 && treeSelf? (
            <div className="h-[440px] flex flex-col items-center justify-center">
              <div className="w-[90px] h-[90px] bg-[#c9ad83] text-white text-[28px] rounded-[22px] flex items-center justify-center overflow-hidden border shadow-sm">
                {treeSelf.photo_url? <img src={treeSelf.photo_url} className="w-full h-full object-cover" alt="" /> : <span className="font-extrabold">{(treeSelf.display_name?.[0] || '?').toUpperCase()}</span>}
              </div>
              <p className="font-extrabold mt-3 text-[16px]">{treeSelf.display_name}</p>
              <p className="text-[11px] text-gray-500">{treeSelf.computed_relation || 'Self'}</p>
            </div>
          ) : (
            <div className="w-full flex justify-center">
              <div className="relative w-full overflow-hidden" style={{ maxWidth: '520px', height: 'clamp(360px, 40vw, 440px)', containerType: 'inline-size' }}>
                <div className="absolute left-1/2 -translate-x-1/2 top-[2%] flex gap-[2px] z-10">
                  {father && <Node p={father} />}
                  {mother && <Node p={mother} />}
                </div>
                <div className="absolute left-1/2 -translate-x-1/2 top-[38%] flex items-center gap-[12px]">
                  {spouse && <Node p={spouse} />}
                  <Node p={treeSelf} big />
                </div>
                <div className="absolute right-[4%] top-[18%] flex gap-[2px] max-w-[36%] flex-wrap justify-end">
                  {siblings.map(s => <Node key={s.id} p={s} />)}
                </div>
                <div className="absolute left-[47%] bottom-[5%] -translate-x-1/2 flex gap-[2px] justify-center">
                  {children.map(c => <Node key={c.id} p={c} />)}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="col-span-12 lg:col-span-3 space-y-4"><div className="card p-5"><h3 className="font-extrabold text-[13px] mb-3">My Groups</h3></div></div>
      </div>
      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-[24px] w-full max-w-[340px] p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4"><h3 className="font-extrabold text-[16px]">{selected.display_name}</h3><button onClick={() => setSelected(null)} className="w-8 h-8 bg-gray-100 rounded-full">✕</button></div>
            {selected.photo_url? <img src={selected.photo_url} className="w-24 h-24 rounded-[18px] object-cover mx-auto" alt="" /> : <div className="w-24 h-24 rounded-[18px] bg-[#c9ad83] text-white flex items-center justify-center text-[28px] font-extrabold mx-auto">{(selected.display_name?.[0] || '?').toUpperCase()}</div>}
            <p className="text-center text-[10px] text-gray-500 mt-2">{selected.computed_relation || selected.relation_label}</p>
            <div className="flex gap-2 mt-5">
              <button onClick={handleViewProfile} className="flex-1 h-9 bg-blue-600 text-white rounded-full font-bold text-[10px]">View Profile</button>
              <button onClick={handleViewTree} className="flex-1 h-9 bg-black text-white rounded-full font-bold text-[10px]">View Tree</button>
              {!isClaimedSelected && (
                <button onClick={handleShare} disabled={sharing} className="flex-1 h-9 bg-[#f8f5f0] border border-black rounded-full font-bold text-[10px]">{sharing? '...' : 'Share'}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}