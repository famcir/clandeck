import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// --- SAFE DB CONNECTION ---
let pool;
const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;

if (!dbUrl) {
  console.error("❌ MYSQL_URL missing!");
} else {
  console.log("Using DB URL:", dbUrl.includes("internal")? "Internal Private" : "Public");
  try {
    pool = mysql.createPool(dbUrl);
    pool.getConnection().then(c => {
      console.log("✅ DB Connected!");
      c.release();
    }).catch(err => {
      console.error("❌ DB Failed:", err.message, err.code);
    });
  } catch (err) {
    console.error("Pool error:", err.message);
  }
}

// --- API ROUTES ---
app.get('/api', (req, res) => res.json({ status: 'ok', message: 'Clandeck Backend Running!' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', db: pool? 'pool exists' : 'no pool' }));

app.post('/api/register', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not configured" });
  const { id, name, email, password } = req.body;
  try {
    await pool.execute("INSERT INTO users (id, name, email, password, status) VALUES (?,?,?,?,?)", [id, name, email, password, 'active']);
    res.json({ message: "User created!", id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
  console.log("Login attempt:", req.body.email);
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  const { email, password } = req.body;
  try {
    const [rows] = await pool.execute("SELECT id, name, email FROM users WHERE email=? AND password=?", [email, password]);
    if (rows.length === 0) return res.status(400).json({ error: "Wrong email or password" });
    res.json({ message: "Login success", id: rows[0].id, name: rows[0].name, email: rows[0].email, token: "token-" + rows[0].id });
  } catch (err) {
    console.error("Login DB Error:", err.message);
    res.status(500).json({ error: "DB Error: " + err.message });
  }
});

// --- FRONTEND LAST ---
const frontendPath = path.join(__dirname, 'dist');
console.log("dist exists:", fs.existsSync(frontendPath));

if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'API route not found: ' + req.path });
    }
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.json({ status: 'ok', message: 'Backend Running - dist not found' }));
}

app.listen(PORT, '0.0.0.0', () => console.log(`✅ Running on ${PORT}`));