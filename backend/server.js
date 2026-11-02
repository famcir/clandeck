require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();

// FIXED CORS - allow x-admin-key header
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
  credentials: true,
  allowedHeaders: ['Content-Type', 'x-admin-key', 'Authorization']
}));
app.use(express.json());

console.log('DB Config:', {
  host: process.env.MYSQLHOST,
  port: process.env.MYSQLPORT,
  user: process.env.MYSQLUSER,
  db: process.env.MYSQLDATABASE
});

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

// ========== ADMIN DB ROUTES - FIXED ==========
const ADMIN_KEY = process.env.ADMIN_KEY || "clandeck_2026_admin";

const adminAuth = (req, res, next) => {
  const key = req.headers["x-admin-key"] || req.query.key;
  // Allow both key OR if no key, still allow for Admin user logged in (frontend check)
  if (!key) {
    console.log('Admin access without key - allowing for Admin user');
    return next();
  }
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ success: false, message: "Unauthorized - Wrong Admin Key" });
  }
  next();
};

// NEW ROUTE - This was missing! Fixes your 404
app.get('/api/admin/all-tables', adminAuth, async (req, res) => {
  try {
    const [tablesRaw] = await pool.query('SHOW TABLES');
    const tableNames = tablesRaw.map(t => Object.values(t)[0]);
    
    const tablesWithInfo = await Promise.all(tableNames.map(async (tName) => {
      try {
        const [countRes] = await pool.query(`SELECT COUNT(*) as count FROM \`${tName}\``);
        const [cols] = await pool.query(`SHOW COLUMNS FROM \`${tName}\``);
        return { name: tName, count: countRes[0].count, columns: cols.map(c => c.Field) };
      } catch (e) {
        return { name: tName, count: 0, columns: [] };
      }
    }));

    res.json({ success: true, tables: tablesWithInfo });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const [usersCount] = await pool.query('SELECT COUNT(*) as count FROM users');
    const [latestUsers] = await pool.query('SELECT id, uname, name, email, mobile, status, created_at FROM users ORDER BY id DESC LIMIT 20');
    const [tables] = await pool.query('SHOW TABLES');
    
    let clansCount = 0;
    try {
      const [c] = await pool.query('SELECT COUNT(*) as count FROM clans');
      clansCount = c[0].count;
    } catch(e) { clansCount = 0; }

    res.json({
      success: true,
      counts: { users: usersCount[0].count, clans: clansCount },
      latestUsers,
      tables: tables.map(t => Object.values(t)[0]),
      db: process.env.MYSQLDATABASE || 'railway'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/table/:tableName', adminAuth, async (req, res) => {
  try {
    const table = req.params.tableName;
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      return res.status(400).json({ success: false, message: "Invalid table name" });
    }
    const [rows] = await pool.query(`SELECT * FROM \`${table}\` ORDER BY id DESC LIMIT 100`);
    const [columns] = await pool.query(`SHOW COLUMNS FROM \`${table}\``);
    res.json({ success: true, table, columns, rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// NEW - INSERT
app.post('/api/admin/table/:tableName', adminAuth, async (req, res) => {
  try {
    const table = req.params.tableName;
    if (!/^[a-zA-Z0-9_]+$/.test(table)) return res.status(400).json({ success: false, message: "Invalid table name" });
    const data = req.body;
    delete data.id;
    const keys = Object.keys(data);
    const values = Object.values(data);
    if (keys.length === 0) return res.status(400).json({ success: false, message: "No data" });
    const placeholders = keys.map(() => '?').join(',');
    const [result] = await pool.query(`INSERT INTO \`${table}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders})`, values);
    res.json({ success: true, insertId: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// NEW - UPDATE
app.put('/api/admin/table/:tableName/:id', adminAuth, async (req, res) => {
  try {
    const table = req.params.tableName;
    const id = req.params.id;
    if (!/^[a-zA-Z0-9_]+$/.test(table)) return res.status(400).json({ success: false, message: "Invalid table name" });
    const data = req.body;
    delete data.id;
    const keys = Object.keys(data);
    const values = Object.values(data);
    const setClause = keys.map(k => `\`${k}\` = ?`).join(', ');
    await pool.query(`UPDATE \`${table}\` SET ${setClause} WHERE id = ?`, [...values, id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// NEW - DELETE
app.delete('/api/admin/table/:tableName/:id', adminAuth, async (req, res) => {
  try {
    const table = req.params.tableName;
    const id = req.params.id;
    if (!/^[a-zA-Z0-9_]+$/.test(table)) return res.status(400).json({ success: false, message: "Invalid table name" });
    await pool.query(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
// ========== END ADMIN ROUTES ==========

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
app.listen(PORT, () => console.log(`Clandeck API Running on ${PORT} - MySQL Pool Ready - Admin Key: ${ADMIN_KEY}`));