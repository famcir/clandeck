import { useState } from 'react';
import { HashRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import Login from './Login.jsx';
import AdminDB from './AdminDB.jsx';
import Deck from './Deck.jsx';

// Wrapper to handle Login callbacks
function LoginWrapper() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    navigate('/deck');
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

const Construction = () => (
  <div style={{padding:40, fontFamily:'sans-serif'}}>
    <h1>Construction Page</h1>
    <a href="#/">← Back to Login</a>
  </div>
);

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