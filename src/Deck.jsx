import React, { useState, useEffect, useRef } from 'react';
import logo from './assets/clandeck_h.png';
import mangoBasket from './assets/mango-basket.png';

const HomeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
);
const LogoutIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
);

export default function Deck({ onGoProfile, onGoMemberAdd, onGoGroups, onLogout }) {
  const currentUserId = localStorage.getItem('userId') || 'ur001';
  const [loggedProfile, setLoggedProfile] = useState(null);
  const [treeProfiles, setTreeProfiles] = useState([]);
  const [treeSelf, setTreeSelf] = useState(null);
  const [viewUserId, setViewUserId] = useState(currentUserId);
  const [sharing, setSharing] = useState(false);
  const [viewProfile, setViewProfile] = useState(null);
  const [displayProfile, setDisplayProfile] = useState(null);
  const [isViewingOther, setIsViewingOther] = useState(false);
  const [treeDepth, setTreeDepth] = useState(0);
  const [extendedTree, setExtendedTree] = useState([]);
  const [mangoCount, setMangoCount] = useState(0);
  const [myGroups, setMyGroups] = useState([]);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [groupMembersMap, setGroupMembersMap] = useState({});

  const [mediaTab, setMediaTab] = useState('images');
  const mediaScrollRef = useRef(null);
  const [mediaItems] = useState({
    images: [
      'https://images.unsplash.com/photo-1609220136736-443140cffec6?w=400',
      'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=400',
      'https://images.unsplash.com/photo-1542037104857-ffbb0b9155fb?w=400',
      'https://images.unsplash.com/photo-1609220136736-443140cffec6?w=400',
      'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=400',
    ],
    videos: [
      { thumb:'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=400', dur:'0:32' },
      { thumb:'https://images.unsplash.com/photo-1609220136736-443140cffec6?w=400', dur:'1:12' },
      { thumb:'https://images.unsplash.com/photo-1542037104857-ffbb0b9155fb?w=400', dur:'0:45' },
    ],
    reels: [
      { thumb:'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=400', views:'2.1k' },
      { thumb:'https://images.unsplash.com/photo-1542037104857-ffbb0b9155fb?w=400', views:'890' },
      { thumb:'https://images.unsplash.com/photo-1609220136736-443140cffec6?w=400', views:'5.3k' },
      { thumb:'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=400', views:'1.2k' },
    ]
  });

  const [chatOpen, setChatOpen] = useState(false);
  const [chatWith, setChatWith] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef(null);

  const onlyFml = (arr) => (arr||[]).filter(p =>!p.category || p.category === 'Fml');
  const getDisplayName = (p) => {
    if(!p) return 'Unknown';
    const n = p.display_name || p.name || '';
    if(n &&!n.startsWith('pr_') && n.trim()!=='') return n;
    return p.display_name || p.id;
  };
  const computeFallbackRelations = (all, self) => {
    if (!self) return onlyFml(all);
    const fmlAll = onlyFml(all);
    return fmlAll.map(p => {
      if (p.computed_relation) return p;
      if (p.id === self.id) return {...p, computed_relation: 'Self' };
      if (p.id === self.father_id) return {...p, computed_relation: 'Father' };
      if (p.id === self.mother_id) return {...p, computed_relation: 'Mother' };
      if (p.spouse_id && (p.id === self.spouse_id || p.spouse_id === self.id)) return {...p, computed_relation: 'Spouse' };
      if (self.father_id && p.father_id === self.father_id && p.id!== self.id) return {...p, computed_relation: 'Sibling' };
      if (self.mother_id && p.mother_id === self.mother_id && p.id!== self.id) return {...p, computed_relation: 'Sibling' };
      if (p.father_id === self.id || p.mother_id === self.id) return {...p, computed_relation: 'Child' };
      return p;
    });
  };

  const loadTree = async (profileId, shouldUpdateDisplay = false) => {
    try {
      const res = await fetch(`/api/family-tree/${profileId}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const fmlOnly = onlyFml(data);
        const effective = fmlOnly.length > 0? fmlOnly : data;
        setTreeProfiles(effective);
        const self = effective.find(p => p.computed_relation === 'Self' || p.id === profileId) || effective[0];
        setTreeSelf(self);
        if (shouldUpdateDisplay) setDisplayProfile(self);
        return;
      }
    } catch(e) {}
    try {
      const single = await fetch(`/api/profiles/${profileId}`).then(r=>r.json());
      if (single?.id) {
        const node = {...single, computed_relation: 'Self' };
        setTreeProfiles([node]);
        setTreeSelf(node);
        if (shouldUpdateDisplay) setDisplayProfile(node);
        return;
      }
    } catch(e) {}
    if (profileId === currentUserId || profileId === loggedProfile?.id) {
      const all = await fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json()).catch(()=>[]);
      const fmlAll = onlyFml(all);
      const self = fmlAll?.find(p=>p.id===profileId) || fmlAll?.[0] || null;
      const withRelations = computeFallbackRelations(fmlAll || [], self);
      setTreeProfiles(withRelations);
      setTreeSelf(self);
      if (shouldUpdateDisplay) setDisplayProfile(self);
    }
  };

  useEffect(() => {
    fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json()).then(data=>{
      const fmlOnly = onlyFml(data);
      const me = fmlOnly?.find(p=>p.id===currentUserId) || fmlOnly?.find(p=>p.father_id===null && p.mother_id===null) || fmlOnly?.[0];
      setLoggedProfile(me); setDisplayProfile(me);
      if(viewUserId===currentUserId){ if(me?.id) loadTree(me.id,false); else { setTreeProfiles(fmlOnly); setTreeSelf(me); } }
    });
  }, [currentUserId]);

  useEffect(() => {
    const targetId = displayProfile?.id;
    if (!targetId) return;
    fetch(`/api/basket/${targetId}`).then(r=>r.json()).then(b=>{
      setMangoCount(b.claimed?? b.count?? 0);
    }).catch(()=>setMangoCount(0));
    fetch(`/api/profile-groups?owner_user_id=${targetId}`).then(r=>r.json()).then(g=>{
      setMyGroups(Array.isArray(g)? g : []);
    }).catch(()=>{});
    setExpandedGroup(null);
    setGroupMembersMap({});
  }, [displayProfile]);

  // --- UNLIMITED LEVEL FIX ---
  useEffect(()=>{
    if(treeDepth === 0){ setExtendedTree([]); return; }
    const base = treeProfiles;
    if(base.length === 0) return;
    const run = async () => {
      let all = [...base];
      let visited = new Set(base.map(p=>p.id));
      let queue = [...base.map(p=>p.id)];
      let depth = 0;
      while(queue.length>0 && depth < treeDepth){
        const results = await Promise.all(queue.map(id=> fetch(`/api/family-tree/${id}`).then(r=>r.json()).catch(()=>[])));
        const flat = results.flat().filter(Boolean);
        const fmlOnly = onlyFml(flat);
        const newOnes = fmlOnly.filter(p=>p?.id &&!visited.has(p.id));
        newOnes.forEach(p=>visited.add(p.id));
        all = [...all,...newOnes];
        queue = newOnes.map(p=>p.id);
        depth++;
      }
      const unique = Array.from(new Map(all.map(p=>[p.id,p])).values());
      setExtendedTree(unique);
    };
    run();
  },[treeDepth, treeProfiles]);

  useEffect(() => {
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch(e) {}
  }, []);

  const openChat = (profile) => {
    if(!profile) return;
    setChatWith(profile);
    setChatOpen(true);
  };
  useEffect(()=>{
    if(!chatOpen ||!chatWith) return;
    const load = async()=>{
      try{
        const res = await fetch(`/api/messages?from_user_id=${currentUserId}&to_profile_id=${chatWith.id}`);
        const data = await res.json();
        setChatMessages(Array.isArray(data)? data : (data.messages||[]));
      }catch{}
    };
    load();
    const iv = setInterval(load, 3000);
    return ()=> clearInterval(iv);
  },[chatOpen, chatWith, currentUserId]);
  useEffect(()=>{ chatEndRef.current?.scrollIntoView({behavior:'smooth'}); },[chatMessages]);
  const sendChat = async()=>{
    if(!chatInput.trim() ||!chatWith) return;
    const msg = { from_user_id: currentUserId, to_profile_id: chatWith.id, text: chatInput.trim() };
    setChatMessages(prev=>[...prev, {...msg, id: Date.now(), created_at: new Date().toISOString(), me:true}]);
    setChatInput('');
    try{ await fetch('/api/messages', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(msg) }); }catch{}
  };

  const father = treeProfiles.find(p=>p.computed_relation==='Father' || (treeSelf && p.id===treeSelf.father_id));
  const mother = treeProfiles.find(p=>p.computed_relation==='Mother' || (treeSelf && p.id===treeSelf.mother_id));
  const spouse = treeProfiles.find(p=>p.computed_relation==='Spouse');
  const siblings = treeProfiles.filter(p=>p.computed_relation==='Sibling');
  const children = treeProfiles.filter(p=>p.computed_relation==='Child');

  const handleNodeClick = (p, isCenter) => {
    if(!p) return;
    if (isCenter) {
      if (displayProfile?.id!== p.id) {
        setDisplayProfile(p);
        setViewProfile(p);
      }
      return;
    }
    if (treeSelf?.id!== p.id) {
      setViewUserId(p.id);
      setIsViewingOther(p.id!==currentUserId && p.id!==loggedProfile?.id);
      loadTree(p.id, false);
    }
  };

  const handleGroupMemberClick = async (m) => {
    try {
      const full = await fetch(`/api/profiles/${m.id}`).then(r=>r.json()).catch(()=>m);
      const fp = full?.id? full : m;
      setDisplayProfile(fp);
      setViewProfile(fp);
      setViewUserId(fp.id);
      setIsViewingOther(fp.id!==currentUserId && fp.id!==loggedProfile?.id);
      setTreeDepth(0);
      try {
        const res = await fetch(`/api/family-tree/${fp.id}`).then(r=>r.json());
        if (Array.isArray(res) && res.length > 0) {
          const fmlOnly = onlyFml(res);
          const effective = fmlOnly.length > 0? fmlOnly : res;
          setTreeProfiles(effective);
          const self = effective.find(p => p.computed_relation === 'Self' || p.id === fp.id) || effective[0];
          setTreeSelf(self);
          return;
        }
      } catch(e){}
      const singleNode = {...fp, computed_relation: 'Self' };
      setTreeProfiles([singleNode]);
      setTreeSelf(singleNode);
    } catch(e) {
      setDisplayProfile(m);
      setViewProfile(m);
      setViewUserId(m.id);
      const singleNode = {...m, computed_relation: 'Self' };
      setTreeProfiles([singleNode]);
      setTreeSelf(singleNode);
    }
  };

  const handleGroupExpand = async (group) => {
    if (expandedGroup === group.id) { setExpandedGroup(null); return; }
    setExpandedGroup(group.id);
    if (groupMembersMap[group.id]) return;
    try {
      const res = await fetch(`/api/group-members?group_id=${group.id}`);
      const data = await res.json();
      const rawList = Array.isArray(data)? data : [];
      const ids = [...new Set(rawList.map(d => d.profile_id || d.profileId || d.id || d.profile?.id).filter(Boolean))];
      const allForOwner = await fetch(`/api/profiles?owner_user_id=${displayProfile?.id || currentUserId}`).then(r=>r.json()).catch(()=>[]);
      const profiles = await Promise.all(ids.map(async (pid) => {
        const fromRaw = rawList.find(r => (r.profile_id||r.id) === pid);
        if (fromRaw?.profile?.display_name &&!fromRaw.profile.display_name.startsWith('pr_')) return fromRaw.profile;
        if (fromRaw?.display_name &&!fromRaw.display_name.startsWith('pr_')) return fromRaw;
        const cached = allForOwner.find(p => p.id === pid);
        if (cached?.display_name &&!cached.display_name.startsWith('pr_')) return cached;
        const treeCached = [...treeProfiles,...extendedTree].find(p => p.id === pid);
        if (treeCached?.display_name &&!treeCached.display_name.startsWith('pr_')) return treeCached;
        try {
          const single = await fetch(`/api/profiles/${pid}`).then(r=>r.json());
          if (single?.id) {
            if (single.display_name &&!single.display_name.startsWith('pr_')) return single;
            return single;
          }
        } catch(e){}
        return fromRaw || { id: pid, display_name: pid, photo_url: '' };
      }));
      setGroupMembersMap(prev => ({...prev, [group.id]: profiles }));
    } catch(e) {
      setGroupMembersMap(prev => ({...prev, [group.id]: [] }));
    }
  };

  const Node = ({ p, big }) => {
    if (!p) return null;
    const label = p.computed_relation || p.relation_label || '';
    const hasPhoto = p.photo_url && p.photo_url.trim()!== '';
    const initial = (getDisplayName(p) || '?').trim().charAt(0).toUpperCase();
    return (
      <div onClick={() => handleNodeClick(p,!!big)} className="flex flex-col items-center cursor-pointer hover:scale-105 transition-transform shrink-0">
        <div className={`${big? 'tree-node-big' : 'tree-node'} ${big? 'bg-[#c9ad83] text-white' : 'bg-[#f8f5f0] text-[#5a4a32]'} rounded-[8px] border flex items-center justify-center overflow-hidden shadow-sm hover:ring-2 hover:ring-black shrink-0`}>
          {hasPhoto? <img src={p.photo_url} className="w-full h-full object-cover" alt={getDisplayName(p)} /> : <span className="font-extrabold text-[clamp(14px,3cqw,22px)]">{initial}</span>}
        </div>
        <p className="tree-label font-bold mt-1 text-center leading-none max-w-[72px] truncate">{getDisplayName(p)}</p>
        <p className="text-[8px] text-gray-500 leading-none">{label}</p>
      </div>
    );
  };

  const handleBackToMyTree = () => { setViewProfile(null); setViewUserId(currentUserId); setDisplayProfile(loggedProfile); setIsViewingOther(false); setTreeDepth(0); if(loggedProfile?.id) loadTree(loggedProfile.id,false); };
  const handleShareCurrent = async () => {
    const target = displayProfile || treeSelf || loggedProfile;
    if(!target || sharing) return;
    setSharing(true);
    try{
      try {
        const prof = await fetch(`/api/profiles/${target.id}`).then(r=>r.json()).catch(()=>null);
        const userCheck = await fetch(`/api/users?profile_id=${target.id}`).then(r=>r.json()).catch(()=>null);
        const isClaimed = prof?.is_claimed === 1 || prof?.owner_user_id === prof?.id;
        const isOwned = prof?.owner_user_id && prof.owner_user_id!== currentUserId;
        const hasUser = userCheck?.is_owned || (Array.isArray(userCheck) && userCheck.length>0) || userCheck?.id;
        if ((isClaimed && isOwned) || hasUser) {
          alert(`${getDisplayName(target)} take its Ownership, not Possible to create new user credentials`);
          setSharing(false);
          return;
        }
      } catch(e) {}
      const firstName=(getDisplayName(target)||'User').split(' ')[0].replace(/[^a-zA-Z0-9]/g,'');
      const tempUsername=`UN${firstName}`;
      const tempPassword='pw1234';
      const tempId=`tmp_${Date.now()}_${Math.random().toString(36).substr(2,4)}`;
      const res=await fetch('/api/share-temp-user',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:tempId,name:getDisplayName(target),email:tempUsername,password:tempPassword,profile_id:target.id,invited_by_user_id:currentUserId})});
      const data=await res.json();
      if(!res.ok) throw new Error(data.error);
      await navigator.clipboard.writeText(`Username: ${tempUsername}\nPassword: ${tempPassword}\nLink: ${window.location.origin}/login?u=${tempUsername}&p=${tempPassword}`);
      alert(`Temp login created!\nUsername: ${tempUsername}\nPassword: ${tempPassword}\nShared: ${getDisplayName(target)}`);
    }catch(e){
      alert(e.message.includes('Ownership')? e.message : 'Share failed: '+e.message);
    }
    setSharing(false);
  };

  const allProfiles = extendedTree.length>0? extendedTree : treeProfiles;
  const displayCount = treeDepth===0? treeProfiles.length : allProfiles.length;
  const treeTitle = treeSelf?.display_name? `${getDisplayName(treeSelf).split(' ')[0]}'s Family Tree` : 'My Family Tree';
  const groupsTitle = displayProfile?.display_name? `${getDisplayName(displayProfile).split(' ')[0]}'s Groups` : 'My Groups';
  const isSameProfile = displayProfile?.id && treeSelf?.id && displayProfile.id === treeSelf.id;
  const isLoginUserProfile = displayProfile?.id === loggedProfile?.id || displayProfile?.id === currentUserId;
  const canShowShare = isSameProfile &&!isLoginUserProfile;

  const scrollMedia = (dir) => {
    if(!mediaScrollRef.current) return;
    mediaScrollRef.current.scrollBy({ left: dir==='left'? -260 : 260, behavior:'smooth' });
  };

  return (
    <div className="min-h-screen w-full bg-[#f2efe8]" style={{fontFamily:'Plus Jakarta Sans'}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&display=swap');.card{background:#fffefb;border:1px solid #e9e2d6;border-radius:10px}.tree-node{width:64px;height:64px;}.tree-node-big{width:76px;height:76px;font-size:22px;}.tree-label{font-size:10px;}.family-scroll{width:100%;height:540px;overflow:auto;display:flex;justify-content:flex-start;align-items:flex-start;position:relative;background:#fffefb;scrollbar-width:thin;scrollbar-color:#c9ad83 #f8f5f0;-webkit-overflow-scrolling:touch}.family-scroll::-webkit-scrollbar{width:8px;height:8px}.family-scroll::-webkit-scrollbar-thumb{background:#c9ad83;border-radius:10px;border:2px solid #fffefb}.family-scroll::-webkit-scrollbar-track{background:#f8f5f0}@media(max-width:768px){.family-scroll{height:520px;overflow:auto!important}.family-scroll svg{overflow:visible!important}}.scrollbar-hide::-webkit-scrollbar{display:none}.scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}`}</style>

      <header className="h-[78px] bg-[#fffefb] border-b border-[#e9e2d6] flex items-center px-3 md:px-5 justify-between sticky top-0 z-20 w-full">
        <div className="flex items-center gap-2 md:gap-3">
          <img src={logo} alt="Clandeck" className="h-[36px] md:h-[42px] w-auto object-contain" />
          {isViewingOther && (
            <button onClick={handleBackToMyTree} className="px-3 h-8 md:h-9 bg-[#6b5a45] text-white rounded-[4px] text-[11px] font-bold tracking-wide hover:bg-[#5a4a32] transition-colors">Home</button>
          )}
        </div>
        {!isViewingOther && (
          <div className="hidden lg:flex items-center gap-6 text-[13px] font-bold text-[#5a4a32] absolute left-1/2 -translate-x-1/2">
            <span className="text-black border-b-2 border-black pb-0.5">Family Tree</span>
            <button onClick={onGoMemberAdd} className="opacity-60 hover:opacity-100 hover:text-black transition-opacity">Members</button>
            <button onClick={onGoGroups? onGoGroups : onGoMemberAdd} className="opacity-60 hover:opacity-100 hover:text-black transition-opacity">Groups</button>
          </div>
        )}
        <div className="flex items-center gap-2 md:gap-3">
          {!isViewingOther && <button onClick={onGoMemberAdd} className="lg:hidden px-3 h-8 bg-[#f8f5f0] border border-[#e9e2d6] rounded-[4px] text-[11px] font-bold">Members</button>}
          <button className="w-8 h-8 md:w-9 md:h-9 bg-[#f8f5f0] border border-[#e9e2d6] rounded-[4px] flex items-center justify-center hover:bg-[#efe8d3] transition-colors">
            <svg className="w-4 h-4 text-[#5a4a32]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M21 21l-4.3-4.3"/></svg>
          </button>
          <button className="w-8 h-8 md:w-9 md:h-9 bg-[#f8f5f0] border border-[#e9e2d6] rounded-[4px] flex items-center justify-center hover:bg-[#efe8d3] transition-colors relative">
            <svg className="w-4 h-4 text-[#5a4a32]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9a6 6 0 0 1 12 0c0 7 6 5 6 9H0s6-2 6-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
          </button>
          <button onClick={onLogout} className="px-3 md:px-4 h-8 md:h-9 bg-[#6b5a45] text-white rounded-[4px] text-[11px] md:text-[12px] font-bold tracking-wide hover:bg-[#5a4a32] transition-colors">Logout</button>
          {loggedProfile?.photo_url? <img src={loggedProfile?.photo_url} onClick={onGoProfile} className="w-8 h-8 md:w-9 md:h-9 rounded-[4px] object-cover cursor-pointer border border-[#e9e2d6]" title="Click to edit profile" alt="profile" /> : <div onClick={onGoProfile} className="w-8 h-8 md:w-9 md:h-9 rounded-[4px] bg-[#6b5a45] text-white flex items-center justify-center text-[11px] font-bold cursor-pointer" title="Click to edit profile">{(getDisplayName(loggedProfile)?.[0]||'?').toUpperCase()}</div>}
        </div>
      </header>

      <div className="p-4 grid grid-cols-12 gap-4 w-full">
        <div className="col-span-12 lg:col-span-3 space-y-4">
          <div className="card p-6 text-center">
            {(() => {
              const leftP = displayProfile || loggedProfile;
              return leftP?.photo_url? (
                <img src={leftP.photo_url} title="Click to edit profile" onClick={onGoProfile} className="w-[110px] h-[110px] rounded-[8px] mx-auto object-cover border cursor-pointer hover:opacity-80 transition-opacity" alt="" />
              ) : (
                <div title="Click to edit profile" onClick={onGoProfile} className="w-[110px] h-[110px] rounded-[8px] mx-auto bg-[#c9ad83] text-white flex items-center justify-center text-[36px] font-extrabold border cursor-pointer hover:opacity-80 transition-opacity">{((getDisplayName(leftP)||'?')[0]||'?').toUpperCase()}</div>
              );
            })()}
            <h2 className="font-extrabold text-[18px] mt-3">{getDisplayName(displayProfile)||getDisplayName(loggedProfile)||'Loading...'}</h2>
            <div className="relative inline-block mt-2">
              <img src={mangoBasket} alt="Mango basket" className="w-[90px] h-[90px] object-contain mx-auto" />
              <span className="absolute -top-1 -right-1 bg-[#c9ad83] text-white text-[13px] font-extrabold w-7 h-7 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                {mangoCount}
              </span>
            </div>
            <p className="text-[9px] text-gray-400 mt-1 font-bold tracking-widest">MANGOS IN BASKET</p>
            {isViewingOther && displayProfile && (
              <button onClick={()=>openChat(displayProfile)} className="w-full mt-3 py-2.5 bg-black text-white rounded-[8px] font-bold text-[12px] hover:bg-[#222]">Message {getDisplayName(displayProfile).split(' ')[0]}</button>
            )}
            {canShowShare && (
              <div className="flex gap-2 mt-2">
                <button onClick={handleShareCurrent} disabled={sharing} className="w-full py-2.5 bg-[#f8f5f0] border border-[#e9e2d6] text-[#5a4a32] rounded-[10px] font-bold text-[12px] hover:bg-black hover:text-white hover:border-black transition-colors">{sharing?'Sharing...':'Share'}</button>
              </div>
            )}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-6 flex flex-col gap-3">
          <div className="bg-[#fffefb] border border-[#e9e2d6] rounded-[10px] overflow-hidden">
            <div className="bg-[#efe8d3] border-b border-[#e9e2d6] p-4 flex justify-between items-center">
              <h2 className="font-extrabold text-[15px]">{treeTitle}</h2>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-white rounded-full border border-[#e9e2d6] px-1 py-1">
                  <button onClick={()=>setTreeDepth(d=>Math.max(0,d-1))} disabled={treeDepth===0} className="w-6 h-6 rounded-full bg-black text-white text-[14px] font-bold flex items-center justify-center disabled:opacity-30">−</button>
                  <span className="text-[10px] font-bold px-1">L{treeDepth}</span>
                  <button onClick={()=>setTreeDepth(d=>Math.min(10,d+1))} disabled={treeDepth===10} className="w-6 h-6 rounded-full bg-black text-white text-[14px] font-bold flex items-center justify-center disabled:opacity-30">+</button>
                </div>
                <span className="text-[11px] bg-white px-3 py-1 rounded-full font-bold border border-[#e9e2d6]">{displayCount} Members</span>
              </div>
            </div>
            <div className="p-0 w-full overflow-x-auto overflow-y-visible">
              <div className="family-scroll" style={{overflow:'visible'}}>
                {treeDepth===0? (
                  (() => {
                    const hasParents =!!(father || mother);
                    const hasSibs = siblings.length>0;
                    let minLeft = 562;
                    if(father) minLeft = Math.min(minLeft, 520);
                    if(mother) minLeft = Math.min(minLeft, 616);
                    if(hasSibs) minLeft = Math.min(minLeft, 440 - (siblings.length-1)*100);
                    if(spouse) minLeft = Math.min(minLeft, 670, 622);
                    else minLeft = Math.min(minLeft, 568);
                    let minTop = 312;
                    if(hasParents) minTop = 180;
                    else if(hasSibs) minTop = 246;
                    const shiftX = minLeft - 20;
                    const shiftY = minTop - 20;
                    const canvasW = Math.max(500, 180 + siblings.length*110 + children.length*80) + 64;
                    const canvasH = hasParents? 552 : (hasSibs? 420 : 360);
                    const isSingle = treeProfiles.length===1;
                    if(isSingle){
                      return (<div className="flex items-center justify-center w-full h-[400px]"><Node p={treeSelf} big /></div>);
                    }
                    return (
                      <div className="relative" style={{width:`${canvasW}px`,height:`${canvasH}px`,minWidth:'500px', marginLeft:'0', marginRight:'auto', overflow:'visible'}}>
                        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{zIndex:0, overflow:'visible'}}>
                          {father && mother && <line x1={584-shiftX} y1={212-shiftY} x2={616-shiftX} y2={212-shiftY} stroke="#c9ad83" strokeWidth="1.5"/>}
                          {(father || mother) && <line x1={600-shiftX} y1={212-shiftY} x2={600-shiftX} y2={312-shiftY} stroke="#c9ad83" strokeWidth="1.5"/>}
                          {treeSelf && spouse && <line x1={638-shiftX} y1={352-shiftY} x2={670-shiftX} y2={352-shiftY} stroke="#c9ad83" strokeWidth="1.5"/>}
                          {treeSelf && spouse && children.length>0 && (
                            <line x1={654-shiftX} y1={352-shiftY} x2={654-shiftX} y2={444-shiftY} stroke="#c9ad83" strokeWidth="1.5"/>
                          )}
                          {treeSelf && children.length>1 && (() => {
                            const childRowLeft = spouse? 622 : 568;
                            const childGap = 80;
                            const childW = 64;
                            const childTop = 444;
                            const drop = 12;
                            const firstCX = childRowLeft + childW/2 - shiftX;
                            const topY = childTop - drop - shiftY;
                            const lastCX = childRowLeft + (children.length-1)*childGap + childW/2 - shiftX;
                            return (
                              <>
                                <line x1={firstCX} y1={topY} x2={lastCX} y2={topY} stroke="#c9ad83" strokeWidth="1.2"/>
                                {children.slice(1).map((_, idx) => {
                                  const i = idx + 1;
                                  const cx = childRowLeft + i*childGap + childW/2 - shiftX;
                                  return <line key={`cdrop-${i}`} x1={cx} y1={topY} x2={cx} y2={childTop - shiftY} stroke="#c9ad83" strokeWidth="1.2"/>;
                                })}
                              </>
                            );
                          })()}
                          {siblings.length>1 && (
                            <>
                              <line x1={472-shiftX} y1={236-shiftY} x2={472 - (siblings.length-1)*100 - shiftX} y2={236-shiftY} stroke="#c9ad83" strokeWidth="1.2"/>
                              {siblings.map((_,i)=> <line key={`s-${i}`} x1={472 - i*100 - shiftX} y1={236-shiftY} x2={472 - i*100 - shiftX} y2={246-shiftY} stroke="#c9ad83" strokeWidth="1.2"/>)}
                            </>
                          )}
                          {siblings.length>0 && (
                            <>
                              <line x1={600-shiftX} y1={285-shiftY} x2={504-shiftX} y2={285-shiftY} stroke="#c9ad83" strokeWidth="1.5"/>
                              <line x1={504-shiftX} y1={278-shiftY} x2={504-shiftX} y2={285-shiftY} stroke="#c9ad83" strokeWidth="1.5"/>
                            </>
                          )}
                        </svg>
                        {father && mother && <div className="absolute" style={{left:`${593-shiftX}px`,top:`${190-shiftY}px`,zIndex:3,fontSize:'10px'}}>❤️</div>}
                        {treeSelf && spouse && <div className="absolute" style={{left:`${647-shiftX}px`,top:`${330-shiftY}px`,zIndex:3,fontSize:'10px'}}>❤️</div>}
                        <div className="absolute" style={{left:`${520-shiftX}px`,top:`${180-shiftY}px`,zIndex:3}}>{father && <Node p={father} />}</div>
                        <div className="absolute" style={{left:`${616-shiftX}px`,top:`${180-shiftY}px`,zIndex:3}}>{mother && <Node p={mother} />}</div>
                        {siblings.map((s, idx) => (
                          <div key={s.id} className="absolute" style={{left:`${440 - idx*100 - shiftX}px`, top:`${246-shiftY}px`,zIndex:3}}>
                            <Node p={s} />
                          </div>
                        ))}
                        <div className="absolute" style={{left:`${562-shiftX}px`,top:`${312-shiftY}px`,zIndex:3}}><Node p={treeSelf} big /></div>
                        <div className="absolute" style={{left:`${670-shiftX}px`,top:`${320-shiftY}px`,zIndex:3}}>{spouse && <Node p={spouse} />}</div>
                        <div className="absolute flex" style={{left: spouse? `${622-shiftX}px` : `${568-shiftX}px`, top:`${444-shiftY}px`, gap:'16px', flexWrap:'nowrap', zIndex:3}}>
                          {children.map(c=> (
                            <div key={c.id} style={{width:'64px', flexShrink:0}}>
                              <Node p={c} />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div style={{width:'1200px',minWidth:'1200px',minHeight:'540px',padding:'20px'}}>
                    <p className="text-[10px] text-gray-500 mb-3">Level {treeDepth} - Unlimited tree ({allProfiles.length} members)</p>
                    <div className="flex flex-wrap gap-5">
                      {allProfiles.map(p=><Node key={p.id} p={p} />)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-[#fffefb] border border-[#e9e2d6] rounded-[10px] overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-0 border-b border-[#e9e2d6] h-[48px]">
              <div className="flex gap-6 h-full items-end">
                <button onClick={()=>setMediaTab('images')} className={`text-[13px] pb-[10px] border-b-2 transition-all ${mediaTab==='images'?'border-black font-extrabold text-black':'border-transparent font-bold text-[#8a8a8a] hover:text-black'}`}>Image</button>
                <button onClick={()=>setMediaTab('videos')} className={`text-[13px] pb-[10px] border-b-2 transition-all ${mediaTab==='videos'?'border-black font-extrabold text-black':'border-transparent font-bold text-[#8a8a8a] hover:text-black'}`}>Video</button>
                <button onClick={()=>setMediaTab('reels')} className={`text-[13px] pb-[10px] border-b-2 transition-all ${mediaTab==='reels'?'border-black font-extrabold text-black':'border-transparent font-bold text-[#8a8a8a] hover:text-black'}`}>Reel</button>
              </div>
              <div className="flex gap-1">
                <button onClick={()=>scrollMedia('left')} className="w-7 h-7 rounded-full border border-[#e9e2d6] bg-white flex items-center justify-center text-[14px] hover:bg-[#f8f5f0]">‹</button>
                <button onClick={()=>scrollMedia('right')} className="w-7 h-7 rounded-full bg-black text-white flex items-center justify-center text-[14px]">›</button>
              </div>
            </div>
            <div ref={mediaScrollRef} className="flex gap-3 overflow-x-auto scrollbar-hide p-3 scroll-smooth">
              {mediaTab==='images' && mediaItems.images.map((src,i)=>(
                <img key={i} src={src} className="w-[160px] h-[110px] object-cover rounded-[8px] border border-[#e9e2d6] flex-shrink-0" alt="" />
              ))}
              {mediaTab==='videos' && mediaItems.videos.map((v,i)=>(
                <div key={i} className="relative w-[180px] h-[110px] rounded-[8px] overflow-hidden border border-[#e9e2d6] flex-shrink-0 cursor-pointer">
                  <img src={v.thumb} className="w-full h-full object-cover" alt="" />
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center"><div className="w-8 h-8 bg-white/90 rounded-full flex items-center justify-center text-[10px]">▶</div></div>
                  <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded">{v.dur}</div>
                </div>
              ))}
              {mediaTab==='reels' && mediaItems.reels.map((r,i)=>(
                <div key={i} className="relative w-[110px] h-[180px] rounded-[8px] overflow-hidden border border-[#e9e2d6] flex-shrink-0 cursor-pointer">
                  <img src={r.thumb} className="w-full h-full object-cover" alt="" />
                  <div className="absolute bottom-1 left-1 text-[9px] text-white bg-black/60 px-1.5 py-0.5 rounded">{r.views} views</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-3 space-y-4">
          <div className="card p-5">
            <h3 className="font-extrabold text-[13px] mb-3">{groupsTitle}</h3>
            {myGroups.length===0? (
              <p className="text-[11px] text-gray-400">No groups yet</p>
            ) : (
              <div className="space-y-2">
                {myGroups.map(g=> {
                  const isExpanded = expandedGroup === g.id;
                  const members = groupMembersMap[g.id] || [];
                  return (
                    <div key={g.id} className="border border-[#e9e2d6] rounded-[6px] overflow-hidden">
                      <div onClick={()=>handleGroupExpand(g)} className={`flex justify-between items-center px-3 py-2 cursor-pointer ${isExpanded? 'bg-black text-white' : 'bg-[#f8f5f0] hover:bg-[#efe8d3]'}`}>
                        <span className="text-[12px] font-bold">{g.name}</span>
                        <span className="text-[10px] bg-black text-white px-2 py-0.5 rounded-full">{g.member_count|| members.length || 0}</span>
                      </div>
                      {isExpanded && (
                        <div className="bg-white p-2 space-y-1 max-h-[180px] overflow-y-auto">
                          {members.length===0? <p className="text-[10px] text-gray-400 p-1">Loading...</p> : members.map(m=> (
                            <div key={m.id} onClick={()=>handleGroupMemberClick(m)} className="flex items-center gap-2 px-2 py-1.5 hover:bg-[#f8f5f0] rounded-[4px] cursor-pointer">
                              {m.photo_url? <img src={m.photo_url} className="w-7 h-7 rounded-[4px] object-cover shrink-0" alt="" /> : <div className="w-7 h-7 rounded-[4px] bg-[#c9ad83] text-white flex items-center justify-center text-[11px] font-bold shrink-0">{(getDisplayName(m)?.[0]||'?').toUpperCase()}</div>}
                              <span className="text-[11px] font-bold truncate">{getDisplayName(m)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {!isViewingOther && (
                  <button onClick={onGoMemberAdd} className="w-full mt-2 h-9 bg-black text-white rounded-[4px] text-[11px] font-bold">Manage Groups</button>
                )}
              </div>
            )}
          </div>
          <div className="card p-3">
            <p className="text-[10px] font-bold text-gray-400 mb-2 tracking-widest">ADVERTISEMENT</p>
            <div className="w-full bg-[#f8f5f0] border border-dashed border-[#c9ad83] rounded-[8px] flex items-center justify-center relative overflow-hidden" style={{ aspectRatio: '1/1', minHeight: '250px' }}>
              <ins className="adsbygoogle" style={{ display: 'block', width: '100%', height: '100%' }} data-ad-client="ca-pub-XXXXXXXXXXXXXX" data-ad-slot="YYYYYYYYYY" data-ad-format="square" data-full-width-responsive="false"></ins>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-[#c9ad83] pointer-events-none">
                <span className="text-[28px]">□</span>
                <span className="text-[11px] font-bold mt-1">Ad Slot</span>
                <span className="text-[10px]">300 x 250</span>
                <span className="text-[9px] text-gray-400 mt-1">Square</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!chatOpen && (
        <button onClick={()=>displayProfile && openChat(displayProfile)}
          className="fixed bottom-4 right-4 w-12 h-12 bg-black text-white rounded-full flex items-center justify-center shadow-xl z-50 hover:scale-105 transition-transform">
          💬
        </button>
      )}
      {chatOpen && chatWith && (
        <div className="fixed bottom-4 right-4 w-[320px] h-[400px] bg-white border border-[#e9e2d6] rounded-[12px] shadow-2xl flex flex-col z-50 overflow-hidden">
          <div className="bg-[#efe8d3] px-3 py-2.5 flex justify-between items-center border-b border-[#e9e2d6]">
            <div className="flex items-center gap-2">
              {chatWith.photo_url? <img src={chatWith.photo_url} className="w-7 h-7 rounded-full object-cover" alt="" /> : <div className="w-7 h-7 rounded-full bg-[#c9ad83] text-white flex items-center justify-center text-[10px] font-bold">{(getDisplayName(chatWith)[0]||'?').toUpperCase()}</div>}
              <span className="text-[12px] font-extrabold">{getDisplayName(chatWith)}</span>
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            </div>
            <button onClick={()=>setChatOpen(false)} className="w-6 h-6 rounded-full bg-black text-white flex items-center justify-center text-[12px]">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 bg-[#fffefb]">
            {chatMessages.length===0 && <p className="text-[11px] text-gray-400 text-center mt-8">Say hi to {getDisplayName(chatWith)} 👋</p>}
            {chatMessages.map(m=>(
              <div key={m.id||m._id} className={`max-w-[75%] px-3 py-1.5 rounded-[12px] text-[12px] leading-snug ${m.from_user_id===currentUserId || m.me? 'self-end bg-black text-white rounded-br-[4px]' : 'self-start bg-[#efe8d3] text-black rounded-bl-[4px]'}`}>
                {m.text || m.message}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="p-2 border-t border-[#e9e2d6] flex gap-2 bg-white">
            <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendChat()}
              placeholder={`Message ${getDisplayName(chatWith).split(' ')[0]}...`}
              className="flex-1 bg-[#f5f0e8] rounded-full px-3 py-2 text-[12px] outline-none border border-[#e9e2d6] focus:border-black" />
            <button onClick={sendChat} className="w-8 h-8 bg-black text-white rounded-full flex items-center justify-center text-[12px] hover:bg-[#222]">➤</button>
          </div>
        </div>
      )}
    </div>
  );
}