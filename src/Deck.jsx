import React, { useState, useEffect } from 'react';
import logo from './assets/clandeck_h.png';
import mangoBasket from './assets/mango-basket.png';

const HomeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
);
const LogoutIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
);

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
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&display=swap');.card{background:#fffefb;border:1px solid #e9e2d6;border-radius:10px}.tree-node{width:64px;height:64px;}.tree-node-big{width:76px;height:76px;font-size:22px;}.tree-label{font-size:10px;}.family-scroll{width:100%;height:540px;overflow:auto;display:flex;justify-content:flex-start;align-items:flex-start;position:relative;background:#fffefb;scrollbar-width:thin;scrollbar-color:#c9ad83 #f8f5f0;-webkit-overflow-scrolling:touch}.family-scroll::-webkit-scrollbar{width:8px;height:8px}.family-scroll::-webkit-scrollbar-thumb{background:#c9ad83;border-radius:10px;border:2px solid #fffefb}.family-scroll::-webkit-scrollbar-track{background:#f8f5f0}@media(max-width:768px){.family-scroll{height:520px;overflow:auto!important}.family-scroll svg{overflow:visible!important}}`}</style>
      <header className="h-[68px] bg-[#fffefb] border-b border-[#e9e2d6] flex items-center px-3 md:px-6 justify-between sticky top-0 z-20 w-full">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Clandeck" className="h-[44px] md:h-[60px] w-auto object-contain" />
          {isViewingOther && (
            <button onClick={handleBackToMyTree} className="ml-2 px-4 h-[32px] bg-[#6b5a45] text-white rounded-[4px] text-[12px] font-bold tracking-wide hover:bg-[#5a4a32] transition-colors">
              Home
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onLogout} className="px-4 h-[32px] bg-[#6b5a45] text-white rounded-[4px] text-[12px] font-bold tracking-wide hover:bg-[#5a4a32] transition-colors">
            Logout
          </button>
          {loggedProfile?.photo_url? <img src={loggedProfile?.photo_url} onClick={onGoProfile} className="w-8 h-8 rounded-[4px] object-cover cursor-pointer border border-[#e9e2d6]" title="Click to edit profile" alt="profile" /> : <div onClick={onGoProfile} className="w-8 h-8 rounded-[4px] bg-[#6b5a45] text-white flex items-center justify-center text-[12px] font-bold cursor-pointer" title="Click to edit profile">{(loggedProfile?.display_name?.[0]||'?').toUpperCase()}</div>}
        </div>
      </header>
      <div className="p-4 grid grid-cols-12 gap-4 w-full">
        <div className="col-span-12 lg:col-span-3 space-y-4">
          <div className="card p-6 text-center">
            {(displayProfile?.photo_url||loggedProfile?.photo_url)? <img src={displayProfile?.photo_url||loggedProfile?.photo_url} title="Click to edit profile" onClick={onGoProfile} className="w-[110px] h-[110px] rounded-[8px] mx-auto object-cover border cursor-pointer hover:opacity-80 transition-opacity" alt="" /> : <div title="Click to edit profile" onClick={onGoProfile} className="w-[110px] h-[110px] rounded-[8px] mx-auto bg-[#c9ad83] text-white flex items-center justify-center text-[36px] font-extrabold border cursor-pointer hover:opacity-80 transition-opacity">{((displayProfile?.display_name||loggedProfile?.display_name||'?')[0]||'?').toUpperCase()}</div>}
            <h2 className="font-extrabold text-[18px] mt-3">{displayProfile?.display_name||loggedProfile?.display_name||'Loading...'}</h2>
            <div className="relative inline-block mt-2">
              <img src={mangoBasket} alt="Mango basket" className="w-[90px] h-[90px] object-contain mx-auto" />
              <span className="absolute -top-1 -right-1 bg-[#c9ad83] text-white text-[13px] font-extrabold w-7 h-7 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                {mangoCount}
              </span>
            </div>
            <p className="text-[9px] text-gray-400 mt-1 font-bold tracking-widest">MANGOS IN BASKET</p>
            {canShowShare && (
              <div className="flex gap-2 mt-4">
                <button onClick={handleShareCurrent} disabled={sharing} className="w-full py-2.5 bg-[#f8f5f0] border border-[#e9e2d6] text-[#5a4a32] rounded-[10px] font-bold text-[12px] hover:bg-black hover:text-white hover:border-black transition-colors">{sharing?'Sharing...':'Share'}</button>
              </div>
            )}
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
          <div className="bg-[#fffefb] border border-[#e9e2d6] rounded-b-[10px] rounded-t-none p-0 w-full overflow-x-auto overflow-y-visible">
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
                      {/* FIXED: exact 64px wrappers + 16px gap = 80 pitch, drop exactly centre */}
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
              ) : treeDepth===1? (
                <div className="relative" style={{width:'1200px',height:'520px',minWidth:'1200px', overflow:'visible'}}>
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
                <div style={{width:'1200px',minWidth:'1200px',minHeight:'540px',padding:'20px'}}>
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