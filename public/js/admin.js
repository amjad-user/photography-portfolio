/**
 * admin.js — Admin dashboard logic
 * Handles: login, JWT storage, all CRUD API calls, section switching, modals
 */

// ── Token helpers ─────────────────────────────────────────────────────────────
const TOKEN_KEY = 'admin_token';
const getToken  = ()         => localStorage.getItem(TOKEN_KEY);
const setToken  = (t)        => localStorage.setItem(TOKEN_KEY, t);
const clearToken= ()         => localStorage.removeItem(TOKEN_KEY);

/** Fetch wrapper that injects the Bearer token, handles 401/403, and catches network errors. */
async function authFetch(url, opts = {}) {
  const token = getToken();
  try {
    const res = await fetch(url, {
      ...opts,
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401 || res.status === 403) {
      clearToken();
      showLogin();
      return null;
    }
    return res;
  } catch (err) {
    console.error('[authFetch] Network error for', url, '—', err.message);
    return null;
  }
}

// ── Alert helpers ─────────────────────────────────────────────────────────────
function showAlert(id, msg, type = 'ok') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className   = `alert show alert-${type}`;
  setTimeout(() => el.classList.remove('show'), 5000);
}

/**
 * Returns a Promise<boolean> resolved by the custom confirm modal.
 * Used instead of window.confirm() because iOS Safari suppresses browser
 * dialogs called inside async functions, silently returning false.
 */
function showConfirm(message) {
  const modal     = document.getElementById('confirm-modal');
  const msgEl     = document.getElementById('confirm-message');
  const okBtn     = document.getElementById('confirm-ok');
  const cancelBtn = document.getElementById('confirm-cancel');

  if (!modal || !msgEl || !okBtn || !cancelBtn) {
    return Promise.resolve(window.confirm(message));
  }

  return new Promise(resolve => {
    msgEl.textContent = message;
    modal.classList.add('open');

    function finish(result) {
      modal.classList.remove('open');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlay);
      resolve(result);
    }
    const onOk       = () => finish(true);
    const onCancel   = () => finish(false);
    const onOverlay  = e => { if (e.target === modal) finish(false); };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlay);
  });
}

// ── Section navigation ────────────────────────────────────────────────────────
function switchSection(name) {
  document.querySelectorAll('.admin-section').forEach(s => (s.style.display = 'none'));
  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));

  const sec = document.getElementById(`sec-${name}`);
  if (sec) sec.style.display = 'block';

  const link = document.querySelector(`.sidebar-nav a[data-section="${name}"]`);
  if (link) link.classList.add('active');

  // Load data for the section
  if (name === 'dashboard') loadStats();
  if (name === 'photos')    loadPhotos();
  if (name === 'content')   loadContent();
  if (name === 'messages')  loadMessages();

  // Close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
}

// ── Login / Logout ────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('admin-app').classList.remove('show');
}

function showApp(email) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-app').classList.add('show');
  document.getElementById('admin-email-display').textContent = email || 'admin';
  switchSection('dashboard');
}

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn   = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  errEl.classList.remove('show');
  btn.disabled = true; btn.textContent = 'Signing in…';

  try {
    const res  = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email:    document.getElementById('l-email').value,
        password: document.getElementById('l-pass').value,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setToken(data.token);
      localStorage.setItem('admin_email', data.email || '');
      showApp(data.email);
    } else {
      errEl.textContent = data.error || 'Login failed.';
      errEl.classList.add('show');
    }
  } catch {
    errEl.textContent = 'Network error. Is the server running?';
    errEl.classList.add('show');
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In';
  }
});

document.getElementById('logout-btn').addEventListener('click', e => {
  e.preventDefault();
  clearToken();
  localStorage.removeItem('admin_email');
  showLogin();
});

// Sidebar nav clicks
document.querySelectorAll('.sidebar-nav a[data-section]').forEach(a =>
  a.addEventListener('click', e => {
    e.preventDefault();
    switchSection(a.dataset.section);
  })
);

// Mobile sidebar toggle
document.getElementById('sidebar-toggle').addEventListener('click', () =>
  document.getElementById('sidebar').classList.toggle('open')
);

// ── DASHBOARD — Stats ─────────────────────────────────────────────────────────
async function loadStats() {
  const res = await authFetch('/api/admin/stats');
  if (!res) return;
  const d = await res.json();
  document.getElementById('st-photos').textContent   = d.totalPhotos;
  document.getElementById('st-featured').textContent = d.featuredPhotos;
  document.getElementById('st-cats').textContent     = d.categories;
  document.getElementById('st-msgs').textContent     = d.totalMessages;
  document.getElementById('st-unread').textContent   = d.unreadMessages;
  updateUnreadBadge(d.unreadMessages);
}

function updateUnreadBadge(count) {
  const badge = document.getElementById('unread-badge');
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// ── PHOTOS — Load grid ────────────────────────────────────────────────────────
async function loadPhotos() {
  document.getElementById('photos-loading').style.display = 'flex';
  document.getElementById('photos-grid').style.display    = 'none';
  document.getElementById('photos-empty').style.display   = 'none';

  const res = await authFetch('/api/admin/photos');
  if (!res) return;
  const photos = await res.json();

  document.getElementById('photos-loading').style.display = 'none';

  if (!photos.length) {
    document.getElementById('photos-empty').style.display = 'block';
    return;
  }

  const grid = document.getElementById('photos-grid');
  grid.style.display = 'grid';
  grid.innerHTML = photos.map(p => {
    const isVideo = p.media_type === 'video';
    const imgMarkup = adminMediaThumb(p);
    return `
      <div class="admin-photo-card" id="photo-card-${p.id}">
        <div style="position:relative;">
          ${imgMarkup}
          ${isVideo ? '<span class="video-badge">VIDEO</span>' : ''}
        </div>
        <div class="admin-photo-info">
          <div class="admin-photo-name" title="${escAdmin(p.title || p.original_name)}">${escAdmin(p.title || p.original_name || 'Untitled')}</div>
          <div class="admin-photo-meta">${escAdmin(p.category)} &bull; ${formatDate(p.created_at)}</div>
          ${p.featured ? '<span class="featured-badge">Featured</span>' : ''}
          <div class="admin-photo-actions" style="margin-top:.5rem;">
            <button class="btn btn-sm" onclick="openEditModal(${p.id})">Edit</button>
            <button class="btn btn-sm btn-danger" onclick="deletePhoto(${p.id})">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ── PHOTOS — Upload ───────────────────────────────────────────────────────────
const uploadInput = document.getElementById('upload-input');
const uploadZone  = document.getElementById('upload-zone');

// Drag-and-drop styling
uploadZone.addEventListener('dragover',  e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  uploadInput.files = e.dataTransfer.files;
  previewFiles(e.dataTransfer.files);
});
uploadInput.addEventListener('change', () => previewFiles(uploadInput.files));

// Stores auto-extracted thumbnail blobs: File → Blob (populated asynchronously)
const pendingThumbnails  = new Map();
// Stores the extraction Promise for each video file so the upload handler can
// await completion before reading pendingThumbnails.
const pendingExtractions = new Map();

/**
 * Extracts a single frame from a video File using a hidden <video> + <canvas>.
 * Seeks to 0.5 s (or 10% of duration if shorter). Returns a JPEG Blob, or null
 * if extraction fails (e.g. iOS Safari restrictions, decode error, timeout).
 */
function extractVideoThumbnail(file) {
  return new Promise(resolve => {
    const objectUrl = URL.createObjectURL(file);
    const video     = document.createElement('video');
    video.muted       = true;
    video.playsInline = true;
    video.preload     = 'metadata';

    const finish = blob => { URL.revokeObjectURL(objectUrl); resolve(blob); };
    const fail   = ()   => finish(null);

    // Give up after 8 seconds — handles iOS stalls gracefully
    const timer = setTimeout(fail, 8000);

    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) * 0.1);
    });

    video.addEventListener('seeked', () => {
      clearTimeout(timer);
      try {
        const canvas  = document.createElement('canvas');
        canvas.width  = video.videoWidth  || 640;
        canvas.height = video.videoHeight || 360;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => finish(blob), 'image/jpeg', 0.85);
      } catch { fail(); }
    });

    video.addEventListener('error', () => { clearTimeout(timer); fail(); });
    video.src = objectUrl;
  });
}

function previewFiles(files) {
  const container = document.getElementById('upload-preview');
  container.innerHTML = '';
  pendingThumbnails.clear();
  pendingExtractions.clear();

  Array.from(files).forEach(f => {
    if (f.type.startsWith('video/')) {
      // Show a placeholder while extraction is in progress
      const wrap = document.createElement('div');
      wrap.style.cssText = 'width:80px;height:80px;border:1px solid #2e2e2e;background:#111;display:flex;align-items:center;justify-content:center;border-radius:6px;overflow:hidden;position:relative;flex-shrink:0;';
      wrap.innerHTML = '<span style="color:#777;font-size:1.1rem;">⏳</span>';
      container.appendChild(wrap);

      const extraction = extractVideoThumbnail(f).then(blob => {
        if (blob) {
          pendingThumbnails.set(f, blob);
          const img = document.createElement('img');
          img.src = URL.createObjectURL(blob);
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
          wrap.innerHTML = '';
          wrap.appendChild(img);
          // Small play icon overlay so it's clearly a video
          const overlay = document.createElement('div');
          overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.3);pointer-events:none;';
          overlay.innerHTML = '<span style="color:#fff;font-size:1rem;">▶</span>';
          wrap.appendChild(overlay);
        } else {
          // Extraction failed (e.g. iOS) — show static play icon
          wrap.innerHTML = '<span style="color:#aaa;font-size:1.4rem;">▶</span>';
        }
      });
      pendingExtractions.set(f, extraction);
    } else {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      img.style.cssText = 'width:80px;height:80px;object-fit:cover;border:1px solid #2e2e2e;border-radius:6px;';
      container.appendChild(img);
    }
  });
}

/** Wire up media-type radio group to show/hide video-specific fields */
function initUploadForm() {
  const videoUrlField = document.getElementById('video-url-field');
  const thumbField    = document.getElementById('thumb-field');
  const uploadHint    = document.getElementById('upload-hint');
  const btn           = document.getElementById('upload-btn');

  function onTypeChange() {
    const isVideo = document.getElementById('mt-video').checked;
    videoUrlField.style.display = isVideo ? 'block' : 'none';
    thumbField.style.display    = isVideo ? 'block' : 'none';
    uploadHint.textContent = isVideo
      ? 'MP4, WebM, MOV · Direct upload limited to ~4 MB on Vercel · Use YouTube/Vimeo URL above for larger videos'
      : 'JPEG, PNG, WebP · Max 10 MB each · Multiple files allowed';
    btn.textContent = isVideo ? 'Upload Video' : 'Upload Selected Photos';
  }

  document.querySelectorAll('input[name="media_type"]').forEach(r =>
    r.addEventListener('change', onTypeChange)
  );
  onTypeChange(); // set initial state
}

document.getElementById('upload-btn').addEventListener('click', async () => {
  const isVideo    = document.getElementById('mt-video').checked;
  const files      = uploadInput.files;
  const videoUrl   = document.getElementById('up-video-url')?.value.trim() || '';
  const thumbInput = document.getElementById('thumb-input');
  const btn        = document.getElementById('upload-btn');

  // Validation
  if (isVideo && !files.length && !videoUrl) {
    showAlert('upload-alert', 'For video, either upload a file or enter a YouTube/Vimeo URL.', 'err'); return;
  }
  if (!isVideo && !files.length) {
    showAlert('upload-alert', 'Please select at least one image.', 'err'); return;
  }

  btn.disabled = true;
  btn.textContent = files.length ? `Uploading ${files.length} file(s)…` : 'Saving video…';

  const form = new FormData();
  form.append('media_type', isVideo ? 'video' : 'photo');

  if (isVideo && videoUrl && !files.length) {
    // Embed URL path
    form.append('video_url', videoUrl);
    if (thumbInput?.files[0]) form.append('thumbnail', thumbInput.files[0]);
  } else {
    // File upload path — wait for any in-progress thumbnail extractions first
    const videoFiles = Array.from(files).filter(f => f.type.startsWith('video/'));
    if (videoFiles.length) {
      const extractions = videoFiles.map(f => pendingExtractions.get(f)).filter(Boolean);
      if (extractions.length) await Promise.all(extractions);
    }

    Array.from(files).forEach((f, i) => {
      form.append('photos', f);
      if (f.type.startsWith('video/')) {
        const thumb = pendingThumbnails.get(f);
        if (thumb) form.append(`thumbnail_${i}`, thumb, `thumb_${i}.jpg`);
      }
    });
  }

  form.append('title',    document.getElementById('up-title').value);
  form.append('caption',  document.getElementById('up-caption').value);
  form.append('category', document.getElementById('up-category').value);
  form.append('featured', document.getElementById('up-featured').checked ? 'true' : 'false');

  const res = await authFetch('/api/admin/photos', { method: 'POST', body: form });
  btn.disabled = false;
  btn.textContent = isVideo ? 'Upload Video' : 'Upload Selected Photos';
  if (!res) return;

  const data = await res.json();
  if (res.ok) {
    const count = data.photos?.length || 1;
    showAlert('upload-alert', `${count} item(s) added successfully.`, 'ok');
    uploadInput.value = '';
    if (thumbInput) thumbInput.value = '';
    if (document.getElementById('up-video-url')) document.getElementById('up-video-url').value = '';
    document.getElementById('upload-preview').innerHTML = '';
    pendingThumbnails.clear();
    loadPhotos();
  } else {
    showAlert('upload-alert', data.error || 'Upload failed.', 'err');
  }
});

// ── PHOTOS — Delete ───────────────────────────────────────────────────────────
async function deletePhoto(id) {
  const ok = await showConfirm('Delete this item? This cannot be undone.');
  if (!ok) return;

  const card      = document.getElementById(`photo-card-${id}`);
  const deleteBtn = card?.querySelector('.btn-danger');
  if (deleteBtn) { deleteBtn.disabled = true; deleteBtn.textContent = 'Deleting…'; }

  const res = await authFetch(`/api/admin/photos/${id}`, { method: 'DELETE' });

  if (!res) {
    // Network error or session expired
    if (deleteBtn) { deleteBtn.disabled = false; deleteBtn.textContent = 'Delete'; }
    showAlert('media-alert', 'Network error — could not delete item. Check your connection.', 'err');
    return;
  }

  if (res.ok) {
    card?.remove();
  } else {
    const d = await res.json().catch(() => ({}));
    if (deleteBtn) { deleteBtn.disabled = false; deleteBtn.textContent = 'Delete'; }
    showAlert('media-alert', d.error || 'Delete failed.', 'err');
  }
}

// ── PHOTOS — Edit Modal ───────────────────────────────────────────────────────
async function openEditModal(id) {
  const res = await authFetch(`/api/admin/photos/${id}`);
  if (!res) return;
  const photo = await res.json().catch(() => null);
  if (!photo || photo.error) { console.error('[openEditModal] Photo not found:', id); return; }

  const isVideo = photo.media_type === 'video';

  document.getElementById('modal-id').value         = photo.id;
  document.getElementById('modal-title').value      = photo.title    || '';
  document.getElementById('modal-caption').value    = photo.caption  || '';
  document.getElementById('modal-category').value   = photo.category || 'uncategorized';
  document.getElementById('modal-featured').checked = !!photo.featured;
  document.getElementById('modal-head-title').textContent = isVideo ? 'Edit Video' : 'Edit Photo';

  // Preview image
  const preview = document.getElementById('modal-preview');
  if (photo.image_url) {
    preview.src           = photo.image_url;
    preview.style.display = 'block';
  } else {
    preview.src           = '';
    preview.style.display = 'none';
  }

  // Show/hide video URL field
  const videoField = document.getElementById('modal-video-field');
  if (isVideo) {
    videoField.style.display = 'block';
    document.getElementById('modal-video-url').value = photo.video_url || '';
  } else {
    videoField.style.display = 'none';
  }

  document.getElementById('edit-modal').classList.add('open');
}

document.getElementById('modal-close').addEventListener('click',  closeModal);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('edit-modal').addEventListener('click', e => { if (e.target === document.getElementById('edit-modal')) closeModal(); });
function closeModal() { document.getElementById('edit-modal').classList.remove('open'); }

document.getElementById('modal-save').addEventListener('click', async () => {
  const id  = document.getElementById('modal-id').value;
  const res = await authFetch(`/api/admin/photos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title:     document.getElementById('modal-title').value,
      caption:   document.getElementById('modal-caption').value,
      category:  document.getElementById('modal-category').value,
      featured:  document.getElementById('modal-featured').checked,
      video_url: document.getElementById('modal-video-url')?.value || undefined,
    }),
  });
  if (!res) return;
  const data = await res.json();
  if (res.ok) {
    showAlert('modal-alert', 'Saved.', 'ok');
    loadPhotos();
    setTimeout(closeModal, 1200);
  } else {
    showAlert('modal-alert', data.error || 'Save failed.', 'err');
  }
});

// ── CONTENT — Load & Save ─────────────────────────────────────────────────────
async function loadContent() {
  const res = await authFetch('/api/admin/settings');
  if (!res) return;
  const s = await res.json();

  document.getElementById('c-site-name').value     = s.site_name     || '';
  document.getElementById('c-hero-tagline').value  = s.hero_tagline  || '';
  document.getElementById('c-hero-subtitle').value = s.hero_subtitle || '';
  document.getElementById('c-about-bio').value     = s.about_bio     || '';
  document.getElementById('c-contact-email').value = s.contact_email || '';
  document.getElementById('c-contact-phone').value = s.contact_phone || '';
  document.getElementById('c-instagram').value     = s.social_instagram || '';
  document.getElementById('c-facebook').value      = s.social_facebook  || '';
  document.getElementById('c-twitter').value       = s.social_twitter   || '';

  // Show existing images
  if (s.hero_image) {
    const el = document.getElementById('hero-img-preview');
    el.src = s.hero_image; el.style.display = 'block';
  }
  if (s.about_image) {
    const el = document.getElementById('about-img-preview');
    el.src = s.about_image; el.style.display = 'block';
  }
}

document.getElementById('save-content-btn').addEventListener('click', async () => {
  const btn = document.getElementById('save-content-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const res = await authFetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      site_name:        document.getElementById('c-site-name').value,
      hero_tagline:     document.getElementById('c-hero-tagline').value,
      hero_subtitle:    document.getElementById('c-hero-subtitle').value,
      about_bio:        document.getElementById('c-about-bio').value,
      contact_email:    document.getElementById('c-contact-email').value,
      contact_phone:    document.getElementById('c-contact-phone').value,
      social_instagram: document.getElementById('c-instagram').value,
      social_facebook:  document.getElementById('c-facebook').value,
      social_twitter:   document.getElementById('c-twitter').value,
    }),
  });

  btn.disabled = false; btn.textContent = 'Save All Changes';
  if (!res) return;
  const data = await res.json();
  showAlert('content-alert', res.ok ? 'All changes saved!' : (data.error || 'Save failed.'), res.ok ? 'ok' : 'err');
});

// Image upload helpers (hero + about)
function setupImageUpload(inputId, zoneId, previewId, type) {
  const zone  = document.getElementById(zoneId);
  const input = document.getElementById(inputId);

  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) uploadImage(e.dataTransfer.files[0], type, previewId);
  });
  input.addEventListener('change', () => {
    if (input.files[0]) uploadImage(input.files[0], type, previewId);
  });
}

async function uploadImage(file, type, previewId) {
  const form = new FormData();
  form.append('image', file);
  form.append('type', type);

  const res = await authFetch('/api/admin/upload-image', { method: 'POST', body: form });
  if (!res) return;
  const data = await res.json();
  if (res.ok) {
    const el = document.getElementById(previewId);
    el.src = data.url; el.style.display = 'block';
    showAlert('content-alert', 'Image uploaded.', 'ok');
  } else {
    showAlert('content-alert', data.error || 'Upload failed.', 'err');
  }
}

setupImageUpload('hero-img-input',  'hero-img-zone',  'hero-img-preview',  'hero_image');
setupImageUpload('about-img-input', 'about-img-zone', 'about-img-preview', 'about_image');

// ── MESSAGES ──────────────────────────────────────────────────────────────────
async function loadMessages() {
  document.getElementById('msgs-loading').style.display = 'flex';
  document.getElementById('msgs-list').innerHTML        = '';
  document.getElementById('msgs-empty').style.display   = 'none';

  const res = await authFetch('/api/admin/messages');
  if (!res) return;
  const msgs = await res.json();

  document.getElementById('msgs-loading').style.display = 'none';

  if (!msgs.length) {
    document.getElementById('msgs-empty').style.display = 'block';
    return;
  }

  const list = document.getElementById('msgs-list');
  list.innerHTML = msgs.map(m => `
    <div class="msg-item ${m.is_read ? '' : 'unread'}" id="msg-${m.id}">
      <div class="msg-head" onclick="toggleMsg(${m.id})">
        <div>
          <div class="msg-sender">${escAdmin(m.name)} ${m.is_read ? '' : '<sup style="color:var(--accent);font-size:.7rem;">NEW</sup>'}</div>
          <div class="msg-email">${escAdmin(m.email)}</div>
        </div>
        <div class="msg-date">${formatDate(m.created_at)}</div>
      </div>
      <div class="msg-body">
        <p>${escAdmin(m.message).replace(/\n/g, '<br>')}</p>
        <div class="msg-actions">
          <a href="mailto:${escAdmin(m.email)}?subject=Re: Your enquiry" class="btn btn-sm">Reply via Email</a>
          ${!m.is_read ? `<button class="btn btn-sm" onclick="markRead(${m.id})">Mark as Read</button>` : ''}
          <button class="btn btn-sm btn-danger" onclick="deleteMsg(${m.id})">Delete</button>
        </div>
      </div>
    </div>
  `).join('');

  updateUnreadBadge(msgs.filter(m => !m.is_read).length);
}

function toggleMsg(id) {
  const el = document.getElementById(`msg-${id}`);
  el.classList.toggle('expanded');
}

async function markRead(id) {
  const res = await authFetch(`/api/admin/messages/${id}/read`, { method: 'PUT' });
  if (res?.ok) loadMessages();
}

async function deleteMsg(id) {
  const ok = await showConfirm('Delete this message? This cannot be undone.');
  if (!ok) return;
  const res = await authFetch(`/api/admin/messages/${id}`, { method: 'DELETE' });
  if (!res) return;
  if (res.ok) {
    document.getElementById(`msg-${id}`)?.remove();
  } else {
    const d = await res.json().catch(() => ({}));
    console.error('[deleteMsg] Failed:', d.error);
  }
}

// ── SETTINGS — Change Password ────────────────────────────────────────────────
document.getElementById('pw-btn').addEventListener('click', async () => {
  const current  = document.getElementById('pw-current').value;
  const next     = document.getElementById('pw-new').value;
  const confirm  = document.getElementById('pw-confirm').value;

  if (!current || !next || !confirm) {
    showAlert('pw-alert', 'Please fill in all fields.', 'err'); return;
  }
  if (next !== confirm) {
    showAlert('pw-alert', 'New passwords do not match.', 'err'); return;
  }
  if (next.length < 8) {
    showAlert('pw-alert', 'Password must be at least 8 characters.', 'err'); return;
  }

  const res = await authFetch('/api/admin/change-password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: current, newPassword: next }),
  });
  if (!res) return;
  const data = await res.json();
  showAlert('pw-alert', res.ok ? 'Password updated successfully.' : (data.error || 'Failed.'), res.ok ? 'ok' : 'err');
  if (res.ok) { document.getElementById('pw-current').value = ''; document.getElementById('pw-new').value = ''; document.getElementById('pw-confirm').value = ''; }
});

// ── Utilities ─────────────────────────────────────────────────────────────────

// Extracts a YouTube video ID from any YouTube URL format
// (embed, watch?v=, youtu.be short link). Returns null for non-YouTube URLs.
function youTubeId(url) {
  if (!url) return null;
  const m = url.match(
    /(?:youtube\.com\/embed\/|youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

/**
 * Admin card thumbnail. Same strategy as mediaThumb() in main.js:
 * never uses <video> for thumbnails — iOS Safari renders it as a black box.
 */
function adminMediaThumb(p) {
  const s = 'width:100%;height:140px;object-fit:cover;display:block;';

  // 1. Uploaded thumbnail
  if (p.image_url) {
    return `<img src="${escAdmin(p.image_url)}" alt="" loading="lazy"
                 style="${s}"
                 onerror="this.style.background='#1a1a1a';this.removeAttribute('src')" />`;
  }

  if (p.media_type === 'video' && p.video_url) {
    // 2. YouTube CDN thumbnail — matches embed, watch, and youtu.be URLs
    const ytId = youTubeId(p.video_url);
    if (ytId) {
      return `<img src="https://img.youtube.com/vi/${ytId}/mqdefault.jpg" alt="" loading="lazy"
                   style="${s}"
                   onerror="this.style.background='#1a1a1a';this.removeAttribute('src')" />`;
    }
  }

  // 3. No thumbnail — dark placeholder with play icon
  return `<div style="${s}background:#111;display:flex;align-items:center;justify-content:center;">
            <span style="color:rgba(235,235,245,.3);font-size:1.4rem;">&#9654;</span>
          </div>`;
}

function escAdmin(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
(function init() {
  // Wire up media-type toggle (runs regardless of auth state)
  initUploadForm();

  const token = getToken();
  if (token) {
    // Verify token is still valid
    fetch('/api/admin/stats', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => {
        if (r.ok) return r.json().then(d => { showApp(localStorage.getItem('admin_email') || ''); updateUnreadBadge(d.unreadMessages); });
        clearToken(); showLogin();
      })
      .catch(() => { clearToken(); showLogin(); });
  } else {
    showLogin();
  }
})();
