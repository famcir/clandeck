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

// MySQL Pool - Railway auto provides these variables
const pool = mysql.createPool({
  host: process.env.MYSQLHOST || process.env.MYSQL_HOST || 'mysql.railway.internal',
  user: process.env.MYSQLUSER || process.env.MYSQL_USER || 'root',
  password: process.env.MYSQLPASSWORD || process.env.MYSQL_ROOT_PASSWORD || process.env.MYSQL_PASSWORD,
  database: process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || 'railway',
  port: process.env.MYSQLPORT || 3306,
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
    // Allow login with id OR uname (UNS, 001 etc) - case insensitive for uname
    // Also handle '001' = 1 for INT id columns
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
    
    // Return BOTH formats so old and new Login.jsx both work!
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
      user: userData,  // <-- For new Login.jsx
      id: userData.id, // <-- For backward compatibility
      name: userData.name,
      uname: userData.uname,
      photo_url: userData.photo_url
    });

  } catch (err) {
    console.error('DB Error:', err);
    res.status(500).json({ success: false, msg: 'Database error', message: 'Database error', error: err.message });
  }
};

// Both endpoints work!
app.post('/api/login', handleLogin);
app.post('/api/auth/login', handleLogin);

// Test endpoint to see if users table exists
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