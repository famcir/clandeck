require('dotenv').config(); // <-- THIS WAS MISSING FOR LOCAL!
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();

// FIXED CORS - allow your frontend everywhere
app.use(cors({
  origin: [
    'http://localhost:5173', 
    'http://localhost:3000',
    'https://clandeck.com', 
    'https://www.clandeck.com',
    'https://famcir.github.io',
    'https://clandeck.vercel.app',
    'https://api.clandeck.com'
  ],
  credentials: true
}));
app.use(express.json());

console.log('DB Config:', {
  host: process.env.MYSQLHOST,
  port: process.env.MYSQLPORT,
  user: process.env.MYSQLUSER,
  db: process.env.MYSQLDATABASE
});

// MySQL Pool - Fixed to use PUBLIC host locally
const pool = mysql.createPool({
  host: process.env.MYSQLHOST || 'altaria.proxy.rlwy.net',
  user: process.env.MYSQLUSER || 'root',
  password: process.env.MYSQLPASSWORD || 'ddkkKLwrUPaXHqxNjhwsRMzzbsMwOTqAb',
  database: process.env.MYSQLDATABASE || 'railway',
  port: process.env.MYSQLPORT || 36114,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

app.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT NOW() as time, DATABASE() as db');
    res.json({ status: 'Clandeck API Running', db: 'connected', time: rows[0].time, database: rows[0].db });
  } catch (e) {
    res.json({ status: 'API Running', db: 'disconnected', error: e.message });
  }
});

// REAL DB LOGIN - Single function for both routes
const handleLogin = async (req, res) => {
  let { username, password } = req.body;
  console.log('Login attempt:', username);
  
  if (!username || !password) {
    return res.status(400).json({ success: false, msg: 'Username and password required', message: 'Username and password required' });
  }

  username = String(username).trim();
  password = String(password).trim();

  try {
    const [rows] = await pool.query(
      `SELECT id, name, mobile, email, photo_url, status, uname, password 
       FROM users 
       WHERE (id = ? OR uname = ? OR LOWER(uname) = LOWER(?) OR CAST(id AS CHAR) = ?) 
       AND password = ? AND status = 'active' LIMIT 1`,
      [username, username, username, username, password]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, msg: 'Invalid username or password', message: 'Invalid username or password' });
    }

    const user = rows[0];
    
    const userData = {
      id: user.id,
      name: user.name,
      uname: user.uname,
      username: user.uname || user.id,
      mobile: user.mobile,
      email: user.email,
      photo_url: user.photo_url,
      status: user.status
    };

    res.json({
      success: true,
      msg: `Welcome, ${user.name}!`,
      message: `Welcome, ${user.name}!`,
      user: userData,
      id: userData.id,
      name: userData.name,
      uname: userData.uname,
      photo_url: userData.photo_url
    });

  } catch (err) {
    console.error('DB Error:', err);
    res.status(500).json({ success: false, msg: 'Database error', message: 'Database error', error: err.message });
  }
};

app.post('/api/login', handleLogin);
app.post('/api/auth/login', handleLogin);

app.get('/api/test-users', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, uname, name, status FROM users LIMIT 5');
    res.json({ success: true, count: rows.length, users: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Clandeck API Running on ${PORT} - MySQL Pool Ready`));