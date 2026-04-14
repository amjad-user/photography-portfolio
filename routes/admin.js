/**
 * Admin API routes — all protected by JWT except /login.
 */
const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { supabase }                    = require('../db/init');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');

// ── Multer — disk storage for uploaded photos ─────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `photo-${unique}${path.extname(file.originalname).toLowerCase()}`);
  },
});
const fileFilter = (_req, file, cb) => {
  const ok = /\.(jpeg|jpg|png|gif|webp)$/i.test(file.originalname)
          && /^image\//.test(file.mimetype);
  cb(ok ? null : new Error('Only image files are allowed.'), ok);
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  try {
    const { data: admin, error } = await supabase
      .from('admin_users').select('*').eq('email', email).single();

    if (error || !admin || !bcrypt.compareSync(password, admin.password_hash))
      return res.status(401).json({ error: 'Invalid credentials.' });

    const token = jwt.sign({ id: admin.id, email: admin.email }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, email: admin.email });
  } catch {
    res.status(500).json({ error: 'Login failed.' });
  }
});

router.put('/change-password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Both passwords are required.' });
  if (newPassword.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });

  try {
    const { data: admin, error } = await supabase
      .from('admin_users').select('*').eq('id', req.admin.id).single();

    if (error || !admin || !bcrypt.compareSync(currentPassword, admin.password_hash))
      return res.status(401).json({ error: 'Current password is incorrect.' });

    const { error: updateErr } = await supabase
      .from('admin_users')
      .update({ password_hash: bcrypt.hashSync(newPassword, 12) })
      .eq('id', req.admin.id);

    if (updateErr) throw updateErr;
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Password change failed.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PHOTOS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/photos', authenticateToken, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('photos').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to load photos.' });
  }
});

router.post('/photos', authenticateToken, upload.array('photos', 20), async (req, res) => {
  if (!req.files?.length)
    return res.status(400).json({ error: 'No files uploaded.' });

  const { title = '', caption = '', category = 'uncategorized', featured = 'false' } = req.body;

  try {
    const rows = req.files.map(file => ({
      filename:      file.filename,
      original_name: file.originalname,
      title, caption, category,
      featured: featured === 'true',
    }));

    const { data, error } = await supabase
      .from('photos').insert(rows).select('id, filename');
    if (error) throw error;
    res.json({ success: true, photos: data });
  } catch {
    res.status(500).json({ error: 'Upload failed.' });
  }
});

router.put('/photos/:id', authenticateToken, async (req, res) => {
  try {
    const { data: photo, error: fetchErr } = await supabase
      .from('photos').select('*').eq('id', req.params.id).single();
    if (fetchErr || !photo) return res.status(404).json({ error: 'Photo not found.' });

    const { title, caption, category, featured } = req.body;
    const { error } = await supabase
      .from('photos')
      .update({
        title:    title    ?? photo.title,
        caption:  caption  ?? photo.caption,
        category: category ?? photo.category,
        featured: featured !== undefined ? !!featured : photo.featured,
      })
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Update failed.' });
  }
});

router.delete('/photos/:id', authenticateToken, async (req, res) => {
  try {
    const { data: photo, error: fetchErr } = await supabase
      .from('photos').select('filename').eq('id', req.params.id).single();
    if (fetchErr || !photo) return res.status(404).json({ error: 'Photo not found.' });

    const filePath = path.join(__dirname, '..', 'uploads', photo.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    const { error } = await supabase.from('photos').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Delete failed.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/settings', authenticateToken, async (_req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('key, value');
    if (error) throw error;
    res.json(Object.fromEntries(data.map(r => [r.key, r.value])));
  } catch {
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

router.put('/settings', authenticateToken, async (req, res) => {
  try {
    const rows = Object.entries(req.body)
      .map(([key, value]) => ({ key, value: String(value ?? '') }));
    const { error } = await supabase
      .from('settings').upsert(rows, { onConflict: 'key' });
    if (error) throw error;
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

router.post('/upload-image', authenticateToken, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const key = req.body.type || 'about_image';

  try {
    // Delete previous image file if one exists
    const { data: existing } = await supabase
      .from('settings').select('value').eq('key', key).single();
    if (existing?.value) {
      const oldPath = path.join(__dirname, '..', 'uploads', path.basename(existing.value));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const url = `/uploads/${req.file.filename}`;
    const { error } = await supabase
      .from('settings').upsert({ key, value: url }, { onConflict: 'key' });
    if (error) throw error;
    res.json({ success: true, url });
  } catch {
    res.status(500).json({ error: 'Image upload failed.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGES
// ─────────────────────────────────────────────────────────────────────────────

router.get('/messages', authenticateToken, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to load messages.' });
  }
});

router.put('/messages/:id/read', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('messages').update({ is_read: true }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Update failed.' });
  }
});

router.delete('/messages/:id', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase.from('messages').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Delete failed.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD STATS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/stats', authenticateToken, async (_req, res) => {
  try {
    const [{ data: photos }, { data: messages }] = await Promise.all([
      supabase.from('photos').select('featured, category'),
      supabase.from('messages').select('is_read'),
    ]);

    res.json({
      totalPhotos:    (photos   || []).length,
      featuredPhotos: (photos   || []).filter(p => p.featured).length,
      categories:     new Set((photos || []).map(p => p.category)).size,
      totalMessages:  (messages || []).length,
      unreadMessages: (messages || []).filter(m => !m.is_read).length,
    });
  } catch {
    res.status(500).json({ error: 'Failed to load stats.' });
  }
});

module.exports = router;
