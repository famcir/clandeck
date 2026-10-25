import React, { useState, useEffect } from 'react';
import CommonHeader from './CommonHeader.jsx';
import ChatSystem from './ChatSystem.jsx';
import mangoBasket from '../assets/mango-basket.png';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export default function Deck({ onGoProfile, onLogout }) {
  const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
  const [family, setFamily] = useState([]);
  const [groups, setGroups] = useState([]);
  const [privacy, setPrivacy] = useState({});
  const [showChat, setShowChat] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(localStorage.getItem('photo_url') || '');
  const [pos, setPos] = useState(JSON.parse(localStorage.getItem('clandeck_photo_pos') || '{"x":50,"y":50,"zoom":100}'));
  const [profileInfo, setProfileInfo] = useState({
    nickname: localStorage.getItem('profile_nickname') || '',
    visibility: localStorage.getItem('profile_visibility') || 'public'
  });

  useEffect(() => {
    const safeParse = (key) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(p => p && !p.photo_url?.startsWith('blob:') && !p.photo?.startsWith('blob:'));
      } catch { return []; }
    };
    
    setGroups(safeParse('clandeck_groups'));
    try { 
      const p = JSON.parse(localStorage.getItem('clandeck_privacy') || '{}');
      setPrivacy(p);
      // If visibility is private, override
      const vis = localStorage.getItem('profile_visibility') || 'public';
      if (vis === 'private') setPrivacy(prev => ({...prev, showName: false}));
    } catch { setPrivacy({}); }

    setPhotoUrl(localStorage.getItem('photo_url') || '');
    try { setPos(JSON.parse(localStorage.getItem('clandeck_photo_pos') || '{"x":50,"y":50,"zoom":100}')); } catch { setPos({x:50,y:50,zoom:100}); }

    setProfileInfo({
      nickname: localStorage.getItem('profile_nickname') || '',
      visibility: localStorage.getItem('profile_visibility') || 'public'
    });

    const userId = storedUser?.id || storedUser?.uname || 'self';
    fetch(`${API_URL}/api/family?user_id=${userId}`)
      .then(r => r.json())
      .then(j => {
        if (j?.success && j?.data?.length) {
          const clean = j.data.filter(p => p && !p.photo_url?.startsWith('blob:') && !p.photo_url?.startsWith('data:'));
          console.log('Loaded from MySQL profiles:', clean.length);
          setFamily(clean);
          localStorage.setItem('clandeck_family', JSON.stringify(clean));
        } else {
          setFamily(safeParse('clandeck_family'));
        }
      })
      .catch(() => setFamily(safeParse('clandeck_family')));

    fetch(`${API_URL}/api/profile/${userId}`)
      .then(r => r.json())
      .then(j => {
        if (j?.data?.photo_url && !j.data.photo_url.startsWith('blob:')) {
          setPhotoUrl(j.data.photo_url);
          localStorage.setItem('photo_url', j.data.photo_url);
        }
        if (j?.data?.photo_pos) {
          try {
            const savedPos = typeof j.data.photo_pos === 'string' ? JSON.parse(j.data.photo_pos) : j.data.photo_pos;
            setPos(savedPos);
            localStorage.setItem('clandeck_photo_pos', JSON.stringify(savedPos));
          } catch {}
        }
        if (j?.data) {
          if (j.data.nickname) {
            localStorage.setItem('profile_nickname', j.data.nickname);
            setProfileInfo(prev => ({...prev, nickname: j.data.nickname}));
          }
          if (j.data.visibility) {
            localStorage.setItem('profile_visibility', j.data.visibility);
            setProfileInfo(prev => ({...prev, visibility: j.data.visibility}));
            if (j.data.visibility === 'private') setPrivacy(prev => ({...prev, showName: false}));
          }
        }
      })
      .catch(() => {});
  }, []);

  const visibleFamily = (family || []).filter(f => {
    if (!f) return false;
    if (f.photo_url?.startsWith('blob:') || f.photo?.startsWith('blob:')) return false;
    if (f.id === storedUser?.id) return false;
    if (f.id === storedUser?.uname) return false;
    if ((f.display_name || f.name || '').trim().toLowerCase() === (storedUser?.name || '').trim().toLowerCase()) return false;
    const v = f.show_in_deck ?? f.visible ?? 1;
    return v !== false && v !== 0 && v !== '0' && v !== null;
  });

  const getName = () => storedUser?.name || localStorage.getItem('profile_name') || storedUser?.display_name || 'User';
  const isPublic = profileInfo.visibility === 'public' && privacy.showName !== false;

  return (
    <div style={{minHeight:'100vh', background:'#f7f4ef', width:'100vw'}}>
      <style>{`
        .deck-grid { display: grid; grid-template-columns: 300px 1fr 300px; gap: 16px; width: 100%; padding: 16px 20px; box-sizing: border-box; }
        .card { background: #fffefb; border: 1px solid #e9e2d6; border-radius: 14px; padding: 18px; }
        @media(max-width: 1100px){ .deck-grid { grid-template-columns: 300px 1fr; } }
        @media(max-width: 700px){ .deck-grid { grid-template-columns: 1fr; padding: 12px; } }
      `}</style>

      <CommonHeader self={storedUser} page="deck" onDeck={()=>{}} onProfile={onGoProfile} onLogout={onLogout} />

      <div className="deck-grid">
        <div>
          <div className="card" style={{textAlign:'center'}}>
            <div style={{width:'144px', height:'144px', background:'#c9ad83', color:'white', borderRadius:'18px', margin:'0 auto', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'52px', fontWeight:800, overflow:'hidden'}}>
              {photoUrl ? <img src={photoUrl} alt="profile" style={{width:'100%', height:'100%', objectFit:'cover', objectPosition: `${pos.x}% ${pos.y}%`, transform: `scale(${pos.zoom/100})`}} onError={()=>setPhotoUrl('')} /> : getName()[0]?.toUpperCase()}
            </div>
            <h2 style={{fontWeight:800, fontSize:'16px', marginTop:'12px'}}>
              {isPublic ? getName() : 'Hidden'}
              {isPublic && profileInfo.nickname && <span style={{fontWeight:400, fontSize:'12px', color:'#888'}}> ({profileInfo.nickname})</span>}
            </h2>
            {privacy.showUsername!==false && <p style={{fontSize:'11px', color:'#888', fontWeight:700}}>@{storedUser?.uname || 'user'}{isPublic && profileInfo.nickname ? ` • ${profileInfo.nickname}` : ''}</p>}

            <div style={{marginTop:'14px', textAlign:'left', background:'#faf7f2', borderRadius:'10px', padding:'10px', border:'1px solid #f0e9dc', fontSize:'11px'}}>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:'6px'}}><span style={{color:'#888', fontWeight:700}}>USER ID</span><span style={{fontWeight:700, fontSize:'10px'}}>{(storedUser?.id || 'self').slice(0,22)}</span></div>
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:'6px'}}><span style={{color:'#888', fontWeight:700}}>NAME</span><span style={{fontWeight:700}}>{isPublic ? getName() : 'Hidden'}</span></div>
              {profileInfo.nickname && <div style={{display:'flex', justifyContent:'space-between', marginBottom:'6px'}}><span style={{color:'#888', fontWeight:700}}>NICK NAME</span><span style={{fontWeight:700}}>{isPublic ? profileInfo.nickname : 'Hidden'}</span></div>}
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:'6px'}}><span style={{color:'#888', fontWeight:700}}>VISIBILITY</span><span style={{fontWeight:700, color: profileInfo.visibility==='public' ? 'green' : 'red'}}>{profileInfo.visibility?.toUpperCase()}</span></div>
            </div>

            {privacy.showMangoes!==false && (
              <>
                <div style={{marginTop:'14px'}}><img src={mangoBasket} alt="basket" style={{width:'54px', height:'54px', margin:'0 auto', display:'block'}} /></div>
                <p style={{fontSize:'8px', letterSpacing:'2px', color:'#aaa', fontWeight:800, marginTop:'4px'}}>MANGOS IN BASKET</p>
              </>
            )}
          </div>
        </div>

        <div>
          {privacy.showFamilyTree!==false ? (
            <div style={{background:'white', border:'1px solid #e9e2d6', borderRadius:'14px', overflow:'hidden', minHeight:'540px'}}>
              <div style={{background:'#efe8d3', borderBottom:'1px solid #e9e2d6', padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <span style={{fontWeight:800, fontSize:'13px'}}>{isPublic ? getName().split(' ')[0] : 'Hidden'}'s Family Tree {isPublic && profileInfo.nickname ? `(${profileInfo.nickname})` : ''}</span>
                <span style={{fontSize:'10px', background:'white', padding:'4px 10px', borderRadius:'20px', fontWeight:700, border:'1px solid #e9e2d6'}}>{visibleFamily.length + 1} Members • {profileInfo.visibility}</span>
              </div>
              <div style={{padding:'20px', display:'flex', flexWrap:'wrap', gap:'16px', justifyContent:'center'}}>
                <div style={{textAlign:'center'}}>
                  <div style={{width:'64px', height:'64px', background:'#c9ad83', color:'white', borderRadius:'10px', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, overflow:'hidden'}}>
                    {photoUrl ? <img src={photoUrl} alt="self" style={{width:'100%', height:'100%', objectFit:'cover', objectPosition: `${pos.x}% ${pos.y}%`, transform: `scale(${pos.zoom/100})`}} /> : getName()[0]}
                  </div>
                  <p style={{fontSize:'11px', fontWeight:700, marginTop:'6px'}}>{isPublic ? getName() : 'Hidden'}<br/><span style={{fontWeight:400, color:'#888'}}>Self{isPublic && profileInfo.nickname ? ` • ${profileInfo.nickname}` : ''}</span></p>
                </div>
                {visibleFamily.map(m=>{
                  if(!m) return null;
                  const name = m.display_name || m.name || 'Unknown';
                  const rel = m.category || m.relation || 'Family';
                  const photo = m.photo_url && !m.photo_url.startsWith('blob:') ? m.photo_url : (m.photo_compressed_url && !m.photo_compressed_url.startsWith('blob:') ? m.photo_compressed_url : '');
                  return (
                    <div key={m.id} style={{textAlign:'center', width:'72px'}}>
                      {photo ? <img src={photo} alt={name} style={{width:'64px', height:'64px', borderRadius:'10px', objectFit:'cover', border:'1px solid #e9e2d6'}} onError={e=>e.target.style.display='none'} /> :
                      <div style={{width:'64px', height:'64px', background:'#e9d8b6', color:'#5a4a32', borderRadius:'10px', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800}}>{name[0]?.toUpperCase()}</div>}
                      <p style={{fontSize:'11px', fontWeight:700, marginTop:'6px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{name}<br/><span style={{fontWeight:400, color:'#888'}}>{rel}</span></p>
                      <p style={{fontSize:'8px', color:'#aaa', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{m.id}/profileimg</p>
                    </div>
                  );
                })}
                {visibleFamily.length===0 && <p style={{fontSize:'12px', color:'#aaa', marginTop:'40px', textAlign:'center', width:'100%'}}>No family members set to visible.<br/>Go to Profile Edit → Add Member (saves to clandeck_bucket/id/profileimg)</p>}
              </div>
            </div>
          ) : <div className="card" style={{textAlign:'center', padding:'40px'}}><p style={{color:'#aaa', fontSize:'13px'}}>Family Tree is hidden</p></div>}
        </div>

        <div>
          <div className="card">
            <h3 style={{fontWeight:800, fontSize:'12px', marginBottom:'10px'}}>My Groups ({groups.length})</h3>
            {groups.length===0 ? <p style={{fontSize:'11px', color:'#aaa'}}>No groups yet. Create in Profile Edit.</p> : groups.map(g=>(
              g && <div key={g.id} style={{padding:'8px', border:'1px solid #f0e0c0', borderRadius:'8px', marginBottom:'6px', fontSize:'12px'}}><strong>{g.name}</strong><br/><span style={{color:'#888'}}>{g.members?.length || 0} members</span></div>
            ))}
          </div>
        </div>
      </div>

      <button onClick={()=>setShowChat(true)} style={{position:'fixed', bottom:'18px', right:'18px', width:'50px', height:'50px', background:'black', color:'white', borderRadius:'50%', border:'none', cursor:'pointer', zIndex:9999}}>💬</button>
      {showChat && <ChatSystem self={storedUser} allProfiles={family} groups={groups} onClose={()=>setShowChat(false)} />}
    </div>
  );
}