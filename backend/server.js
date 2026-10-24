const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors({
  origin: ['http://localhost:5173', 'https://clandeck.com', 'https://www.clandeck.com', 'https://famcir.github.io', 'https://api.clandeck.com'],
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
  connectionLimit: 10
});

app.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT NOW() as time');
    res.json({ status: 'Clandeck API Running', db: 'connected', time: rows[0].time });
  } catch (e) {
    res.json({ status: 'API Running', db: 'disconnected', error: e.message });
  }
});

// REAL DB LOGIN
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('Login attempt:', username);
  
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password required' });
  }

  try {
    // Allow login with id OR uname (UNS, 001 etc) - case insensitive for uname
    const [rows] = await pool.query(
      `SELECT id, name, mobile, email, photo_url, status, uname 
       FROM users 
       WHERE (id = ? OR uname = ? OR LOWER(uname) = LOWER(?)) 
       AND password = ? AND status = 'active' LIMIT 1`,
      [username, username, username, password]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    const user = rows[0];
    res.json({
      success: true,
      id: user.id,
      name: user.name,
      uname: user.uname,
      photo_url: user.photo_url,
      message: `Welcome, ${user.name}!`
    });

  } catch (err) {
    console.error('DB Error:', err);
    res.status(500).json({ success: false, message: 'Database error', error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server on', PORT));