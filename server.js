import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import multer from 'multer';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// --- DB ---
let pool;
const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("❌ MYSQL_URL missing!");
} else {
  try {
    pool = mysql.createPool(dbUrl);
    pool.getConnection().then(c => { console.log("✅ DB Connected!"); c.release(); }).catch(err => console.error("❌ DB Failed:", err.message));
  } catch (err) { console.error("Pool error:", err.message); }
}

// --- S3 CLIENT ---
const BUCKET_NAME = process.env.RAILWAY_BUCKET_NAME || process.env.BUCKET_NAME || "clandeckbucket-kbeh97nv8b";
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.ENDPOINT,
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
});

const upload = multer({ storage: multer.memoryStorage() });

// --- API ROUTES ---
app.get('/api', (req, res) => res.json({ status: 'ok', message: 'Clandeck Backend Running!' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', db: pool? 'pool exists' : 'no pool', bucket: BUCKET_NAME }));

app.post('/api/register', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not configured" });
  const { id, name, email, password } = req.body;
  try {
    await pool.execute("INSERT INTO users (id, name, email, password, status) VALUES (?,?,?,?,?)", [id, name, email, password, 'active']);
    res.json({ message: "User created!", id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  const { email, password } = req.body;
  try {
    const [rows] = await pool.execute("SELECT id, name, email FROM users WHERE email=? AND password=?", [email, password]);
    if (rows.length === 0) return res.status(400).json({ error: "Wrong email or password" });
    res.json({ message: "Login success", id: rows[0].id, name: rows[0].name, email: rows[0].email, token: "token-" + rows[0].id });
  } catch (err) { res.status(500).json({ error: "DB Error: " + err.message }); }
});

app.get('/api/users/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const [rows] = await pool.execute("SELECT id, name, email, photo_url FROM users WHERE id=?", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { photo_url, name, full_name } = req.body;
    const displayName = full_name || name;
    if (photo_url) {
      try { await pool.execute("UPDATE users SET photo_url=?, name=? WHERE id=?", [photo_url, displayName, req.params.id]); }
      catch (e) { await pool.execute("UPDATE users SET name=? WHERE id=?", [displayName, req.params.id]); }
    } else if (displayName) {
      await pool.execute("UPDATE users SET name=? WHERE id=?", [displayName, req.params.id]);
    }
    res.json({ success: true, photo_url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/profiles', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  const { owner_user_id } = req.query;
  const [rows] = await pool.query('SELECT * FROM profiles WHERE owner_user_id =?', [owner_user_id]);
  res.json(rows);
});

app.get('/api/profiles/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  const [rows] = await pool.query('SELECT * FROM profiles WHERE id =?', [req.params.id]);
  res.json(rows[0] || {});
});

app.put('/api/profiles/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  const { display_name, relation_label, dob, photo_url, is_claimed } = req.body;
  await pool.query('UPDATE profiles SET display_name=?, relation_label=?, dob=?, photo_url=?, is_claimed=? WHERE id=?', [display_name, relation_label, dob, photo_url, is_claimed, req.params.id]);
  res.json({ success: true });
});

// --- ADDED: Missing POST routes for AddFamilyModel ---
app.post('/api/profiles', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { id, display_name, relation_label, bio, owner_user_id, photo_url, dob } = req.body;
    await pool.execute(
      "INSERT INTO profiles (id, display_name, relation_label, bio, owner_user_id, photo_url, dob) VALUES (?,?,?,?,?,?,?)",
      [id, display_name, relation_label, bio || null, owner_user_id, photo_url || '', dob || null]
    );
    res.json({ success: true, id });
  } catch (err) {
    console.error("POST /api/profiles error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/relations', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { owner_profile_id } = req.query;
    if (!owner_profile_id) return res.json([]);
    const [rows] = await pool.query('SELECT * FROM profile_relations WHERE owner_profile_id =?', [owner_profile_id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/relations', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { owner_profile_id, related_profile_id, relation_type, spouse_group } = req.body;
    await pool.execute(
      "INSERT INTO profile_relations (owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?)",
      [owner_profile_id, related_profile_id, relation_type, spouse_group || null]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/relations error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- FIXED: FOLDER = profileId ONLY - NO GENERAL FALLBACK ---
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  try {
    // Get profileId from anywhere
    const profileId = req.query.profileId || req.body?.profileId || req.query.id || req.body?.id;
    const userId = req.query.userId || req.body?.userId || req.query.owner_user_id || req.body?.owner_user_id;

    console.log("QUERY:", req.query, "BODY:", req.body);

    if (!profileId) {
      console.log("❌ profileId missing!");
      return res.status(400).json({
        error: "profileId missing! Call /api/upload?profileId=YOUR_PROFILE_ID",
        gotQuery: req.query,
        gotBody: req.body
      });
    }

    const safeName = req.file.originalname.replace(/\s+/g, '-');
    const key = `avatars/${profileId}/${safeName}`;

    console.log(`Uploading to: ${BUCKET_NAME}/${key} - overwrite if same name`);

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'image/jpeg',
    }));

    const host = `${req.protocol}://${req.get('host')}`;
    const publicUrl = `${host}/api/files/${key}`;
    console.log("✅ Saved:", publicUrl);

    if (pool) {
      try {
        await pool.execute("UPDATE profiles SET photo_url=? WHERE id=?", [publicUrl, profileId]).catch(()=>{});
        if (userId) {
          await pool.execute("UPDATE users SET photo_url=? WHERE id=?", [publicUrl, userId]).catch(()=>{});
        }
        console.log("✅ DB updated for profile:", profileId);
      } catch (e) { console.log("DB error:", e.message); }
    }

    res.json({ success: true, url: publicUrl, key: key, folder: profileId });

  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/files/*', async (req, res) => {
  try {
    const key = req.params[0];
    const data = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    res.setHeader('Content-Type', data.ContentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    data.Body.pipe(res);
  } catch (err) {
    res.status(404).json({ error: "File not found", details: err.message });
  }
});

const frontendPath = path.join(__dirname, 'dist');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API route not found: ' + req.path });
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.json({ status: 'ok', message: 'Backend Running - dist not found' }));
}

app.listen(PORT, '0.0.0.0', () => console.log(`✅ Running on ${PORT} - Folder=profileId ONLY`));