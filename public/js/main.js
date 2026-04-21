/**
 * main.js — Shared utilities loaded on every public page.
 * Provides: escHtml, initLightbox (photo + video + touch swipe), mobile nav toggle
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
    links.querySelectorAll('a').forEach(a =>
      a.addEventListener('click', () => links.classList.remove('open'))
    );
  }
});

// ── Lightbox ──────────────────────────────────────────────────────────────────
/**
 * Wires up lightbox behaviour for a photo/video grid.
 * Supports three render modes based on media_type + video_url:
 *   1. photo (or no media_type) → <img>
 *   2. video + embed URL (YouTube/Vimeo) → <iframe>
 *   3. video + direct file URL (.mp4/.webm/.mov) → <video>
 *
 * @param {Array}   photos  Array of media objects
 * @param {Element} grid    Container holding .photo-item elements
 */
function initLightbox(photos, grid) {
  const lb      = document.getElementById('lightbox');
  const lbMedia = document.getElementById('lb-media');
  const lbTitle = document.getElementById('lb-title');
  const lbCap   = document.getElementById('lb-caption');
  const close   = document.getElementById('lb-close');
  const prev    = document.getElementById('lb-prev');
  const next    = document.getElementById('lb-next');

  if (!lb || !lbMedia || !photos.length) return;

  let current = 0;

  function isEmbedUrl(url) {
    return /youtube\.com\/embed\/|player\.vimeo\.com\/video\//.test(url);
  }

  function isDirectVideoUrl(url) {
    return url && !isEmbedUrl(url) && /\.(mp4|webm|mov)(\?|$)/i.test(url);
  }

  function open(index) {
    current = (index + photos.length) % photos.length;
    const p = photos[current];

    lbTitle.textContent = p.title   || '';
    lbCap.textContent   = p.caption || '';

    // Clear previous media (stops any playing video/audio)
    lbMedia.innerHTML = '';

    if (p.media_type === 'video' && p.video_url) {
      if (isEmbedUrl(p.video_url)) {
        // ── YouTube / Vimeo iframe ──────────────────────────────────────────
        const iframe = document.createElement('iframe');
        iframe.src             = p.video_url + '?autoplay=1';
        iframe.allow           = 'autoplay; fullscreen; picture-in-picture';
        iframe.allowFullscreen = true;
        iframe.style.cssText   =
          'width:min(88vw,960px);height:min(50vw,540px);' +
          'border:none;border-radius:14px;' +
          'box-shadow:0 48px 120px rgba(0,0,0,0.85);';
        lbMedia.appendChild(iframe);
      } else if (isDirectVideoUrl(p.video_url)) {
        // ── Direct video file ───────────────────────────────────────────────
        const video = document.createElement('video');
        video.src      = p.video_url;
        video.controls = true;
        video.autoplay = true;
        video.style.cssText =
          'max-width:88vw;max-height:80vh;' +
          'border-radius:14px;box-shadow:0 48px 120px rgba(0,0,0,0.85);';
        if (p.image_url) video.poster = p.image_url;
        lbMedia.appendChild(video);
      }
    } else {
      // ── Photo ───────────────────────────────────────────────────────────────
      const img = document.createElement('img');
      img.src  = p.image_url || '';
      img.alt  = p.title || p.original_name || '';
      img.style.cssText =
        'max-width:88vw;max-height:80vh;object-fit:contain;' +
        'border-radius:14px;box-shadow:0 48px 120px rgba(0,0,0,0.85);';
      lbMedia.appendChild(img);
    }

    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeLb() {
    lb.classList.remove('open');
    document.body.style.overflow = '';
    lbMedia.innerHTML = ''; // stop audio/video on close
  }

  // Click on grid item
  grid.addEventListener('click', e => {
    const item = e.target.closest('.photo-item');
    if (!item) return;
    open(parseInt(item.dataset.index, 10) || 0);
  });

  close.addEventListener('click', closeLb);
  if (prev) prev.addEventListener('click', () => open(current - 1));
  if (next) next.addEventListener('click', () => open(current + 1));

  // Click outside media closes lightbox
  lb.addEventListener('click', e => { if (e.target === lb) closeLb(); });

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape')     closeLb();
    if (e.key === 'ArrowLeft')  open(current - 1);
    if (e.key === 'ArrowRight') open(current + 1);
  });

  // Touch swipe (mobile navigation)
  let touchStartX = 0;
  lb.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  lb.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) {
      dx < 0 ? open(current + 1) : open(current - 1);
    }
  }, { passive: true });
}
