require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Ensure uploads directory exists ───────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static public files and uploaded images
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// ── API Routes ─────────────────────────────────────────────────────────────────
app.use('/api',       require('./routes/api'));
app.use('/api/admin', require('./routes/admin'));

// ── Admin SPA ──────────────────────────────────────────────────────────────────
app.get('/admin', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'))
);

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n  Photography Portfolio is running!\n');
  console.log(`  Public site : http://localhost:${PORT}`);
  console.log(`  Admin panel : http://localhost:${PORT}/admin\n`);
});
