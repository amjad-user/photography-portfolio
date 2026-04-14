/**
 * main.js — Shared utilities loaded on every public page.
 * Provides: escHtml, initLightbox, mobile nav toggle
 */

// ── XSS-safe HTML escaping ────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Mobile nav toggle ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('nav-toggle');
  const links  = document.getElementById('nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => links.classList.toggle('open'));
    // Close nav when a link is clicked
    links.querySelectorAll('a').forEach(a =>
      a.addEventListener('click', () => links.classList.remove('open'))
    );
  }
});

// ── Lightbox ──────────────────────────────────────────────────────────────────
/**
 * Wires up lightbox behaviour for a photo grid.
 * @param {Array}   photos  Array of photo objects { filename, title, caption }
 * @param {Element} grid    The container element holding .photo-item elements
 */
function initLightbox(photos, grid) {
  const lb      = document.getElementById('lightbox');
  const lbImg   = document.getElementById('lb-img');
  const lbTitle = document.getElementById('lb-title');
  const lbCap   = document.getElementById('lb-caption');
  const close   = document.getElementById('lb-close');
  const prev    = document.getElementById('lb-prev');
  const next    = document.getElementById('lb-next');

  if (!lb || !photos.length) return;

  let current = 0;

  function open(index) {
    current = (index + photos.length) % photos.length;
    const p = photos[current];
    lbImg.src         = `/uploads/${p.filename}`;
    lbImg.alt         = p.title || p.original_name || '';
    lbTitle.textContent  = p.title   || '';
    lbCap.textContent    = p.caption || '';
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeLb() {
    lb.classList.remove('open');
    document.body.style.overflow = '';
    lbImg.src = '';
  }

  // Click on photo item
  grid.addEventListener('click', e => {
    const item = e.target.closest('.photo-item');
    if (!item) return;
    open(parseInt(item.dataset.index, 10) || 0);
  });

  close.addEventListener('click', closeLb);
  prev.addEventListener('click',  () => open(current - 1));
  next.addEventListener('click',  () => open(current + 1));

  // Click outside image closes lightbox
  lb.addEventListener('click', e => { if (e.target === lb) closeLb(); });

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape')     closeLb();
    if (e.key === 'ArrowLeft')  open(current - 1);
    if (e.key === 'ArrowRight') open(current + 1);
  });
}
