import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, '../uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, {recursive:true});

const storage = multer.diskStorage({
  destination: (req,file,cb)=> cb(null, uploadDir),
  filename: (req,file,cb)=> {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}_${Math.random().toString(36).substr(2,6)}${ext}`);
  }
});
const upload = multer({ storage, limits:{ fileSize: 10*1024*1024 } });

router.use('/uploads', express.static(uploadDir));

// UPLOAD ENDPOINT
router.post('/upload', upload.single('file'), (req,res)=>{
  if(!req.file) return res.status(400).json({error:"No file"});
  const url = `/api/uploads/${req.file.filename}`;
  // Also return full URL for Railway
  const fullUrl = `${req.protocol}://${req.get('host')}${url}`;
  res.json({url, fullUrl, filename: req.file.filename});
});

// UPLOAD MULTIPLE (for album)
router.post('/upload-multiple', upload.array('files', 10), (req,res)=>{
  const files = req.files || [];
  const urls = files.map(f=>`/api/uploads/${f.filename}`);
  res.json({urls, files: urls.map((u,i)=>({url:u, filename: files[i].filename}))});
});

export default router;