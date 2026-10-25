import React, { useState } from 'react';
import clandeckLogo from '../assets/clandeck_h.png';

export default function CommonHeader({ self, onDeck, onProfile, onLogout, onSearch, page }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const user = self || JSON.parse(localStorage.getItem('user') || '{}');
  const initial = (user?.name || user?.display_name || 'S')[0]?.toUpperCase();

  const navBtn = (label, active, action) => (
    <button onClick={() => { action && action(); setOpen(false); }} style={{
      padding:'7px 18px', borderRadius:'8px', border:'1px solid #d8c5a3', cursor:'pointer',
      fontWeight: active ? 800 : 700, fontSize:'12px',
      background: active ? '#1a1a1a' : '#c9ad83',
      color: active ? 'white' : 'white',
      transition:'all 0.2s',
      boxShadow: active ? '0 2px 6px rgba(0,0,0,0.15)' : 'none'
    }}>{label}</button>
  );

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
        
        @media(max-width: 1100px){
          .center-area { max-width: 320px; }
        }
        @media(max-width: 900px){
          .center-area { max-width: 200px; }
          .search-input::placeholder { font-size:11px; }
        }

        @media(max-width: 650px){
          .header-inner { padding: 0 12px; height: 56px; }
          .center-area { max-width:none; flex:0; margin-left:auto; }
          .search-wrap .search-input { display: ${searchOpen ? 'block' : 'none'}; position: absolute; right: 0; top: 50px; width: 92vw; max-width: 92vw; z-index: 200; box-shadow: 0 4px 20px rgba(0,0,0,0.1); background: white; padding: 12px 14px 12px 36px; }
          .search-wrap .search-icon-abs { display: ${searchOpen ? 'block' : 'none'}; position: absolute; right: 0; top: 50px; margin-top: 12px; left: 12px; z-index: 201; }
          .search-icon-btn { display:${searchOpen ? 'none' : 'flex'}; }
          .nav-desktop { display:${open ? 'flex' : 'none'}; position:absolute; top:56px; left:0; width:100%; background:white; flex-direction:column; padding:12px 16px 16px; border-bottom:1px solid #e9e2d6; gap:10px; align-items:stretch; box-sizing:border-box; }
          .hamburger { display:block; }
          .logo-img { height: 22px; }
        }
      `}</style>

      <div className="header-inner">
        <div className="left-area">
          <img src={clandeckLogo} alt="ClanDeck" className="logo-img" onClick={onDeck} />
          <div className="nav-desktop">
            {navBtn('Your Deck', page==='deck', onDeck)}
            {navBtn('Profile Edit', page==='profile' || page==='profile-edit' || page==='edit', onProfile)}
          </div>
        </div>

        <div className="center-area">
          <div className="search-wrap">
            <span className="search-icon-abs" style={{position:'absolute', left:'12px', top:'50%', transform:'translateY(-50%)', fontSize:'13px', color:'#a09078', pointerEvents:'none'}}>🔍</span>
            <input 
              className="search-input"
              type="text" 
              placeholder=" Find your FamilyMember, Friends, Your Clan " 
              value={query}
              onChange={(e)=>{ setQuery(e.target.value); onSearch && onSearch(e.target.value); }}
            />
            <button className="search-icon-btn" onClick={()=>setSearchOpen(!searchOpen)}>🔍</button>
          </div>
        </div>

        <div style={{display:'flex', alignItems:'center', gap:'8px', flexShrink:0}}>
          <div style={{width:'32px', height:'32px', background:'#f8f5f0', border:'1px solid #e9e2d6', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:'12px'}}>{initial}</div>
          <button onClick={onLogout} style={{padding:'7px 12px', background:'#fff5f5', border:'1px solid #ffd1d1', borderRadius:'20px', fontSize:'11px', fontWeight:700, color:'#d33', cursor:'pointer'}}>Logout</button>
          <button className="hamburger" onClick={()=>setOpen(!open)}>{open ? '✕' : '☰'}</button>
        </div>
      </div>

      {searchOpen && (
        <div style={{display:'none'}} className="mobile-search-overlay">
          <style>{`@media(max-width:650px){ .mobile-search-overlay{display:block !important;} }`}</style>
          <div onClick={()=>setSearchOpen(false)} style={{position:'fixed', top:'56px', left:0, width:'100vw', height:'100vh', background:'rgba(0,0,0,0.2)', zIndex:99}}></div>
        </div>
      )}
    </header>
  );
}