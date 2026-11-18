import React, { useState, useEffect, useRef } from 'react';
import clandeckLogo from './assets/clandeck_h.png';

const API_URL = import.meta.env.VITE_API_URL || 'https://api.clandeck.com';

export default function CommonHeader({ self, onDeck, onProfile, onLogout, onSearch, onNotifications, page }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);
  useEffect(() => { if (searchOpen && searchRef.current) searchRef.current.focus(); }, [searchOpen]);
  let user = self;
  if (!user) { try { user = JSON.parse(localStorage.getItem('user') || '{}'); } catch { user = {}; } }   // a broken saved value must not crash the page
  const initial = (user?.name || user?.display_name || 'S')[0]?.toUpperCase();
  let savedPhoto = '';
  try { const ph = localStorage.getItem('photo_url') || ''; savedPhoto = ph.startsWith('blob:') ? '' : ph; } catch { /* ignore */ }
  const [photoOk, setPhotoOk] = useState(true);

  // 🔔 number of requests / notices waiting for this person (checked on load, every minute, and when the tab is shown again)
  const [unread, setUnread] = useState(0);
  const meId = (user && (user.id || user.uname)) || '';
  useEffect(() => {
    if (!meId) return undefined;
    let dead = false;
    const check = async () => {
      try {
        const j = await (await fetch(`${API_URL}/api/notifications?home_id=${encodeURIComponent(meId)}`)).json();
        if (!dead && j && j.success) setUnread(j.data.length);
      } catch { /* offline: try again later */ }
    };
    check();
    const t = setInterval(check, 60000);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { dead = true; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [meId]);
  const goToNotifications = () => {
    setOpen(false);
    if (onNotifications) return onNotifications();
    window.location.href = '/notifications';
  };

  // FIXED NAVIGATION - always works even if props missing
  const goToDeck = () => {
    setOpen(false);
    if (onDeck) return onDeck();
    window.location.hash = '#/deck';
  };

  const goToProfileEdit = () => {
    setOpen(false);
    if (onProfile) return onProfile();
    window.location.hash = '#/profile-edit';
  };

  const handleLogout = () => {
    setOpen(false);
    // wipe everything cached for this person, so the next login on this computer never sees their photo / name / family
    ['user', 'token', 'photo_url', 'clandeck_photo_pos', 'profile_nickname', 'profile_visibility', 'profile_name',
     'clandeck_family', 'clandeck_groups', 'clandeck_privacy', 'admin_key'].forEach((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
    if (onLogout) return onLogout();
    // Fallback logout
    window.location.hash = '#/login';
    window.location.reload();
  };

  const navBtn = (label, active, action) => (
    <button 
      onClick={action}
      style={{
        padding:'7px 18px', 
        borderRadius:'8px', 
        border:'1px solid #d8c5a3', 
        cursor:'pointer',
        fontWeight: 800, 
        fontSize:'12px',
        background: active ? '#1a1a1a' : '#c9ad83',
        color: 'white',
        transition:'all 0.2s',
        boxShadow: active ? '0 2px 6px rgba(0,0,0,0.15)' : 'none',
      }}
    >
      {label}
    </button>
  );

  // Normalize page names
  const isDeck = page==='deck' || page==='your-deck';
  const isProfile = page==='profile' || page==='profile-edit' || page==='edit';

  return (
    <header style={{width:'100%', background:'white', borderBottom:'1px solid #e9e2d6', position:'sticky', top:0, zIndex:100}}>
      <style>{`
        .header-inner { width:100%; padding: 0 20px; height: 62px; display:flex; align-items:center; justify-content:space-between; box-sizing:border-box; gap:12px; }
        .left-area { display:flex; align-items:center; gap:16px; flex-shrink:0; }
        .center-area { display:flex; align-items:center; flex:1; max-width:520px; min-width:120px; }
        .nav-desktop { display:flex; gap:8px; align-items:center; }
        .search-wrap { flex:1; position:relative; display:flex; align-items:center; }
        .search-input { width:100%; padding:8px 14px 8px 36px; border-radius:20px; border:1px solid #e9e2d6; background:#faf7f2; font-size:12px; outline:none; box-sizing:border-box; transition: all 0.3s; }
        .search-icon-btn { display:none; width:36px; height:36px; border-radius:50%; border:1px solid #e9e2d6; background:#faf7f2; cursor:pointer; align-items:center; justify-content:center; font-size:16px; }
        .logo-img { height: 28px; width: auto; object-fit: contain; cursor: pointer; }
        .hamburger { display:none; font-size:20px; background:none; border:none; cursor:pointer; }
        @media(max-width: 1100px){ .center-area { max-width: 320px; } }
        @media(max-width: 900px){ .center-area { max-width: 200px; } .search-input::placeholder { font-size:11px; } }
        @media(max-width: 650px){
          .header-inner { padding: 6px 12px 8px; height: auto; min-height: 52px; flex-wrap: wrap; row-gap: 8px; }
          .left-area { display: contents; }
          .center-area { max-width:none; flex:0 0 auto; margin-left:auto; min-width:0; }
          /* Your Deck / Profile Edit stay visible as a second row, no menu to open */
          .nav-desktop { order: 10; flex: 1 1 100%; display:flex; gap:8px; }
          .nav-desktop button { flex:1; padding:7px 8px !important; }
          .hamburger { display:none !important; }
          .logo-img { height: 22px; }
          /* search icon opens a bar that is exactly centred on the screen */
          .search-wrap { ${searchOpen ? 'position:fixed; left:4vw; right:4vw; top:56px; z-index:200;' : ''} }
          .search-wrap .search-input { display: ${searchOpen ? 'block' : 'none'}; width:100%; box-shadow: 0 4px 20px rgba(0,0,0,0.15); background: white; padding: 12px 14px 12px 36px; font-size:14px; }
          .search-wrap .search-icon-abs { display: ${searchOpen ? 'block' : 'none'}; }
          .search-icon-btn { display:${searchOpen ? 'none' : 'flex'}; }
        }
      `}</style>

      <div className="header-inner">
        <div className="left-area">
          {/* LOGO ALWAYS GOES TO DECK */}
          <img src={clandeckLogo} alt="ClanDeck" className="logo-img" onClick={goToDeck} title="Go to Your Deck" />
          <div className="nav-desktop">
            {navBtn('Your Deck', isDeck, goToDeck)}
            {navBtn('Profile Edit', isProfile, goToProfileEdit)}
          </div>
        </div>

        <div className="center-area">
          <div className="search-wrap">
            <span className="search-icon-abs" style={{position:'absolute', left:'12px', top:'50%', transform:'translateY(-50%)', fontSize:'13px', color:'#a09078', pointerEvents:'none'}}>🔍</span>
            <input 
              ref={searchRef}
              className="search-input"
              type="text" 
              placeholder="Find your FamilyMember, Friends, Your Clan"
              aria-label="Search" 
              value={query}
              onChange={(e)=>{ setQuery(e.target.value); onSearch && onSearch(e.target.value); }}
            />
            <button className="search-icon-btn" aria-label="Search" onClick={()=>setSearchOpen(!searchOpen)}>🔍</button>
          </div>
        </div>

        <div style={{display:'flex', alignItems:'center', gap:'8px', flexShrink:0}}>
          <button onClick={goToNotifications} title={unread ? `${unread} waiting` : 'Notifications'} aria-label={unread ? `Notifications, ${unread} waiting` : 'Notifications'}
            style={{position:'relative', width:'32px', height:'32px', background: page==='notifications' ? '#1a1a1a' : '#f8f5f0', border:'1px solid #e9e2d6', borderRadius:'8px', cursor:'pointer', fontSize:'15px', padding:0, display:'flex', alignItems:'center', justifyContent:'center'}}>
            🔔
            {unread > 0 && <span style={{position:'absolute', top:'-6px', right:'-6px', minWidth:'16px', height:'16px', padding:'0 4px', boxSizing:'border-box', borderRadius:'8px', background:'#d33', color:'white', fontSize:'10px', fontWeight:700, lineHeight:'16px', textAlign:'center'}}>{unread > 99 ? '99+' : unread}</span>}
          </button>
          <div title={user?.name || ''} style={{width:'32px', height:'32px', background:'#f8f5f0', border:'1px solid #e9e2d6', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:'12px', overflow:'hidden'}}>
            {savedPhoto && photoOk ? <img src={savedPhoto} alt="" onError={()=>setPhotoOk(false)} style={{width:'100%', height:'100%', objectFit:'cover'}} /> : initial}
          </div>
          <button onClick={handleLogout} style={{padding:'7px 12px', background:'#fff5f5', border:'1px solid #ffd1d1', borderRadius:'20px', fontSize:'11px', fontWeight:700, color:'#d33', cursor:'pointer'}}>Logout</button>
        </div>
      </div>

      {searchOpen && (
        <div style={{display:'none'}} className="mobile-search-overlay">
          <style>{`@media(max-width:650px){ .mobile-search-overlay{display:block !important;} }`}</style>
          <div onClick={()=>setSearchOpen(false)} style={{position:'fixed', top:'0', left:0, width:'100vw', height:'100vh', background:'rgba(0,0,0,0.2)', zIndex:99}}></div>
        </div>
      )}
    </header>
  );
}