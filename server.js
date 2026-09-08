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

const pool = mysql.createPool(process.env.MYSQL_URL || process.env.DATABASE_URL);
console.log("Connecting...");
pool.getConnection().then(c => { console.log("✅ DB Connected!"); c.release(); }).catch(err => console.error("❌ DB Failed:", err.message));

app.get('/api', (req, res) => res.send('Clandeck Backend Running!'));

app.post('/api/register', async (req, res) => {
  const { id, name, email, password } = req.body;
  try {
    await pool.execute("INSERT INTO users (id, name, email, password, status) VALUES (?,?,?,?,?)", [id, name, email, password, 'active']);
    res.json({ message: "User created!", id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await pool.execute("SELECT id, name, email FROM users WHERE email=? AND password=?", [email, password]);
    if (rows.length === 0) return res.status(400).json({ error: "Wrong email or password" });
    res.json({ message: "Login success", id: rows[0].id, name: rows[0].name, email: rows[0].email });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DEBUG LOGS
console.log("__dirname:", __dirname);
console.log("Files here:", fs.readdirSync(__dirname));
const frontendPath = path.join(__dirname, 'dist');
console.log("Checking:", frontendPath, "Exists:", fs.existsSync(frontendPath));
if (fs.existsSync(frontendPath)) console.log("Files in dist:", fs.readdirSync(frontendPath));

if (fs.existsSync(frontendPath)) {
  console.log(`✅ Serving frontend from ${frontendPath}`);
  app.use(express.static(frontendPath));
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.send('Clandeck Backend Running! - dist not found'));
}

app.listen(PORT, '0.0.0.0', () => console.log(`✅ Running on ${PORT}`));