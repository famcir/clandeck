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

app.use(cors());
app.use(express.json());

// DB
const pool = mysql.createPool(process.env.MYSQL_URL || process.env.DATABASE_URL);
console.log("Connecting...");

pool.getConnection().then(c => {
  console.log("✅ DB Connected!");
  c.release();
}).catch(err => {
  console.error("❌ DB Failed:", err.message);
});

// API Routes
app.get('/api', (req, res) => {
  res.send('Clandeck Backend Running!');
});

app.post('/api/register', async (req, res) => {
  const { id, name, email, password } = req.body;
  try {
    await pool.execute(
      "INSERT INTO users (id, name, email, password, status) VALUES (?,?,?,?,?)",
      [id, name, email, password, 'active']
    );
    res.json({ message: "User created!", id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await pool.execute(
      "SELECT id, name, email FROM users WHERE email =? AND password =?",
      [email, password]
    );
    if (rows.length === 0) return res.status(400).json({ error: "Wrong email or password" });
    const user = rows[0];
    res.json({ message: "Login success", id: user.id, name: user.name, email: user.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve Frontend - auto detect dist / build / client/dist
const possiblePaths = ['dist', 'build', 'client/dist', 'frontend/dist'];
let frontendPath = null;
for (const p of possiblePaths) {
  if (fs.existsSync(path.join(__dirname, p))) {
    frontendPath = path.join(__dirname, p);
    break;
  }
}

if (frontendPath) {
  console.log(`Serving frontend from ${frontendPath}`);
  app.use(express.static(frontendPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.send('Clandeck Backend Running! - Build your frontend'));
}

app.listen(PORT, '0.0.0.0', () => console.log(`✅ Running on ${PORT}`));