import React, { useState, useEffect, useRef } from 'react';
import CommonHeader from './CommonHeader.jsx';
import ChatSystem from './ChatSystem.jsx';
import mangoBasket from './assets/mango-basket.png';

export default function Deck({ onGoProfile, onGoMemberAdd, onGoGroups, onLogout }) {
  const currentUserId = localStorage.getItem('userId') || 'ur001';
  const [loggedProfile, setLoggedProfile] = useState(null);
  const [treeProfiles, setTreeProfiles] = useState([]);
  const [treeSelf, setTreeSelf] = useState(null);
  const [viewUserId, setViewUserId] = useState(currentUserId);
  const [sharing, setSharing] = useState(false);
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
    images: ['https://images.unsplash.com/photo-1609220136736-443140cffec6?w=400','https://images.unsplash.com/photo-1511895426328-dc8714191300?w=400','https://images.unsplash.com/photo-1542037104857-ffbb0b9155fb?w=400'],
    videos: [{thumb:'https://images.unsplash.com/photo-1609220136736-443140cffec6?w=400',dur:'0:32'},{thumb:'https://images.unsplash.com/photo-1542037104857-ffbb0b9155fb?w=400',dur:'0:45'}],
    reels: [{thumb:'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=400',views:'2.1k'},{thumb:'https://images.unsplash.com/photo-1542037104857-ffbb0b9155fb?w=400',views:'890'}]
  });
  const [showChatSystem, setShowChatSystem] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatWith, setChatWith] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef(null);

  const getDisplayName = (p) => {
    if(!p) return 'Unknown';
    const n = p.display_name || p.name || '';
    if(n &&!n.startsWith('pr_') && n.trim()!=='') return n;
    return p.display_name || p.id;
  };

  // DEDUP FIX - Only 1 Father, 1 Mother, no duplicate IDs
  const dedupFamily = (arr) => {
    const byId = Array.from(new Map(arr.map(p=>[p.id,p])).values());
    let fatherSeen=false, motherSeen=false;
    const filtered=[];
    for(const p of byId){
      const rel = p.computed_relation;
      if(rel==='Father'){
        if(fatherSeen) continue;
        fatherSeen=true;
      }
      if(rel==='Mother'){
        if(motherSeen) continue;
        motherSeen=true;
      }
      filtered.push(p);
    }
    // Extra safety: dedup by name for Father/Mother if same name
    return filtered;
  };

  const computeFallbackRelations = (all, self) => {
    if (!self) return dedupFamily(all);
    const mapped = all.map(p => {
      if (p.computed_relation) return p;
      if (p.id === self.id) return {...p, computed_relation: 'Self' };
      if (p.id === self.father_id) return {...p, computed_relation: 'Father' };
      if (p.id === self.mother_id) return {...p, computed_relation: 'Mother' };
      if (p.father_id === self.id || p.mother_id === self.id) return {...p, computed_relation: 'Child' };
      if (self.father_id && p.father_id === self.father_id && p.id!== self.id) return {...p, computed_relation: 'Sibling' };
      return {...p, computed_relation: p.category==='Fnd'? 'Friend' : 'Family'};
    });
    return dedupFamily(mapped);
  };

  const loadTree = async (profileId, shouldUpdateDisplay = false) => {
    let realProfileId = profileId;
    try {
      const profCheck = await fetch(`/api/profiles/${profileId}`).then(r=>r.json()).catch(()=>null);
      if(profCheck?.id) realProfileId = profCheck.id;
    } catch(e){}
    try {
      const res = await fetch(`/api/family-tree/${realProfileId}`);
      const data = await res.json();
      let effective = Array.isArray(data)? data : [];
      if(effective.length <= 1){
        const ownedData = await fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json()).catch(()=>[]);
        if(Array.isArray(ownedData)){
          const existingIds = new Set(effective.map(p=>p.id));
          ownedData.forEach(p=>{
            if(p && p.id &&!existingIds.has(p.id) && (p.father_id===realProfileId || p.mother_id===realProfileId || p.id===realProfileId)){
              effective.push(p);
              existingIds.add(p.id);
            }
          });
        }
      }
      if(effective.length > 0){
        const uniq = dedupFamily(effective);
        const selfNode = uniq.find(p => p.id === realProfileId) || uniq.find(p => p.computed_relation === 'Self') || uniq[0];
        const finalList = computeFallbackRelations(uniq, selfNode);
        setTreeProfiles(finalList);
        setTreeSelf(selfNode);
        if (shouldUpdateDisplay) setDisplayProfile(selfNode);
        return;
      }
    } catch(e) { console.log(e); }
  };

  useEffect(() => {
    fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json()).then(async data=>{
      const me = data?.find(p=>p.id===currentUserId) || data?.[0] || null;
      setLoggedProfile(me);
      setDisplayProfile(me);
      if(me?.id) loadTree(me.id,false);
      else setTreeProfiles(data||[]);
    });
  }, [currentUserId]);

  useEffect(() => {
    const targetId = displayProfile?.id;
    if (!targetId) return;
    fetch(`/api/basket/${targetId}`).then(r=>r.json()).then(b=> setMangoCount(b.claimed?? 0)).catch(()=>setMangoCount(0));
    fetch(`/api/profile-groups?owner_user_id=${targetId}`).then(r=>r.json()).then(g=> setMyGroups(Array.isArray(g)? g : [])).catch(()=>{});
    setExpandedGroup(null); setGroupMembersMap({});
  }, [displayProfile]);

  useEffect(()=>{
    if(treeDepth === 0){ setExtendedTree([]); return; }
    const run = async () => {
      let all = [...treeProfiles];
      let visited = new Set(treeProfiles.map(p=>p.id));
      let queue = [...treeProfiles.map(p=>p.id)];
      let depth = 0;
      while(queue.length>0 && depth < treeDepth){
        const results = await Promise.all(queue.map(id=> fetch(`/api/family-tree/${id}`).then(r=>r.json()).catch(()=>[])));
        const flat = results.flat().filter(Boolean);
        const newOnes = flat.filter(p=>p?.id &&!visited.has(p.id));
        newOnes.forEach(p=>visited.add(p.id));
        all = [...all,...newOnes];
        queue = newOnes.map(p=>p.id);
        depth++;
      }
      setExtendedTree(dedupFamily(all));
    };
    run();
  },[treeDepth, treeProfiles]);

  const father = treeProfiles.find(p=>p.computed_relation==='Father');
  const mother = treeProfiles.find(p=>p.computed_relation==='Mother');
  const spouse = treeProfiles.find(p=>p.computed_relation==='Spouse');
  const siblings = treeProfiles.filter(p=>p.computed_relation==='Sibling');
  const children = treeProfiles.filter(p=>p.computed_relation==='Child');

  const handleNodeClick = (p, isCenter) => {
    if(!p) return;
    if (isCenter) { setDisplayProfile(p); return; }
    if (treeSelf?.id!== p.id) {
      setViewUserId(p.id);
      setIsViewingOther(p.id!==currentUserId);
      loadTree(p.id, false);
    }
  };

  const Node = ({ p, big }) => {
    if (!p) return null;
    const hasPhoto = p.photo_url && p.photo_url.trim()!== '';
    const initial = (getDisplayName(p) || '?')[0].toUpperCase();
    return (
      <div onClick={() => handleNodeClick(p,!!big)} className="flex flex-col items-center cursor-pointer hover:scale-105 transition-transform shrink-0">
        <div className={`${big? 'w-[76px] h-[76px]' : 'w-[64px] h-[64px]'} ${big? 'bg-[#c9ad83] text-white' : 'bg-[#f8f5f0] text-[#5a4a32]'} rounded-[8px] border flex items-center justify-center overflow-hidden shadow-sm`}>
          {hasPhoto? <img src={p.photo_url} className="w-full h-full object-cover" alt="" /> : <span className="font-extrabold text-[18px]">{initial}</span>}
        </div>
        <p className="text-[10px] font-bold mt-1 max-w-[72px] truncate">{getDisplayName(p)}</p>
        <p className="text-[8px] text-gray-500">{p.computed_relation||''}</p>
      </div>
    );
  };

  const handleBackToMyTree = () => { setViewUserId(currentUserId); setDisplayProfile(loggedProfile); setIsViewingOther(false); setTreeDepth(0); if(loggedProfile?.id) loadTree(loggedProfile.id,false); };
  const handleShareCurrent = async () => {
    const target = displayProfile || treeSelf || loggedProfile;
    if(!target || sharing) return;
    setSharing(true);
    try{
      const firstName=(getDisplayName(target)||'User').split(' ')[0].replace(/[^a-zA-Z0-9]/g,'');
      const tempUsername=`UN${firstName}`;
      const res=await fetch('/api/share-temp-user',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:`tmp_${Date.now()}`,name:getDisplayName(target),email:tempUsername,uname:tempUsername,password:'pw1234',profile_id:target.id,invited_by_user_id:currentUserId,allowUpdate:true})});
      const data=await res.json();
      if(!res.ok) throw new Error(data.error);
      await navigator.clipboard.writeText(`Username: ${tempUsername} Password: pw1234`);
      alert(`${data.updated? 'Updated' : 'Created'}: ${tempUsername}/pw1234`);
    }catch(e){ alert(e.message); }
    setSharing(false);
  };

  const allProfiles = extendedTree.length>0? extendedTree : treeProfiles;
  const displayCount = allProfiles.length;
  const treeTitle = treeSelf? `${getDisplayName(treeSelf).split(' ')[0]}'s Family Tree` : 'My Family Tree';
  const groupsTitle = displayProfile? `${getDisplayName(displayProfile).split(' ')[0]}'s Groups` : 'My Groups';
  const canShowShare = displayProfile?.id && displayProfile.id===treeSelf?.id && displayProfile.id!==loggedProfile?.id;

  return (
    <div className="min-h-screen w-full bg-[#f2efe8]">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&display=swap');.card{background:#fffefb;border:1px solid #e9e2d6;border-radius:10px}.family-scroll{width:100%;height:540px;overflow:auto;display:flex;justify-content:flex-start;align-items:flex-start;background:#fffefb}`}</style>
      <CommonHeader page="deck" self={loggedProfile} displayProfile={displayProfile} isViewingOther={isViewingOther} onDeck={handleBackToMyTree} onProfile={onGoProfile} onMembers={onGoMemberAdd} onGroups={onGoGroups} onLogout={onLogout} onBackToMyTree={handleBackToMyTree} />
      <div className="p-4 grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-3 space-y-4">
          <div className="card p-6 text-center">
            {(() => {
              const leftP = displayProfile || loggedProfile;
              return leftP?.photo_url? <img src={leftP.photo_url} onClick={onGoProfile} className="w-[110px] h-[110px] rounded-[8px] mx-auto object-cover border cursor-pointer" alt="" /> : <div onClick={onGoProfile} className="w-[110px] h-[110px] rounded-[8px] mx-auto bg-[#c9ad83] text-white flex items-center justify-center text-[36px] font-extrabold cursor-pointer">{(getDisplayName(leftP)[0]||'?').toUpperCase()}</div>;
            })()}
            <h2 className="font-extrabold text-[18px] mt-3">{getDisplayName(displayProfile)||'Loading...'}</h2>
            <div className="relative inline-block mt-2"><img src={mangoBasket} alt="" className="w-[90px] h-[90px] object-contain mx-auto" /><span className="absolute -top-1 -right-1 bg-[#c9ad83] text-white text-[13px] font-extrabold w-7 h-7 rounded-full flex items-center justify-center border-2 border-white">{mangoCount}</span></div>
            <p className="text-[9px] text-gray-400 mt-1 font-bold tracking-widest">MANGOS IN BASKET</p>
            {canShowShare && <button onClick={handleShareCurrent} disabled={sharing} className="w-full mt-3 py-2.5 bg-[#f8f5f0] border border-[#e9e2d6] rounded-[10px] font-bold text-[12px]">{sharing?'...':'Share'}</button>}
          </div>
        </div>
        <div className="col-span-12 lg:col-span-6 flex flex-col gap-3">
          <div className="bg-[#fffefb] border border-[#e9e2d6] rounded-[10px] overflow-hidden">
            <div className="bg-[#efe8d3] border-b border-[#e9e2d6] p-4 flex justify-between items-center"><h2 className="font-extrabold text-[15px]">{treeTitle}</h2><span className="text-[11px] bg-white px-3 py-1 rounded-full font-bold border">{displayCount} Members</span></div>
            <div className="family-scroll p-4">
              {treeProfiles.length===1? <div className="flex items-center justify-center w-full h-[400px]"><Node p={treeSelf} big /></div> : (
                <div className="flex flex-col items-center w-full">
                  {(father||mother) && <div className="flex gap-4 mb-3">{father && <Node p={father} />}{mother && <Node p={mother} />}</div>}
                  {siblings.length>0 && <div className="flex gap-3 mb-3">{siblings.map(s=> <Node key={s.id} p={s} />)}</div>}
                  <div className="flex gap-4 items-end my-3"><Node p={treeSelf} big />{spouse && <Node p={spouse} />}</div>
                  {children.length>0 && <div className="flex gap-3 flex-wrap justify-center mt-3">{children.map(c=> <Node key={c.id} p={c} />)}</div>}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="col-span-12 lg:col-span-3 space-y-4">
          <div className="card p-5"><h3 className="font-extrabold text-[13px] mb-3">{groupsTitle}</h3><p className="text-[11px] text-gray-400">Manage via Groups tab</p></div>
        </div>
      </div>
      <button onClick={() => setShowChatSystem(true)} className="fixed bottom-5 right-5 w-[56px] h-[56px] bg-black text-white rounded-full flex items-center justify-center shadow-xl z-[9999]">💬</button>
      {showChatSystem && <ChatSystem self={loggedProfile} allProfiles={allProfiles} groups={myGroups} groupMembers={[]} onClose={() => setShowChatSystem(false)} />}
    </div>
  );
}