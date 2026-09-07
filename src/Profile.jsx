import React from 'react';
import './App.css';
import logo from './assets/clandeck-logo.png';

export default function Profile({ userName, onLogout }) {
  return (
    <div className="profile-wrapper">
      <div className="profile-card">
        <img src={logo} alt="ClanDeck" className="small-logo" />
        <h2>Welcome to your Clan!</h2>
        <div className="id-box">
          <p>Hello 👋</p>
          <h3>{userName}</h3>
        </div>
        <button className="login-btn" onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
}