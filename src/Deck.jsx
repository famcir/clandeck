import React, { useState, useEffect } from 'react';
import logo from './assets/clandeck_h.png';

export default function Deck({ onGoProfile, onLogout }) {
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

  const computeFallbackRelations = (all, self) => {
    if (!self) return all;
    return all.map(p => {
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
        setTreeProfiles(data);
        const self = data.find(p => p.computed_relation === 'Self' || p.id === profileId) || data[0];
        setTreeSelf(self);
        if (shouldUpdateDisplay) setDisplayProfile(self);
        return;
      }
    } catch(e) {}
    const all = await fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json()).catch(()=>[]);
    const self = all?.find(p=>p.id===profileId) || all?.[0] || null;
    const withRelations = computeFallbackRelations(all || [], self);
    setTreeProfiles(withRelations);
    setTreeSelf(self);
    if (shouldUpdateDisplay) setDisplayProfile(self);
  };

  useEffect(() => {
    fetch(`/api/profiles?owner_user_id=${currentUserId}`).then(r=>r.json()).then(data=>{
      const me = data?.find(p=>p.id===currentUserId) || data?.find(p=>p.father_id===null && p.mother_id===null) || data?.[0];
      setLoggedProfile(me); setDisplayProfile(me);
      if(viewUserId===currentUserId){ if(me?.id) loadTree(me.id,false); else { setTreeProfiles(data||[]); setTreeSelf(me); } }
    });
    fetch(`/api/basket/${currentUserId}`).then(r=>r.json()).then(b=>{
      setMangoCount(b.claimed);
    }).catch(()=>{});
  }, [currentUserId]);

  useEffect(()=>{ if(viewUserId===currentUserId) return; if(viewUserId) loadTree(viewUserId,false); },[viewUserId]);

  useEffect(()=>{
    if(treeDepth === 0){ setExtendedTree([]); return; }
    const base = treeProfiles;
    if(base.length === 0) return;
    const ids = [...new Set([...base.map(p=>p.id)])];
    Promise.all(ids.map(id=> fetch(`/api/family-tree/${id}`).then(r=>r.json()).catch(()=>[])))
.then(results=>{
        const flat = results.flat().filter(Boolean);
        const merged = [...base,...flat];
        const unique = Array.from(new Map(merged.map(p=>[p.id,p])).values());
        setExtendedTree(unique);
      });
  },[treeDepth, treeProfiles]);

  useEffect(() => {
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch(e) {}
  }, []);

  const father = treeProfiles.find(p=>p.computed_relation==='Father' || (treeSelf && p.id===treeSelf.father_id));
  const mother = treeProfiles.find(p=>p.computed_relation==='Mother' || (treeSelf && p.id===treeSelf.mother_id));
  const spouse = treeProfiles.find(p=>p.computed_relation==='Spouse');
  const siblings = treeProfiles.filter(p=>p.computed_relation==='Sibling');
  const children = treeProfiles.filter(p=>p.computed_relation==='Child');

  const handleNodeClick = (p, isCenter) => {
    if(!p) return;
    if(isCenter){ setDisplayProfile(p); } else { setViewProfile(p); setViewUserId(p.id); setIsViewingOther(p.id!==currentUserId && p.id!==loggedProfile?.id); loadTree(p.id,false); }
  };

  const Node = ({ p, big }) => {
    if (!p) return null;
    const label = p.computed_relation || p.relation_label || '';
    const hasPhoto = p.photo_url && p.photo_url.trim()!== '';
    const initial = (p.display_name || '?').trim().charAt(0).toUpperCase();
    return (
      <div onClick={() => handleNodeClick(p,!!big)} className="flex flex-col items-center cursor-pointer hover:scale-105 transition-transform shrink-0">
        <div className={`${big? 'tree-node-big' : 'tree-node'} ${big? 'bg-[#c9ad83] text-white' : 'bg-[#f8f5f0] text-[#5a4a32]'} rounded-[8px] border flex items-center justify-center overflow-hidden shadow-sm hover:ring-2 hover:ring-black shrink-0`}>
          {hasPhoto? <img src={p.photo_url} className="w-full h-full object-cover" alt={p.display_name} /> : <span className="font-extrabold text-[clamp(14px,3cqw,22px)]">{initial}</span>}
        </div>
        <p className="tree-label font-bold mt-1 text-center leading-none max-w-[72px] truncate">{p.display_name}</p>
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
          alert(`${target.display_name} take its Ownership, not Possible to create new user credentials`);
          setSharing(false);
          return;
        }
      } catch(e) {}

      const firstName=(target.display_name||'User').split(' ')[0].replace(/[^a-zA-Z0-9]/g,'');
      const tempUsername=`UN${firstName}`;
      const tempPassword='pw1234';
      const tempId=`tmp_${Date.now()}_${Math.random().toString(36).substr(2,4)}`;
      const res=await fetch('/api/share-temp-user',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:tempId,name:target.display_name,email:tempUsername,password:tempPassword,profile_id:target.id,invited_by_user_id:currentUserId})});
      const data=await res.json();
      if(!res.ok) throw new Error(data.error);
      await navigator.clipboard.writeText(`Username: ${tempUsername}\nPassword: ${tempPassword}\nLink: ${window.location.origin}/login?u=${tempUsername}&p=${tempPassword}`);
      alert(`Temp login created!\nUsername: ${tempUsername}\nPassword: ${tempPassword}\nShared: ${target.display_name}`);
    }catch(e){
      alert(e.message.includes('Ownership')? e.message : 'Share failed: '+e.message);
    }
    setSharing(false);
  };

  const allProfiles = extendedTree.length>0? extendedTree : treeProfiles;
  const displayCount = treeDepth===0? treeProfiles.length : allProfiles.length;

  const treeTitle = isViewingOther && treeSelf?.display_name? `${treeSelf.display_name.split(' ')[0]}'s Family Tree` : 'My Family Tree';
  const isSameProfile = displayProfile?.id && treeSelf?.id && displayProfile.id === treeSelf.id;
  const isLoginUserProfile = displayProfile?.id === loggedProfile?.id || displayProfile?.id === currentUserId;
  const canShowShare = isSameProfile &&!isLoginUserProfile;

  return (
    <div className="min-h-screen w-full bg-[#f2efe8]" style={{fontFamily:'Plus Jakarta Sans'}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&display=swap');.card{background:#fffefb;border:1px solid #e9e2d6;border-radius:10px}.tree-node{width:64px;height:64px;}.tree-node-big{width:76px;height:76px;font-size:22px;}.tree-label{font-size:10px;}.family-scroll{width:100%;height:540px;overflow:scroll!important;display:block;position:relative;background:#fffefb}.family-scroll::-webkit-scrollbar{width:12px;height:12px;display:block}.family-scroll::-webkit-scrollbar-thumb{background:#c9ad83;border-radius:10px;border:2px solid #fffefb}.family-scroll::-webkit-scrollbar-track{background:#f8f5f0}`}</style>
      <header className="h-[68px] bg-[#fffefb] border-b border-[#e9e2d6] flex items-center px-6 justify-between sticky top-0 z-20 w-full">
        <div className="flex items-center gap-3"><img src={logo} alt="Clandeck" className="h-[60px] w-auto object-contain" />{isViewingOther && <button onClick={handleBackToMyTree} className="ml-2 px-4 h-8 bg-black text-white rounded-full text-[11px] font-bold">Deck</button>}</div>
        <div className="flex items-center gap-3"><button onClick={onLogout} className="px-5 h-9 bg-black text-white rounded-full text-[12px] font-bold">Logout</button>{loggedProfile?.photo_url? <img src={loggedProfile?.photo_url} onClick={onGoProfile} className="w-9 h-9 rounded-full object-cover cursor-pointer border-2 border-[#c9ad83]" alt="profile" /> : <div onClick={onGoProfile} className="w-9 h-9 rounded-full bg-[#c9ad83] text-white flex items-center justify-center text-[12px] font-bold cursor-pointer border-2 border-[#c9ad83]">{(loggedProfile?.display_name?.[0]||'?').toUpperCase()}</div>}</div>
      </header>
      <div className="p-4 grid grid-cols-12 gap-4 w-full">
        <div className="col-span-12 lg:col-span-3 space-y-4">
          <div className="card p-6 text-center">
            {(displayProfile?.photo_url||loggedProfile?.photo_url)? <img src={displayProfile?.photo_url||loggedProfile?.photo_url} className="w-[110px] h-[110px] rounded-[8px] mx-auto object-cover border" alt="" /> : <div className="w-[110px] h-[110px] rounded-[8px] mx-auto bg-[#c9ad83] text-white flex items-center justify-center text-[36px] font-extrabold border">{((displayProfile?.display_name||loggedProfile?.display_name||'?')[0]||'?').toUpperCase()}</div>}
            <h2 className="font-extrabold text-[18px] mt-3">{displayProfile?.display_name||loggedProfile?.display_name||'Loading...'}</h2>
            <p className="text-[11px] text-[#5a4a32] bg-[#efe8d3] px-2 py-1 rounded-full inline-block mt-1 font-bold">Mangos in your basket - {mangoCount}</p>
            <div className="flex gap-2 mt-4">
              <button onClick={onGoProfile} className="flex-1 py-2.5 bg-[#efe8d3] border border-[#e9e2d6] text-[#5a4a32] rounded-[10px] font-bold text-[12px] hover:bg-[#e8dcc0] transition-colors">View Full Profile</button>
              {canShowShare && (
                <button onClick={handleShareCurrent} disabled={sharing} className="flex-1 py-2.5 bg-[#f8f5f0] border border-[#e9e2d6] text-[#5a4a32] rounded-[10px] font-bold text-[12px] hover:bg-black hover:text-white hover:border-black transition-colors">{sharing?'Sharing...':'Share'}</button>
              )}
            </div>
          </div>
        </div>
        <div className="col-span-12 lg:col-span-6 flex flex-col gap-0">
          <div className="bg-[#efe8d3] border border-[#e9e2d6] border-b-0 rounded-t-[10px] rounded-b-none p-4 flex justify-between items-center">
            <h2 className="font-extrabold text-[15px]">{treeTitle}</h2>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-white rounded-full border border-[#e9e2d6] px-1 py-1">
                <button onClick={()=>setTreeDepth(d=>Math.max(0,d-1))} disabled={treeDepth===0} className="w-6 h-6 rounded-full bg-black text-white text-[14px] font-bold flex items-center justify-center disabled:opacity-30">−</button>
                <span className="text-[10px] font-bold px-1">L{treeDepth}</span>
                <button onClick={()=>setTreeDepth(d=>Math.min(2,d+1))} disabled={treeDepth===2} className="w-6 h-6 rounded-full bg-black text-white text-[14px] font-bold flex items-center justify-center disabled:opacity-30">+</button>
              </div>
              <span className="text-[11px] bg-white px-3 py-1 rounded-full font-bold border border-[#e9e2d6]">{displayCount} Members</span>
            </div>
          </div>
          <div className="bg-[#fffefb] border border-[#e9e2d6] rounded-b-[10px] rounded-t-none p-0 w-full overflow-hidden">
            <div className="family-scroll">
              {treeDepth===0? (
                <div className="relative" style={{width:'900px',height:'750px',minWidth:'900px',minHeight:'750px'}}>
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{zIndex:2}}>
                    {father && mother && <line x1="384" y1="212" x2="416" y2="212" stroke="#c9ad83" strokeWidth="1.5"/>}
                    {(father || mother) && <line x1="400" y1="212" x2="400" y2="312" stroke="#c9ad83" strokeWidth="1.5"/>}
                    {treeSelf && spouse && <line x1="438" y1="352" x2="470" y2="352" stroke="#c9ad83" strokeWidth="1.5"/>}
                    {treeSelf && spouse && children.length>0 && (
                      <>
                        <line x1="454" y1="352" x2="454" y2="434" stroke="#c9ad83" strokeWidth="1.5"/>
                        {children.length>1 && <line x1="454" y1="434" x2={454 + (children.length-1)*80} y2="434" stroke="#c9ad83" strokeWidth="1.2"/>}
                        {children.map((_,i)=> <line key={`c-${i}`} x1={454 + i*80} y1="434" x2={454 + i*80} y2="444" stroke="#c9ad83" strokeWidth="1.2"/>)}
                      </>
                    )}
                    {siblings.length>1 && (
                      <>
                        <line x1={272} y1="236" x2={272 - (siblings.length-1)*100} y2="236" stroke="#c9ad83" strokeWidth="1.2"/>
                        {siblings.map((_,i)=> <line key={`s-${i}`} x1={272 - i*100} y1="236" x2={272 - i*100} y2="246" stroke="#c9ad83" strokeWidth="1.2"/>)}
                      </>
                    )}
                    {siblings.length>0 && (
                      <>
                        <line x1="400" y1="285" x2="304" y2="285" stroke="#c9ad83" strokeWidth="1.5"/>
                        <line x1="304" y1="278" x2="304" y2="285" stroke="#c9ad83" strokeWidth="1.5"/>
                      </>
                    )}
                  </svg>
                  {father && mother && <div className="absolute" style={{left:'393px',top:'190px',zIndex:3,fontSize:'10px'}}>❤️</div>}
                  {treeSelf && spouse && <div className="absolute" style={{left:'447px',top:'330px',zIndex:3,fontSize:'10px'}}>❤️</div>}
                  <div className="absolute" style={{left:'320px',top:'180px'}}>{father && <Node p={father} />}</div>
                  <div className="absolute" style={{left:'416px',top:'180px'}}>{mother && <Node p={mother} />}</div>
                  {siblings.map((s, idx) => (
                    <div key={s.id} className="absolute" style={{left:`${240 - idx*100}px`, top:'246px'}}>
                      <Node p={s} />
                    </div>
                  ))}
                  <div className="absolute" style={{left:'362px',top:'312px',zIndex:3}}><Node p={treeSelf} big /></div>
                  <div className="absolute" style={{left:'470px',top:'320px'}}>{spouse && <Node p={spouse} />}</div>
                  <div className="absolute flex gap-4" style={{left: spouse? '454px' : '400px', top:'444px', transform:'translateX(-32px)', maxWidth:'600px', flexWrap:'wrap'}}>
                    {children.map(c=> <Node key={c.id} p={c} />)}
                  </div>
                </div>
              ) : treeDepth===1? (
                <div className="relative" style={{width:'1200px',height:'700px',minWidth:'1200px',minHeight:'700px'}}>
                  <div className="absolute flex gap-6" style={{left:'20px',top:'10px',flexWrap:'wrap',maxWidth:'1100px'}}>
                    {allProfiles.filter(p=>p.computed_relation==='Father').map(p=><Node key={p.id} p={p} />)}
                  </div>
                  <div className="absolute flex gap-6" style={{left:'20px',top:'180px',flexWrap:'wrap',maxWidth:'1100px'}}>
                    {allProfiles.filter(p=>['Self','Sibling','Spouse','Mother'].includes(p.computed_relation)).map(p=><Node key={p.id} p={p} />)}
                  </div>
                  <div className="absolute flex gap-6" style={{left:'20px',top:'380px',flexWrap:'wrap',maxWidth:'1100px'}}>
                    {allProfiles.filter(p=>p.computed_relation==='Child').map(p=><Node key={p.id} p={p} />)}
                  </div>
                </div>
              ) : (
                <div style={{width:'1200px',minWidth:'1200px',minHeight:'700px',padding:'20px'}}>
                  <p className="text-[10px] text-gray-500 mb-3">Level 2 - Full joined tree ({allProfiles.length} members)</p>
                  <div className="flex flex-wrap gap-5">
                    {allProfiles.map(p=><Node key={p.id} p={p} />)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="col-span-12 lg:col-span-3 space-y-4">
          <div className="card p-5"><h3 className="font-extrabold text-[13px] mb-3">My Groups</h3></div>
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
    </div>
  );
}