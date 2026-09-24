// uploads.js — the channel's real YouTube uploads, linked to planned video
// slots and sponsor deals for record-keeping. Drag an upload onto a video
// (desktop) or use "Assign…" (anywhere, including phones).

import { h, fmtDate } from './dom.js';
import { api } from './api.js';
import { store, reload, live, companyName, dealTitle } from './store.js';
import { button, busy, toast, toastError } from './ui.js';

const cache = { uploads: null, fetchedAt: null, loading: null };
const fmtViews = (n) => (n == null ? '' : `${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)} views`);
const fmtLen = (s) => (s == null ? '' : s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
export const isShort = (u) => u.duration_s != null && u.duration_s <= 180;

export function loadUploads({ force = false } = {}) {
  if (cache.uploads && !force) return Promise.resolve(cache.uploads);
  if (!cache.loading) {
    cache.loading = (force ? api.refreshUploads() : api.uploads())
      .then((r) => { cache.uploads = r.uploads; cache.fetchedAt = r.fetchedAt || (r.uploads[0] && r.uploads[0].fetched_at) || null; return cache.uploads; })
      .finally(() => { cache.loading = null; });
  }
  return cache.loading;
}
export const uploadById = (id) => (cache.uploads || []).find((u) => u.youtube_id === id);
const videoFor = (ytId) => live(store.state.videos).find((v) => v.youtube_id === ytId);
const uploadDate = (u) => (u.published_at ? u.published_at.slice(0, 10) : null);

// --- Linking --------------------------------------------------------------------------------
async function withUndo(label, doIt, undo) {
  await doIt();
  await reload();
  toast(label, { action: 'Undo', onAction: async () => { try { await undo(); await reload(); } catch (err) { toastError(err); } } });
}

export async function linkToVideo(u, video) {
  const other = videoFor(u.youtube_id);
  if (other && other.id === video.id) return;
  if (other && !window.confirm(`This upload is linked to "${other.title}". Move the link to "${video.title}"?`)) return;
  const prev = { youtube_id: video.youtube_id || null, publish_date: video.publish_date || null };
  const next = { youtube_id: u.youtube_id };
  if (!video.publish_date && uploadDate(u)) next.publish_date = uploadDate(u);
  await withUndo(`Linked to “${video.title}”`, async () => {
    if (other) await api.update('videos', other.id, { youtube_id: null });
    await api.update('videos', video.id, next);
  }, async () => {
    await api.update('videos', video.id, prev);
    if (other) await api.update('videos', other.id, { youtube_id: u.youtube_id });
  });
}

async function newVideoFrom(u, extra = {}) {
  return api.create('videos', {
    title: u.title.slice(0, 200), publish_date: uploadDate(u), youtube_id: u.youtube_id,
    format: isShort(u) ? 'other' : 'guide', sponsor_status: 'open', ...extra,
  });
}

export async function linkToDeal(u, d) {
  const existing = d.video_id && store.byId.videos.get(d.video_id);
  if (existing) return linkToVideo(u, existing);
  const other = videoFor(u.youtube_id);
  if (other) {
    // The upload already has a video record: point the deal at it
    const prev = { video_id: d.video_id || null, publish_date: d.publish_date || null };
    await withUndo(`${companyName(d.company_id)} linked to “${other.title}”`,
      () => api.update('deals', d.id, { video_id: other.id, publish_date: d.publish_date || other.publish_date || null }),
      () => api.update('deals', d.id, prev));
    return;
  }
  // A planned slot published within 3 days of the upload is the same video
  const ud = uploadDate(u);
  const near = ud ? live(store.state.videos).filter((v) => !v.youtube_id && v.publish_date
    && Math.abs((new Date(v.publish_date) - new Date(ud)) / 86400000) <= 3) : [];
  if (near.length === 1) {
    const slot = near[0];
    const prevDeal = { video_id: d.video_id || null, publish_date: d.publish_date || null };
    const prevSlot = { youtube_id: null, sponsor_status: slot.sponsor_status || null };
    await withUndo(`${companyName(d.company_id)} linked to “${slot.title}”`, async () => {
      await api.update('videos', slot.id, { youtube_id: u.youtube_id, sponsor_status: 'booked' });
      await api.update('deals', d.id, { video_id: slot.id, publish_date: d.publish_date || slot.publish_date });
    }, async () => {
      await api.update('deals', d.id, prevDeal);
      await api.update('videos', slot.id, prevSlot);
    });
    return;
  }
  let created = null;
  const prev = { video_id: d.video_id || null, publish_date: d.publish_date || null };
  await withUndo(`${companyName(d.company_id)} linked to “${u.title}”`, async () => {
    created = await newVideoFrom(u, { sponsor_status: 'booked' });
    await api.update('deals', d.id, { video_id: created.id, publish_date: d.publish_date || uploadDate(u) });
  }, async () => {
    await api.update('deals', d.id, prev);
    if (created) await api.archive('videos', created.id, true);
  });
}

export async function unlink(u) {
  const v = videoFor(u.youtube_id);
  if (!v) return;
  await withUndo(`Unlinked from “${v.title}”`, () => api.update('videos', v.id, { youtube_id: null }), () => api.update('videos', v.id, { youtube_id: u.youtube_id }));
}

// --- Assign dialog -------------------------------------------------------------------------------
export function assignDialog(u) {
  const dlg = h('dialog', { class: 'crm-dialog', 'aria-labelledby': 'crm-assign-title' });
  const close = () => { dlg.close(); dlg.remove(); };
  const videos = live(store.state.videos).sort((a, b) => (a.publish_date || '9999').localeCompare(b.publish_date || '9999'));
  const deals = live(store.state.deals).filter((d) => !['Lost', 'No reply'].includes(d.stage)).sort((a, b) => dealTitle(a).localeCompare(dealTitle(b)));
  const vSel = h('select', { 'aria-label': 'Video slot' }, h('option', { value: '' }, 'Choose a planned video…'),
    videos.map((v) => h('option', { value: v.id }, `${v.publish_date ? `${fmtDate(v.publish_date)} · ` : ''}${v.title}${v.youtube_id ? ' (linked)' : ''}`)));
  const dSel = h('select', { 'aria-label': 'Deal' }, h('option', { value: '' }, 'Choose a sponsor deal…'),
    deals.map((d) => h('option', { value: d.id }, `${dealTitle(d)} · ${d.stage}`)));
  const run = (fn) => async () => { try { close(); await fn(); } catch (err) { toastError(err); } };
  dlg.append(
    h('h2', { id: 'crm-assign-title' }, 'Assign upload'),
    h('p', { class: 'crm-note' }, u.title),
    h('label', { class: 'crm-field' }, 'To a planned video', vSel),
    h('div', { class: 'crm-row-actions' }, button('Link to video', run(() => { const v = store.byId.videos.get(vSel.value); if (v) return linkToVideo(u, v); return null; }), { kind: 'primary' })),
    h('label', { class: 'crm-field' }, 'Or to a sponsor deal', dSel),
    h('div', { class: 'crm-row-actions' }, button('Link to deal', run(() => { const d = store.byId.deals.get(dSel.value); if (d) return linkToDeal(u, d); return null; }))),
    h('div', { class: 'crm-row-actions' },
      videoFor(u.youtube_id) ? null : button('Add as a new video', run(async () => { await newVideoFrom(u); await reload(); toast('Added to Videos', { kind: 'ok', ms: 2500 }); })),
      videoFor(u.youtube_id) ? button('Unlink', run(() => unlink(u))) : null,
      button('Cancel', close)));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dlg);
  dlg.showModal();
}

// --- Upload list ------------------------------------------------------------------------------------
const state = { q: '', filter: 'all' };

export function uploadsPanel() {
  const box = h('section', { class: 'crm-uploads', 'aria-label': 'YouTube uploads' });
  const listEl = h('ul', { class: 'crm-upload-list' });
  const meta = h('p', { class: 'crm-note is-muted' });
  const refresh = button('Refresh from YouTube', async () => {
    try { await busy(refresh, () => loadUploads({ force: true })); draw(); toast('Uploads refreshed', { kind: 'ok', ms: 2500 }); } catch { /* toast shown */ }
  }, { kind: 'chip' });
  const search = h('input', { type: 'search', class: 'crm-search', placeholder: 'Search uploads', 'aria-label': 'Search uploads', value: state.q, oninput: (e) => { state.q = e.target.value; draw(); } });
  const filter = h('select', { class: 'crm-filter', 'aria-label': 'Show', onchange: (e) => { state.filter = e.target.value; draw(); } },
    [['all', 'All uploads'], ['unlinked', 'Not linked'], ['long', 'Long-form'], ['shorts', 'Shorts']].map(([v, l]) => h('option', { value: v, selected: state.filter === v }, l)));

  function card(u) {
    const v = videoFor(u.youtube_id);
    const sponsors = v ? live(store.state.deals).filter((d) => d.video_id === v.id).map((d) => companyName(d.company_id)) : [];
    const li = h('li', { class: ['crm-upload', v && 'is-linked'], draggable: 'true', dataset: { yt: u.youtube_id } },
      u.thumbnail ? h('img', { src: u.thumbnail, alt: '', loading: 'lazy', width: 120, height: 68, class: 'crm-upload-thumb' }) : h('span', { class: 'crm-upload-thumb is-empty' }),
      h('div', { class: 'crm-upload-main' },
        h('a', { href: `https://www.youtube.com/watch?v=${encodeURIComponent(u.youtube_id)}`, target: '_blank', rel: 'noopener noreferrer', class: 'crm-upload-title', draggable: 'false' }, u.title),
        h('p', { class: 'crm-upload-meta' }, [uploadDate(u) ? fmtDate(uploadDate(u), { year: true }) : null, fmtLen(u.duration_s), isShort(u) ? 'Short' : null, fmtViews(u.views)].filter(Boolean).join(' · ')),
        v ? h('p', { class: 'crm-upload-link' }, `→ ${v.title}${sponsors.length ? ` · ${sponsors.join(', ')}` : ''}`) : null),
      button(v ? 'Change…' : 'Assign…', () => assignDialog(u), { kind: 'chip' }));
    li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-youtube-id', u.youtube_id); e.dataTransfer.effectAllowed = 'link'; document.body.classList.add('is-dragging-upload'); });
    li.addEventListener('dragend', () => document.body.classList.remove('is-dragging-upload'));
    return li;
  }

  function draw() {
    const all = cache.uploads || [];
    const shown = all.filter((u) => (!state.q || u.title.toLowerCase().includes(state.q.toLowerCase()))
      && (state.filter === 'all' || (state.filter === 'unlinked' && !videoFor(u.youtube_id)) || (state.filter === 'long' && !isShort(u)) || (state.filter === 'shorts' && isShort(u))));
    meta.textContent = all.length
      ? `${all.length} uploads${cache.fetchedAt ? `, updated ${new Date(cache.fetchedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}. Drag one onto a video, or use Assign.`
      : 'No uploads loaded yet. Refresh from YouTube to fetch them.';
    listEl.replaceChildren(...shown.slice(0, 200).map(card));
  }

  box.append(
    h('div', { class: 'crm-section-head' }, h('h2', { class: 'crm-section-title' }, 'Uploads'), refresh),
    meta, h('div', { class: 'crm-toolbar' }, search, filter), listEl);
  loadUploads().then(draw).catch((err) => { meta.textContent = err.message; });
  draw();
  return { el: box, redraw: draw };
}

// Make an element accept dropped uploads
export function dropTarget(el, onUpload) {
  el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-youtube-id')) { e.preventDefault(); el.classList.add('is-drop'); } });
  el.addEventListener('dragleave', () => el.classList.remove('is-drop'));
  el.addEventListener('drop', async (e) => {
    const id = e.dataTransfer.getData('text/x-youtube-id');
    el.classList.remove('is-drop');
    if (!id) return;
    e.preventDefault();
    const u = uploadById(id);
    if (u) { try { await onUpload(u); } catch (err) { toastError(err); } }
  });
}
