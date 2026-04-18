/**
 * Admin API routes — all protected by JWT except /login.
 * Images are stored in Supabase Storage bucket "photos".
 */
const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const path       = require('path');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const supabase   = require('../supabase/client');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');

// ── Multer — memory storage (buffer sent to Supabase, never written to disk) ──
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const ok = /\.(jpeg|jpg|png|gif|webp)$/i.test(file.originalname)
            && /^image\//.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed.'), ok);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ── Helper: upload a buffer to Supabase Storage, return public URL ────────────
async function uploadToStorage(buffer, originalname, mimetype, folder = 'photos') {
  const ext      = path.extname(originalname).toLowerCase();
  const filename = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

  console.log(`[storage] Uploading ${originalname} → ${filename}`);

  const { error } = await supabase.storage
    .from('photos')
    .upload(filename, buffer, { contentType: mimetype, upsert: false });

  if (error) {
    console.error('[storage] Upload error:', error.message);
    throw error;
  }

  const { data: { publicUrl } } = supabase.storage
    .from('photos')
    .getPublicUrl(filename);

  console.log('[storage] Public URL:', publicUrl);
  return { filename, publicUrl };
}

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
  } catch (err) {
    console.error('[login] Error:', err.message);
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
  } catch (err) {
    console.error('[change-password] Error:', err.message);
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
  } catch (err) {
    console.error('[photos:get] Error:', err.message);
    res.status(500).json({ error: 'Failed to load photos.' });
  }
});

// POST /photos — upload one or more images to Supabase Storage
router.post('/photos', authenticateToken, upload.array('photos', 20), async (req, res) => {
  if (!req.files?.length)
    return res.status(400).json({ error: 'No files uploaded.' });

  const { title = '', caption = '', category = 'uncategorized', featured = 'false' } = req.body;
  console.log(`[photos:upload] Received ${req.files.length} file(s)`);

  try {
    const rows = [];

    for (const file of req.files) {
      const { filename, publicUrl } = await uploadToStorage(
        file.buffer, file.originalname, file.mimetype, 'photos'
      );
      rows.push({
        filename,
        original_name: file.originalname,
        image_url:     publicUrl,
        title,
        caption,
        category,
        featured: featured === 'true',
      });
    }

    const { data, error } = await supabase
      .from('photos').insert(rows).select('id, filename, image_url');

    if (error) {
      console.error('[photos:upload] DB insert error:', error.message);
      throw error;
    }

    console.log(`[photos:upload] Inserted ${data.length} row(s)`);
    res.json({ success: true, photos: data });
  } catch (err) {
    console.error('[photos:upload] Error:', err.message);
    res.status(500).json({ error: 'Upload failed.', detail: err.message });
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
  } catch (err) {
    console.error('[photos:update] Error:', err.message);
    res.status(500).json({ error: 'Update failed.' });
  }
});

router.delete('/photos/:id', authenticateToken, async (req, res) => {
  try {
    const { data: photo, error: fetchErr } = await supabase
      .from('photos').select('filename, image_url').eq('id', req.params.id).single();
    if (fetchErr || !photo) return res.status(404).json({ error: 'Photo not found.' });

    // Remove from Supabase Storage
    if (photo.filename) {
      const { error: storageErr } = await supabase.storage
        .from('photos')
        .remove([photo.filename]);
      if (storageErr) console.warn('[photos:delete] Storage removal warning:', storageErr.message);
      else             console.log('[photos:delete] Removed from storage:', photo.filename);
    }

    const { error } = await supabase.from('photos').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[photos:delete] Error:', err.message);
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
  } catch (err) {
    console.error('[settings:get] Error:', err.message);
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
  } catch (err) {
    console.error('[settings:save] Error:', err.message);
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

// POST /upload-image — hero or about image, stored in Supabase Storage
router.post('/upload-image', authenticateToken, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const key = req.body.type || 'about_image';
  console.log(`[upload-image] Uploading ${key}…`);

  try {
    const { publicUrl } = await uploadToStorage(
      req.file.buffer, req.file.originalname, req.file.mimetype, 'content'
    );

    const { error } = await supabase
      .from('settings').upsert({ key, value: publicUrl }, { onConflict: 'key' });
    if (error) throw error;

    res.json({ success: true, url: publicUrl });
  } catch (err) {
    console.error('[upload-image] Error:', err.message);
    res.status(500).json({ error: 'Image upload failed.', detail: err.message });
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
  } catch (err) {
    console.error('[messages:get] Error:', err.message);
    res.status(500).json({ error: 'Failed to load messages.' });
  }
});

router.put('/messages/:id/read', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('messages').update({ is_read: true }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[messages:read] Error:', err.message);
    res.status(500).json({ error: 'Update failed.' });
  }
});

router.delete('/messages/:id', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase.from('messages').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[messages:delete] Error:', err.message);
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
  } catch (err) {
    console.error('[stats] Error:', err.message);
    res.status(500).json({ error: 'Failed to load stats.' });
  }
});

module.exports = router;
