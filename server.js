require('dotenv').config();
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const supabase = require('./supabase/client');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Uploads directory (local dev only — Vercel filesystem is read-only) ────────
if (process.env.VERCEL !== '1') {
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', express.static(uploadsDir));
}

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Ensure Supabase Storage bucket exists ──────────────────────────────────────
(async () => {
  try {
    const { error } = await supabase.storage.createBucket('photos', {
      public: true,
      allowedMimeTypes: [
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm', 'video/quicktime',
      ],
      fileSizeLimit: 100 * 1024 * 1024,
    });
    if (error && !error.message.includes('already exists')) {
      console.warn('  Storage bucket warning:', error.message);
    } else {
      console.log('  Storage bucket "photos" ready.');
    }
  } catch (err) {
    console.warn('  Storage bucket check failed:', err.message);
  }
})();

// ── API Routes ─────────────────────────────────────────────────────────────────
app.use('/api',       require('./routes/api'));
app.use('/api/admin', require('./routes/admin'));

// ── Admin SPA ──────────────────────────────────────────────────────────────────
app.get('/admin', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'))
);

// ── Start (local dev only — Vercel handles listening itself) ───────────────────
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log('\n  Photography Portfolio is running!\n');
    console.log(`  Public site : http://localhost:${PORT}`);
    console.log(`  Admin panel : http://localhost:${PORT}/admin\n`);
  });
}

module.exports = app;
