import { useState } from 'react';
import { HashRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import Login from './pages/Login.jsx';
import AdminDB from './pages/AdminDB.jsx';

// If you have Deck and Construction pages, import them
// import Deck from './pages/Deck.jsx';
// import Construction from './pages/Construction.jsx';

// Temporary placeholders if you don't have those files yet
const Deck = () => {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  return (
    <div style={{padding:40, fontFamily:'sans-serif'}}>
      <h1>Welcome to Deck, {user.name || user.uname}! 🎉</h1>
      <p>User: {JSON.stringify(user)}</p>
      <button onClick={() => { localStorage.clear(); window.location.hash = '#/'; window.location.reload(); }}>Logout</button>
    </div>
  );
};
const Construction = () => <div style={{padding:40}}><h1>Construction Page</h1><a href="#/">Back to Login</a></div>;

// Wrapper to handle Login callbacks
function LoginWrapper() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    navigate('/deck'); // Directly load Deck.jsx - no popup
  };

  const handleGoAdmin = () => {
    navigate('/admin');
  };

  const handleGoConstruction = () => {
    navigate('/construction');
  };

  return (
    <Login 
      onLoginSuccess={handleLoginSuccess}
      onGoAdmin={handleGoAdmin}
      onGoConstruction={handleGoConstruction}
    />
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LoginWrapper />} />
        <Route path="/admin" element={<AdminDB />} />
        <Route path="/admindb" element={<AdminDB />} />
        <Route path="/deck" element={<Deck />} />
        <Route path="/construction" element={<Construction />} />
      </Routes>
    </Router>
  );
}