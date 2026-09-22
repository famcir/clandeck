import React, { useState } from 'react';
import './App.css';
import logo from './assets/clandeck-logo.png';
import Profile from './Profile.jsx';
import EditProfile from './editprofile.jsx';
import Deck from './Deck.jsx';

export default function App() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [showPopup, setShowPopup] = useState(false);
  const [userName, setUserName] = useState("");
  const [userId, setUserId] = useState("");
  const [page, setPage] = useState("login");

  // claim flow states
  const [showClaim, setShowClaim] = useState(false);
  const [claimStep, setClaimStep] = useState(1);
  const [newUname, setNewUname] = useState("");
  const [newPass, setNewPass] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);
  const [pendingUser, setPendingUser] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    if (!username.trim() ||!password.trim()) {
      setError("Please fill in all fields");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uname: username.trim(), password })
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text || `Server error ${res.status}. Check Railway logs.`);
      }

      if (!res.ok) throw new Error(data.error || data.message || "Login failed");

      // check id vs shared_profile_id
      if (data.shared_profile_id && data.id !== data.shared_profile_id) {
        setPendingUser(data);
        setNewUname(data.uname || username.trim());
        setShowClaim(true);
        setClaimStep(1);
        setLoading(false);
        return;
      }

      const name = data.name || data.user?.name || data.fullName || username;
      const id = data.id || data.userId || data.uname || data.email || data.user?._id;

      setUserName(name);
      setUserId(id);
      localStorage.setItem('userName', name);
      localStorage.setItem('userId', id);
      localStorage.setItem('token', data.token);

      setShowPopup(true);

    } catch (err) {
      console.error("Login Error:", err);
      if (err.message === "Failed to fetch") {
        setError("Cannot reach server. Backend is down or MONGO_URI missing in Railway. Check /api");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClaimSave = async () => {
    if (!newUname.trim() ||!newPass.trim()) {
      setError("Please fill username and password");
      return;
    }
    setClaimLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/claim-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: pendingUser.id, newUname: newUname.trim(), newPassword: newPass.trim() })
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(text); }
      if (!res.ok) throw new Error(data.error || "Claim failed");

      setUserName(pendingUser.name || newUname);
      setUserId(data.id);
      localStorage.setItem('userName', pendingUser.name || newUname);
      localStorage.setItem('userId', data.id);
      localStorage.setItem('token', "token-" + data.id);

      setShowClaim(false);
      setShowPopup(true);

    } catch (err) {
      setError(err.message);
    } finally {
      setClaimLoading(false);
    }
  };

  const handlePopupOk = () => {
    setShowPopup(false);
    setPage("deck");
  };

  if (page === "deck") {
    return <Deck onGoProfile={() => setPage("profile")} onLogout={() => setPage("login")} />;
  }

  if (page === "profile") {
    return <Profile userName={userName} onLogout={() => setPage("login")} onEdit={() => setPage("editprofile")} onBack={() => setPage("deck")} />;
  }
  if (page === "editprofile") {
    return <EditProfile onBack={() => setPage("profile")} />;
  }

  return (
    <div className="login-wrapper">
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
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Username</label>
              <input type="text" placeholder="e.g. UNTeju" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <div className="password-wrapper">
                <input type={showPass? "text" : "password"} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <span className="toggle-eye" onClick={() => setShowPass(!showPass)}>{showPass? "🙈" : "👁️"}</span>
              </div>
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button type="submit" className="login-btn" disabled={loading}>
              {loading? "Logging in..." : "Log in"}
            </button>
          </form>
        </div>
      </div>

      {showPopup && (
        <div className="popup-overlay">
          <div className="popup-box">
            <h3>Login Successful! ✅</h3>
            <p>successfully logged in:</p>
            <h2 className="popup-id">{userName}</h2>
            <button className="login-btn" onClick={handlePopupOk}>OK</button>
          </div>
        </div>
      )}

      {showClaim && (
        <div className="popup-overlay" style={{zIndex: 9999}}>
          <div className="popup-box" style={{maxWidth: '380px'}}>
            {claimStep===1? (
              <>
                <h3>Claim your account? 🔐</h3>
                <p style={{margin:'12px 0', fontSize:'13px'}}>This profile was shared with you. Do you want to claim it as your own?</p>
                {error && <p className="error-msg">{error}</p>}
                <div style={{display:'flex', gap:'10px', marginTop:'16px'}}>
                  <button className="login-btn" style={{flex:1, background:'#eee', color:'#000'}} onClick={()=>{setShowClaim(false); setPendingUser(null);}}>Later</button>
                  <button className="login-btn" style={{flex:1}} onClick={()=>{setClaimStep(2); setError("");}}>Yes</button>
                </div>
              </>
            ):(
              <>
                <h3>Change username & password 🔑</h3>
                <p style={{fontSize:'12px', color:'#666', marginBottom:'12px'}}>Set your new login credentials</p>
                <div className="form-group">
                  <label>New Username</label>
                  <input type="text" placeholder="Choose new username" value={newUname} onChange={e=>setNewUname(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>New Password</label>
                  <input type="text" placeholder="Choose new password" value={newPass} onChange={e=>setNewPass(e.target.value)} />
                </div>
                {error && <p className="error-msg">{error}</p>}
                <div style={{display:'flex', gap:'10px', marginTop:'16px'}}>
                  <button className="login-btn" style={{flex:1, background:'#eee', color:'#000'}} onClick={()=>setClaimStep(1)}>Back</button>
                  <button className="login-btn" style={{flex:1}} onClick={handleClaimSave} disabled={claimLoading}>{claimLoading? "Saving..." : "Save"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}