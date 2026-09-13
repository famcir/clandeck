import React, { useState } from 'react';
import './App.css';
import logo from './assets/clandeck-logo.png';
import Profile from './Profile.jsx';
import EditProfile from './editprofile.jsx';

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

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    if (!username.trim() ||!password.trim()) {
      setError("Please fill in all fields");
      return;
    }
    setLoading(true);
    try {
      // FINAL FIX: Always use relative URL. Works on laptop, mobile, localhost, Railway.
      const res = await fetch(`/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: username.trim(), password })
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text || `Server error ${res.status}. Check Railway logs.`);
      }

      if (!res.ok) throw new Error(data.error || data.message || "Login failed");

      const name = data.name || data.user?.name || data.fullName || username.split('@')[0];
      const id = data.id || data.userId || data.email || data.user?._id;

      setUserName(name);
      setUserId(id);
      localStorage.setItem('userName', name);
      localStorage.setItem('userId', id);
      localStorage.setItem('token', data.token);

      setShowPopup(true);

    } catch (err) {
      console.error("Login Error:", err);
      // Show real reason instead of generic "Failed to fetch"
      if (err.message === "Failed to fetch") {
        setError("Cannot reach server. Backend is down or MONGO_URI missing in Railway. Check /api");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePopupOk = () => {
    setShowPopup(false);
    setPage("profile");
  };

  if (page === "profile") {
    return <Profile userName={userName} onLogout={() => setPage("login")} onEdit={() => setPage("editprofile")} />;
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
              <label>Email</label>
              <input type="text" placeholder="you@example.com" value={username} onChange={(e) => setUsername(e.target.value)} required />
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
    </div>
  );
}