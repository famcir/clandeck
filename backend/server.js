import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

import profilesRouter from './routes/profiles.js';
import relationsRouter from './routes/relations.js';
import usersRouter from './routes/users.js';
import groupsRouter from './routes/groups.js';
import chatRouter from './routes/chat.js';
import uploadRouter from './routes/upload.js';
import familyTreeRouter from './routes/FamilyTree.js'; // ✅ ADDED - capital F T exact name

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
if (!dbUrl) console.error("❌ MYSQL_URL missing in env!");
export const pool = mysql.createPool(dbUrl);
export const genId = (p='') => `${p}${Date.now()}_${Math.random().toString(36).substring(2,8)}`;

pool.getConnection().then(c=>{ console.log("✅ DB Connected!"); c.release(); })
.catch(e=>console.error("DB Failed:", e.message));

// ✅ MOUNT ORDER MATTERS
app.use('/api/profiles', profilesRouter);
app.use('/api/family-tree', familyTreeRouter); // ✅ FIXED - now /api/family-tree/:id works, no more 500
app.use('/api', relationsRouter);
app.use('/api', usersRouter);
app.use('/api', groupsRouter);
app.use('/api', chatRouter);
app.use('/api', uploadRouter);

app.get('/api', (req,res)=>res.json({status:'ok',message:'Clandeck Backend Running + FamilyTree Fixed!'}));
app.get('/api/health', async (req,res)=>{
  try{ const [r]=await pool.query('SELECT 1 as ok'); res.json({status:'ok', db:r[0].ok}); }
  catch(e){ res.status(500).json({status:'error', error:e.message}); }
});

// Frontend - keep LAST
const distPath = path.join(__dirname, '../dist');
if(fs.existsSync(distPath)){
  app.use(express.static(distPath));
  app.get('*', (req,res)=>{
    if(req.path.startsWith('/api')) return res.status(404).json({error:'API not found: '+req.path});
    res.sendFile(path.join(distPath,'index.html'));
  });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT,'0.0.0.0',()=>console.log(`Running on ${PORT} with FamilyTree fix`));