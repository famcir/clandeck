import React, { useState } from 'react';
import './App.css';
import logo from './assets/clandeck-logo.png';
import Profile from './Profile'; // Import Profile

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
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const res = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: username.trim(), password })
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error("Backend is not running. Run 'node server.js'"); }

      if (!res.ok) throw new Error(data.error || "Login failed");

      const name = data.name || data.user?.name || data.fullName || data.displayName || username.split('@')[0];
      const id = data.id || data.userId || data.email;

      setUserName(name);
      setUserId(id);
      localStorage.setItem('userName', name);
      localStorage.setItem('userId', id);
      localStorage.setItem('token', data.token);

      setShowPopup(true);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePopupOk = () => {
    setShowPopup(false);
    setPage("profile");
  };

  // IF PROFILE PAGE, LOAD Profile.jsx
  if (page === "profile") {
    return <Profile userName={userName} onLogout={() => setPage("login")} />;
  }

  // LOGIN PAGE
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