/**
 * Admin API routes — all protected by JWT except /login.
 * Media (images + videos) stored in Supabase Storage bucket "photos".
 */
const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const path       = require('path');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const supabase   = require('../supabase/client');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');

// ── Multer — memory storage, accepts images and videos ───────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const isImage = /\.(jpeg|jpg|png|gif|webp)$/i.test(file.originalname)
                 && /^image\//.test(file.mimetype);
    const isVideo = /\.(mp4|webm|mov)$/i.test(file.originalname)
                 && /^video\//.test(file.mimetype);
    const ok = isImage || isVideo;
    cb(ok ? null : new Error('Only image or video files are allowed.'), ok);
  },
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB (Vercel caps at ~4.5 MB in practice)
});

// ── Helper: normalise YouTube/Vimeo watch URLs → embed URLs ──────────────────
function normaliseVideoUrl(url) {
  if (!url) return null;
  // Already an embed URL — pass through
  if (/youtube\.com\/embed\/|player\.vimeo\.com\/video\//.test(url)) return url;
  // youtube.com/watch?v=ID  or  youtu.be/ID
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  // vimeo.com/ID  (handles vimeo.com/channels/foo/ID too)
  const vm = url.match(/vimeo\.com\/(?:.*\/)?(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  // Direct URL (Supabase Storage or other) — allow as-is
  if (/^https?:\/\//.test(url)) return url;
  return null;
}

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

// POST /photos — upload images/videos or save an embed URL (YouTube/Vimeo)
router.post('/photos', authenticateToken,
  upload.fields([
    { name: 'photos',    maxCount: 20 },
    { name: 'thumbnail', maxCount: 1  },  // embed-URL manual thumbnail (existing)
    // Auto-extracted client-side thumbnails, one per video file slot (thumbnail_0 … thumbnail_19)
    ...Array.from({ length: 20 }, (_, i) => ({ name: `thumbnail_${i}`, maxCount: 1 })),
  ]),
  async (req, res) => {
    const {
      title = '', caption = '', category = 'uncategorized',
      featured = 'false', media_type = 'photo', video_url = '',
    } = req.body;

    const photoFiles     = req.files?.photos     || [];
    const thumbnailFiles = req.files?.thumbnail  || [];

    console.log(`[photos:upload] media_type=${media_type} files=${photoFiles.length} video_url=${video_url ? 'yes' : 'no'}`);

    try {
      // ── Path A: embed URL only (YouTube / Vimeo — no binary upload) ──────
      if (media_type === 'video' && !photoFiles.length && video_url) {
        const normalised = normaliseVideoUrl(video_url);
        if (!normalised) return res.status(400).json({ error: 'Invalid YouTube or Vimeo URL.' });

        let thumbUrl = '';
        if (thumbnailFiles.length) {
          const { publicUrl } = await uploadToStorage(
            thumbnailFiles[0].buffer, thumbnailFiles[0].originalname,
            thumbnailFiles[0].mimetype, 'photos'
          );
          thumbUrl = publicUrl;
        }

        const { data, error } = await supabase.from('photos').insert([{
          filename:      '',
          original_name: title || 'Video',
          image_url:     thumbUrl,
          video_url:     normalised,
          media_type:    'video',
          title, caption, category,
          featured: featured === 'true',
        }]).select('id, video_url, image_url');

        if (error) throw error;
        console.log(`[photos:upload] Inserted embed video row id=${data[0]?.id}`);
        return res.json({ success: true, photos: data });
      }

      // ── Path B: file upload (images or small video files) ────────────────
      if (!photoFiles.length) return res.status(400).json({ error: 'No files uploaded.' });

      const rows = [];
      for (let i = 0; i < photoFiles.length; i++) {
        const file    = photoFiles[i];
        const isVideo = /^video\//.test(file.mimetype);
        const { filename, publicUrl } = await uploadToStorage(
          file.buffer, file.originalname, file.mimetype, 'photos'
        );

        // For video files, upload the auto-extracted thumbnail (thumbnail_i) if provided
        let thumbUrl = '';
        if (isVideo) {
          const thumbFiles = req.files[`thumbnail_${i}`];
          if (thumbFiles?.length) {
            const tf = thumbFiles[0];
            const { publicUrl: tUrl } = await uploadToStorage(
              tf.buffer, tf.originalname, tf.mimetype, 'photos'
            );
            thumbUrl = tUrl;
            console.log(`[photos:upload] Saved auto-thumbnail for file[${i}]: ${tUrl}`);
          }
        }

        rows.push({
          filename,
          original_name: file.originalname,
          image_url:     isVideo ? thumbUrl : publicUrl,
          video_url:     isVideo ? publicUrl : '',
          media_type:    isVideo ? 'video' : 'photo',
          title, caption, category,
          featured: featured === 'true',
        });
      }

      const { data, error } = await supabase
        .from('photos').insert(rows).select('id, filename, image_url, video_url, media_type');

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
  }
);

router.put('/photos/:id', authenticateToken, async (req, res) => {
  try {
    const { data: photo, error: fetchErr } = await supabase
      .from('photos').select('*').eq('id', req.params.id).single();
    if (fetchErr || !photo) return res.status(404).json({ error: 'Photo not found.' });

    const { title, caption, category, featured, video_url } = req.body;
    const update = {
      title:    title    ?? photo.title,
      caption:  caption  ?? photo.caption,
      category: category ?? photo.category,
      featured: featured !== undefined ? !!featured : photo.featured,
    };

    // Only update video_url for video rows; normalise watch URLs → embed URLs
    if (photo.media_type === 'video' && video_url !== undefined) {
      update.video_url = normaliseVideoUrl(video_url) || video_url;
    }

    const { error } = await supabase
      .from('photos').update(update).eq('id', req.params.id);

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
