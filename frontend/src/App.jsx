import { useState } from 'react';
import { HashRouter as Router, Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import Login from './Login.jsx';
import AdminDB from './AdminDB.jsx';
import Deck from './Deck.jsx';

// Protect /admin - only Name="Admin" can open
function ProtectedAdminRoute({ children }) {
  const userStr = localStorage.getItem('user');
  if (!userStr) return <Navigate to="/" replace />;

  try {
    const user = JSON.parse(userStr);
    // Check Name column = "Admin" in users table
    const isAdmin = user.name === "Admin" || user.Name === "Admin" || user.uname === "Admin";
    if (isAdmin) {
      return children;
    } else {
      return <Navigate to="/deck" replace />;
    }
  } catch {
    return <Navigate to="/" replace />;
  }
}

// Wrapper to handle Login callbacks
function LoginWrapper() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    
    // CHECK: Only Name "Admin" can open AdminDB.jsx
    const isAdmin = userData.name === "Admin" || userData.Name === "Admin" || userData.uname === "Admin";
    
    if (isAdmin) {
      navigate('/admin'); // Admin user -> AdminDB.jsx
    } else {
      navigate('/deck'); // Any other user -> Deck.jsx
    }
  };

  const handleGoConstruction = () => {
    navigate('/construction');
  };

  return (
    <Login 
      onLoginSuccess={handleLoginSuccess}
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
        <Route path="/admin" element={
          <ProtectedAdminRoute>
            <AdminDB />
          </ProtectedAdminRoute>
        } />
        <Route path="/admindb" element={
          <ProtectedAdminRoute>
            <AdminDB />
          </ProtectedAdminRoute>
        } />
        <Route path="/deck" element={<Deck />} />
        <Route path="/construction" element={<Construction />} />
      </Routes>
    </Router>
  );
}