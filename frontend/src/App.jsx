import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import Login from './Login.jsx';
import AdminDB from './AdminDB.jsx';
import Deck from './Deck.jsx';
import ProfileEdit from './ProfileEdit.jsx';

function ProtectedAdminRoute({ children }) {
  const userStr = localStorage.getItem('user');
  if (!userStr) return <Navigate to="/login" replace />;
  try {
    const user = JSON.parse(userStr);
    const isAdmin = user.name === "Admin" || user.Name === "Admin" || user.uname === "Admin";
    if (isAdmin) return children;
    else return <Navigate to="/deck" replace />;
  } catch {
    return <Navigate to="/login" replace />;
  }
}

function ProtectedRoute({ children }) {
  const userStr = localStorage.getItem('user');
  if (!userStr) return <Navigate to="/login" replace />;
  return children;
}

function DeckWrapper() {
  const navigate = useNavigate();
  return (
    <Deck 
      onGoProfile={() => navigate('/profile-edit')}
      onGoDeck={() => navigate('/deck')}
      onLogout={() => { localStorage.clear(); navigate('/login'); }}
    />
  );
}

function ProfileEditWrapper() {
  const navigate = useNavigate();
  return (
    <ProfileEdit 
      onGoDeck={() => navigate('/deck')}
      onGoProfile={() => navigate('/profile-edit')}
      onLogout={() => { localStorage.clear(); navigate('/login'); }}
    />
  );
}

function LoginWrapper() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const handleLoginSuccess = (userData) => {
    setUser(userData);
    const isAdmin = userData.name === "Admin" || userData.Name === "Admin" || userData.uname === "Admin";
    if (isAdmin) navigate('/admin');
    else navigate('/deck');
  };
  const handleGoConstruction = () => navigate('/construction');
  return <Login onLoginSuccess={handleLoginSuccess} onGoConstruction={handleGoConstruction} />;
}

const Construction = () => {
  const navigate = useNavigate();
  return (
    <div style={{padding:40, fontFamily:'sans-serif'}}>
      <h1>Construction Page</h1>
      <button onClick={()=>navigate('/login')} style={{color:'blue', cursor:'pointer', background:'none', border:'none'}}>← Back to Login</button>
    </div>
  );
};

export default function App() {
  return (
    <Router>
      <Routes>
        {/* LOGIN - both / and /login work */}
        <Route path="/" element={<LoginWrapper />} />
        <Route path="/login" element={<LoginWrapper />} />
        
        <Route path="/admin" element={<ProtectedAdminRoute><AdminDB /></ProtectedAdminRoute>} />
        <Route path="/admindb" element={<ProtectedAdminRoute><AdminDB /></ProtectedAdminRoute>} />
        
        <Route path="/deck" element={<ProtectedRoute><DeckWrapper /></ProtectedRoute>} />
        <Route path="/profile-edit" element={<ProtectedRoute><ProfileEditWrapper /></ProtectedRoute>} />
        <Route path="/profile" element={<Navigate to="/profile-edit" replace />} />
        
        <Route path="/construction" element={<Construction />} />
      </Routes>
    </Router>
  );
}