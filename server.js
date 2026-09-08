import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware FIRST
app.use(cors());
app.use(express.json());

// DB
const pool = mysql.createPool(process.env.MYSQL_URL);
console.log("Connecting...");

pool.getConnection().then(c => {
  console.log("✅ DB Connected!");
  c.release();
}).catch(err => {
  console.error("❌ DB Failed:", err.message);
});

// Health check for Railway
app.get('/', (req, res) => {
  res.send('Clandeck Backend Running!');
});

// REGISTER
app.post('/api/register', async (req, res) => {
  const { id, name, email, password } = req.body;
  try {
    const [result] = await pool.execute(
      "INSERT INTO users (id, name, email, password, status) VALUES (?,?,?,?,?)",
      [id, name, email, password, 'active']
    );
    res.json({ message: "User created!", id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// LOGIN
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

// Listen ONCE at the end
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Running on ${PORT}`));