import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import multer from 'multer';
import multerS3 from 'multer-s3';

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

// --- RAILWAY BUCKET (TIGRIS T3) S3 CLIENT ---
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.ENDPOINT,
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
});

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.RAILWAY_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      cb(null, `avatars/${Date.now()}-${file.originalname}`);
    },
  }),
});

// --- API ROUTES --- ALL API FIRST!
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

// GET my profiles - MOVED HERE!
app.get('/api/profiles', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  const { owner_user_id } = req.query;
  const [rows] = await pool.query('SELECT * FROM profiles WHERE owner_user_id =?', [owner_user_id]);
  res.json(rows);
});

// UPDATE profile - MOVED HERE!
app.put('/api/profiles/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  const { display_name, relation_label, dob, photo_url, is_claimed } = req.body;
  await pool.query(
    'UPDATE profiles SET display_name=?, relation_label=?, dob=?, photo_url=?, is_claimed=? WHERE id=?',
    [display_name, relation_label, dob, photo_url, is_claimed, req.params.id]
  );
  res.json({ success: true });
});

// --- NEW: UPLOAD TO RAILWAY BUCKET ---
// UPLOAD - MUST RETURN PROXY URL, NOT DIRECT BUCKET URL
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  
  console.log("Uploaded to Railway Bucket key:", req.file.key);
  
  // IMPORTANT: Do NOT use req.file.location (that's the t3.storageapi.dev link - private)
  // Use our proxy route
  const host = `${req.protocol}://${req.get('host')}`;
  const publicUrl = `${host}/api/files/${req.file.key}`;
  
  console.log("Public URL (via proxy):", publicUrl);
  res.json({ success: true, url: publicUrl, key: req.file.key });
});

// FILE SERVING - This is what makes private file public
app.get('/api/files/:key1/:key2', async (req, res) => {
  try {
    const key = `${req.params.key1}/${req.params.key2}`;
    console.log("Fetching file:", key);
    
    const command = new GetObjectCommand({
      Bucket: process.env.BUCKET_NAME || "clandeckbucket-kbeh97nv8b",
      Key: key,
    });
    
    const data = await s3.send(command);
    res.setHeader('Content-Type', data.ContentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    data.Body.pipe(res);
  } catch (err) {
    console.error("File fetch error:", err);
    res.status(404).json({ error: "File not found", details: err.message });
  }
});

// --- FRONTEND LAST --- AFTER ALL API!
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