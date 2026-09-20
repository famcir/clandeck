import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
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

// --- NEW: SHARE TEMP USER - UN + firstName / pw1234 ---
app.post('/api/share-temp-user', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  const { id, name, email, password, profile_id, invited_by_user_id } = req.body;
  try {
    try { await pool.query("ALTER TABLE users ADD COLUMN invited_by_user_id VARCHAR(255)"); } catch(e) {}
    try { await pool.query("ALTER TABLE users ADD COLUMN shared_profile_id VARCHAR(255)"); } catch(e) {}
    try { await pool.query("ALTER TABLE users ADD COLUMN is_temp TINYINT DEFAULT 0"); } catch(e) {}

    await pool.execute(
      "INSERT INTO users (id, name, email, password, status, invited_by_user_id, shared_profile_id, is_temp) VALUES (?,?,?,?,?,?,?,?)",
      [id, name, email, password || 'pw1234', 'active', invited_by_user_id, profile_id || null, 1]
    );
    res.json({ success: true, username: email, password: password || 'pw1234' });
  } catch (err) {
    if (err.message.includes('Duplicate')) {
      try {
        await pool.execute("UPDATE users SET password=?, invited_by_user_id=?, shared_profile_id=? WHERE email=?", [password || 'pw1234', invited_by_user_id, profile_id || null, email]);
        return res.json({ success: true, username: email, password: password || 'pw1234', reused: true });
      } catch(e2) { return res.status(500).json({ error: e2.message }); }
    }
    res.status(500).json({ error: err.message });
  }
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
  try {
    const { owner_user_id } = req.query;
    if (!owner_user_id) return res.json([]);
    const [rows] = await pool.query('SELECT * FROM profiles WHERE owner_user_id =?', [owner_user_id]);
    res.json(rows);
  } catch(e){ res.status(500).json({error: e.message}) }
});

app.get('/api/profiles/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const [rows] = await pool.query('SELECT * FROM profiles WHERE id =?', [req.params.id]);
    res.json(rows[0] || {});
  } catch(e){ res.status(500).json({error: e.message}) }
});

// --- NEW: FAMILY TREE FOR ANY PROFILE (AUTO-LINK PARENTS/SPOUSE/CHILDREN/SIBLINGS) ---
app.get('/api/family-tree/:profileId', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { profileId } = req.params;
    const [selfRows] = await pool.query('SELECT * FROM profiles WHERE id=?', [profileId]);
    const self = selfRows[0];
    if (!self) return res.json([]);

    const ownerId = self.owner_user_id;
    const [familyRows] = await pool.query('SELECT * FROM profiles WHERE owner_user_id=?', [ownerId]);
    let family = familyRows;

    if (!family.find(p => p.id === profileId)) family.push(self);

    const selfLabel = (self.relation_label || '').toLowerCase();

    const result = family.map(p => {
      if (p.id === profileId) return {...p, relation_label: 'Self' };
      const label = (p.relation_label || '').toLowerCase();

      if (selfLabel === 'father' && label === 'mother') return {...p, relation_label: 'Spouse' };
      if (selfLabel === 'mother' && label === 'father') return {...p, relation_label: 'Spouse' };

      if (['father','mother'].includes(selfLabel)) {
        if (['self','sibling','child'].includes(label)) return {...p, relation_label: 'Child' };
      }

      if (['self','sibling','child'].includes(selfLabel)) {
        if (['self','sibling','child'].includes(label)) return {...p, relation_label: 'Sibling' };
      }

      return p;
    });

    res.json(result);
  } catch (e) {
    console.error('family-tree error', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/profiles/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { display_name, relation_label, dob, photo_url, is_claimed, bio, location } = req.body;
    await pool.query('UPDATE profiles SET display_name=?, relation_label=?, dob=?, photo_url=?, is_claimed=?, bio=?, location=? WHERE id=?', [display_name, relation_label, dob, photo_url, is_claimed, bio, location, req.params.id]);
    res.json({ success: true });
  } catch(e){ res.status(500).json({error: e.message}) }
});

app.delete('/api/profiles/:id', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const profileId = req.params.id;
    console.log(`🗑️ Deleting profile ${profileId}`);

    // --- FIXED: DELETE S3 FOLDER avatars/profileId/ ---
    try {
      let continuationToken = undefined;
      let isTruncated = true;
      while (isTruncated) {
        const list = await s3.send(new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: `avatars/${profileId}`,
          ContinuationToken: continuationToken
        }));
        if (list.Contents && list.Contents.length > 0) {
          for (const obj of list.Contents) {
            console.log(` → Deleting S3: ${obj.Key}`);
            await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: obj.Key }));
          }
        }
        isTruncated = list.IsTruncated || false;
        continuationToken = list.NextContinuationToken;
        if (!isTruncated) break;
      }
      // Also delete exact key from photo_url if stored differently
      const [prows] = await pool.query('SELECT photo_url FROM profiles WHERE id=?', [profileId]);
      const pUrl = prows[0]?.photo_url || '';
      if (pUrl.includes('/api/files/')) {
        const k = decodeURIComponent(pUrl.split('/api/files/')[1]);
        if (k) {
          console.log(` → Deleting S3 url key: ${k}`);
          await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: k })).catch(()=>{});
        }
      }
    } catch(s3e){ console.log('S3 delete skip:', s3e.message); }

    // --- DELETE DB ---
    await pool.query('DELETE FROM profile_relations WHERE related_profile_id=? OR owner_profile_id=?', [profileId, profileId]);
    await pool.query('DELETE FROM profiles WHERE id=?', [profileId]);
    res.json({ success: true });
  } catch(e){ res.status(500).json({error: e.message}) }
});

app.post('/api/profiles', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DB not connected" });
  try {
    const { id, display_name, relation_label, owner_user_id, photo_url, dob, name, bio, location } = req.body;
    const finalName = display_name || name;
    const finalId = id || `pr_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
    if (!finalName) return res.status(400).json({ error: "display_name required" });
    if (!owner_user_id) return res.status(400).json({ error: "owner_user_id required" });
    await pool.execute(
      "INSERT INTO profiles (id, owner_user_id, display_name, relation_label, dob, photo_url, is_claimed, created_by_user_id, bio, location) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [finalId, owner_user_id, finalName, relation_label || 'Family', dob || null, photo_url || null, 0, owner_user_id, bio || null, location || null]
    );
    res.json({ success: true, id: finalId });
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
    const { id, owner_profile_id, related_profile_id, relation_type, spouse_group } = req.body;
    const finalId = id || `rel_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
    if (!owner_profile_id ||!related_profile_id ||!relation_type) {
      return res.status(400).json({ error: "owner_profile_id, related_profile_id, relation_type required" });
    }
    await pool.execute(
      "INSERT INTO profile_relations (id, owner_profile_id, related_profile_id, relation_type, spouse_group) VALUES (?,?,?,?,?)",
      [finalId, owner_profile_id, related_profile_id, relation_type, spouse_group || null]
    );
    res.json({ success: true, id: finalId });
  } catch (err) {
    console.error("POST /api/relations error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const profileId = req.query.profileId || req.body?.profileId || req.query.id || req.body?.id;
    if (!profileId) {
      return res.status(400).json({ error: "profileId missing! Call /api/upload?profileId=YOUR_PROFILE_ID" });
    }
    const safeName = req.file.originalname.replace(/\s+/g, '-');
    const key = `avatars/${profileId}/${safeName}`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'image/jpeg',
    }));
    const host = `${req.protocol}://${req.get('host')}`;
    const publicUrl = `${host}/api/files/${key}`;
    if (pool) {
      await pool.execute("UPDATE profiles SET photo_url=? WHERE id=?", [publicUrl, profileId]);
    }
    res.json({ success: true, url: publicUrl, key: key, folder: profileId });
  } catch (err) {
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

app.listen(PORT, '0.0.0.0', () => console.log(`✅ Running on ${PORT}`));