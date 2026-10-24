import { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || "https://clandeck-production.up.railway.app";

function App() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setUser(data); // {name: "Admin"}
    } catch (err) {
      setError(err.message);
    }
  };

  if (user) {
    return (
      <div style={{ display:'flex', height:'100vh', alignItems:'center', justifyContent:'center', flexDirection:'column', fontFamily:'sans-serif' }}>
        <h1 style={{ fontSize:'48px' }}>Welcome, {user.name}! 🎉</h1>
        <p>Login success with {user.username}</p>
        <button onClick={()=>setUser(null)} style={{ marginTop:20, padding:'10px 20px' }}>Logout</button>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', height:'100vh', fontFamily:'sans-serif' }}>
      <div style={{ flex:1, background:'#f8f8f8', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column' }}>
        <h1>ClanDeck</h1>
        <p>Manage your entire family in one deck.</p>
      </div>
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', padding:40 }}>
        <h2>Your Clan, In One Deck</h2>
        {error && <div style={{ background:'#fee', color:'red', padding:10, borderRadius:8, marginBottom:10 }}>{error}</div>}
        <form onSubmit={handleLogin} style={{ width:'100%', maxWidth:320 }}>
          <label>USERNAME</label>
          <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="001" style={{ width:'100%', padding:12, margin:'8px 0 16px', borderRadius:8, border:'1px solid #ddd' }}/>
          <label>PASSWORD</label>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="1234" style={{ width:'100%', padding:12, margin:'8px 0 16px', borderRadius:8, border:'1px solid #ddd' }}/>
          <button type="submit" style={{ width:'100%', padding:12, background:'black', color:'white', borderRadius:8, marginTop:10 }}>Log in</button>
        </form>
        <p style={{ marginTop:10, fontSize:12, color:'#888' }}>API: {API_URL}</p>
      </div>
    </div>
  );
}
export default App;