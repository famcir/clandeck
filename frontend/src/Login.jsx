import { useState } from 'react';
import logo from '../assets/clandeck-logo.png';
import './Login.css';

const API_BASE = 
  import.meta.env.VITE_API_URL || 
  import.meta.env.VITE_API_BASE || 
  'https://clandeck-production.up.railway.app';

export default function Login({ onLoginSuccess, onGoAdmin, onGoConstruction }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loginErr, setLoginErr] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const handleDeckLogin = async (e) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginErr("");
    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.msg || 'Login failed');

      localStorage.setItem('userId', data.user.id);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('uname', data.user.uname);
      
      // DIRECTLY LOAD DECK.jsx - NO POPUP
      onLoginSuccess(data.user);

    } catch (err) {
      setLoginErr(err.message);
      setLoginLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      {/* FULL PAGE LOADER WHEN LOGGING IN */}
      {loginLoading && (
        <div className="welcome-overlay">
          <div className="welcome-card">
            <div className="loader"></div>
            <h2 style={{marginTop:'16px'}}>Loading your Deck...</h2>
            <p>Please wait</p>
          </div>
        </div>
      )}

      <div className="brand-section">
        <div className="brand-content">
          <img src={logo} alt="ClanDeck" className="main-logo" />
          <p className="brand-subtitle">Manage your entire family in one beautiful deck.</p>
        </div>
      </div>

      <div className="form-section">
        <div className="form-container">
          <h2 className="form-title">Your Clan, In One Deck</h2>
          <p className="form-desc">Welcome back — sign in to continue</p>
          
          {loginErr && <div className="error-box">{loginErr}</div>}

          <form onSubmit={handleDeckLogin}>
            <div className="form-group">
              <label>USERNAME</label>
              <input type="text" placeholder="e.g. UNTeju" value={username} onChange={(e)=>setUsername(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>PASSWORD</label>
              <div className="password-wrapper">
                <input type={showPass?"text":"password"} placeholder="••••••••" value={password} onChange={(e)=>setPassword(e.target.value)} required />
                <span className="toggle-eye" onClick={()=>setShowPass(!showPass)}>{showPass?"🙈":"👁️"}</span>
              </div>
            </div>
            <button type="submit" className="login-btn black-btn" disabled={loginLoading}>
              {loginLoading ? "Loading Deck..." : "Log in"}
            </button>
            <button type="button" className="login-btn blue-btn" onClick={onGoAdmin}>Open Admin DB View</button>
          </form>
          <p className="back-link" onClick={onGoConstruction}>← Back to Construction</p>
        </div>
      </div>
    </div>
  );
}