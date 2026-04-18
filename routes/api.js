/**
 * Public API routes — no authentication required.
 */
const express    = require('express');
const router     = express.Router();
const supabase = require('../supabase/client');

// ── Site settings ─────────────────────────────────────────────────────────────
router.get('/settings', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('key, value');
    if (error) throw error;
    res.json(Object.fromEntries(data.map(r => [r.key, r.value])));
  } catch {
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

// ── Photos ────────────────────────────────────────────────────────────────────
router.get('/photos', async (req, res) => {
  try {
    const { category } = req.query;
    let query = supabase
      .from('photos').select('*')
      .order('sort_order').order('created_at', { ascending: false });
    if (category && category !== 'all') query = query.eq('category', category);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to load photos.' });
  }
});

router.get('/photos/featured', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('photos').select('*')
      .eq('featured', true)
      .order('sort_order').order('created_at', { ascending: false })
      .limit(12);
    if (error) throw error;
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to load featured photos.' });
  }
});

// ── Categories ────────────────────────────────────────────────────────────────
router.get('/categories', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('photos').select('category');
    if (error) throw error;
    const counts = {};
    data.forEach(r => { counts[r.category] = (counts[r.category] || 0) + 1; });
    const categories = Object.entries(counts)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => a.category.localeCompare(b.category));
    res.json(categories);
  } catch {
    res.status(500).json({ error: 'Failed to load categories.' });
  }
});

// ── Contact form ──────────────────────────────────────────────────────────────
router.post('/contact', async (req, res) => {
  const { name, email, message } = req.body;

  if (!name?.trim() || !email?.trim() || !message?.trim())
    return res.status(400).json({ error: 'All fields are required.' });

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Invalid email address.' });

  try {
    const { error } = await supabase
      .from('messages')
      .insert({ name: name.trim(), email: email.trim(), message: message.trim() });
    if (error) throw error;
    res.json({ success: true, message: 'Message sent successfully!' });
  } catch {
    res.status(500).json({ error: 'Failed to send message.' });
  }
});

module.exports = router;
