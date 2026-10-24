import { useState } from 'react';
import logo from '../assets/clandeck-logo.png';

// FIXED: api.clandeck.com is now LIVE with db:connected, use it first!
const API_BASE = 
  import.meta.env.VITE_API_URL || 
  import.meta.env.VITE_API_BASE || 
  'https://api.clandeck.com' ||
  'https://clandeck-production.up.railway.app';

export default function Login({ onLoginSuccess, onGoAdmin, onGoConstruction }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loginErr, setLoginErr] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeName, setWelcomeName] = useState("");

  const handleDeckLogin = async (e) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginErr("");
    try {
      // Try /api/login first, then fallback to /api/auth/login if needed
      let res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      
      // If 404, try alternate endpoint
      if (res.status === 404) {
        res = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.trim(), password })
        });
      }

      const data = await res.json();
      
      if (!res.ok || (!data.success && !data.user)) {
        throw new Error(data.msg || data.message || 'Login failed - check 001 / 1234');
      }

      // Handle both response formats: {user} or {data.user}
      const user = data.user || data;
      
      localStorage.setItem('userId', user.id);
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('uname', user.uname || user.username);
      if (data.token) localStorage.setItem('token', data.token);
      
      // SHOW WELCOME BOX - same style you had!
      const displayName = user.name || user.uname || user.username || username;
      setWelcomeName(displayName);
      setShowWelcome(true);

      // Wait 2.5 sec then go to deck.jsx
      setTimeout(() => {
        setShowWelcome(false);
        onLoginSuccess(user);
      }, 2500);

    } catch (err) {
      console.error('Login error:', err);
      setLoginErr(err.message || 'Cannot connect to api.clandeck.com - Check Railway logs');
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      {showWelcome && (
        <div style={{
          position:'fixed', inset:0, zIndex:9999, display:'flex', 
          alignItems:'center', justifyContent:'center', 
          background:'rgba(0,0,0,0.55)', backdropFilter:'blur(6px)'
        }}>
          <div style={{
            background:'white', borderRadius:'24px', padding:'32px 28px', 
            boxShadow:'0 20px 60px rgba(0,0,0,0.2)', textAlign:'center', 
            maxWidth:'360px', width:'90%', animation:'popIn 0.4s ease'
          }}>
            <div style={{
              width:'64px', height:'64px', margin:'0 auto 16px', 
              background:'#F5F0E6', borderRadius:'50%', 
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:'28px'
            }}>👋</div>
            <h2 style={{fontSize:'22px', fontWeight:800, marginBottom:'8px'}}>Welcome, {welcomeName}!</h2>
            <p style={{fontSize:'15px', color:'#333', fontWeight:500}}>Welcome '{welcomeName}' to ClanDeck</p>
            <p style={{fontSize:'12px', color:'#16a34a', marginTop:'8px', fontWeight:600}}>✓ MySQL Connected</p>
            <div style={{marginTop:'20px', height:'4px', width:'100%', background:'#f3f4f6', borderRadius:'999px', overflow:'hidden'}}>
              <div style={{height:'100%', background:'black', width:'100%', animation:'progress 2.5s linear'}}></div>
            </div>
          </div>
          <style>{`
            @keyframes popIn { from { transform: scale(0.9); opacity:0 } to { transform: scale(1); opacity:1 } }
            @keyframes progress { from { width:0% } to { width:100% } }
          `}</style>
        </div>
      )}

      <div className="brand-section">
        <div className="brand-content">
          <img src={logo} alt="ClanDeck" className="main-logo login-logo" />
          <p className="brand-subtitle">Manage your entire family in one beautiful deck.</p>
        </div>
      </div>
      <div className="form-section">
        <div className="form-container">
          <h2 className="form-title">Your Clan, In One Deck</h2>
          <p className="form-desc">Welcome back — sign in to continue</p>
          {loginErr && <div style={{background:'#fef2f2', color:'#dc2626', padding:'10px', borderRadius:'8px', marginBottom:'16px', fontSize:'13px', border:'1px solid #fecaca'}}>{loginErr}</div>}
          <form onSubmit={handleDeckLogin}>
            <div className="form-group"><label>Username</label><input type="text" placeholder="e.g. UNTeju" value={username} onChange={(e)=>setUsername(e.target.value)} required /></div>
            <div className="form-group"><label>Password</label><div className="password-wrapper"><input type={showPass?"text":"password"} placeholder="••••••••" value={password} onChange={(e)=>setPassword(e.target.value)} required /><span className="toggle-eye" onClick={()=>setShowPass(!showPass)}>{showPass?"🙈":"👁️"}</span></div></div>
            <button type="submit" className="login-btn" disabled={loginLoading}>{loginLoading ? "Checking MySQL..." : "Log in"}</button>
            <button type="button" className="login-btn" style={{marginTop:10, background:'#2563eb'}} onClick={onGoAdmin}>Open Admin DB View</button>
          </form>
          <p style={{textAlign:'center', marginTop:'16px', fontSize:'13px', color:'#6b7280', cursor:'pointer'}} onClick={onGoConstruction}>← Back to Construction</p>
          <p style={{textAlign:'center', marginTop:'8px', fontSize:'10px', color:'#9ca3af'}}>API: {API_BASE} • DB: connected</p>
        </div>
      </div>
    </div>
  );
}