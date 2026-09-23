// =====================================================================
// study-backup.js — shared persistence + backup helpers for the study tools
// (Kana Trainer, Kanji Trainer). ES module.
//
// Progress lives in localStorage. Browsers can still clear it (Safari may
// after ~7 days without a visit, and "clear site data" always does), so:
//   - ask the browser to keep it (navigator.storage.persist)
//   - make backups easy: one-click export, import that confirms first
//   - remind people when their last backup is old
// =====================================================================

// Ask the browser not to evict this site's storage. Resolves to true when
// storage is (now) persistent; false when refused or unsupported.
export async function requestPersistence() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

// Returns false when localStorage can't be written (private mode, full disk)
export function storageWorks() {
  try {
    const k = '__jareddesu_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileText(file) {
  if (file.text) return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

const DAY = 86400000;

function ago(ts) {
  const days = Math.floor((Date.now() - ts) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// One-line status for the Data section, plus whether to nudge a backup.
//   lastExportAt: ms timestamp or 0/undefined
//   reviewsSince: reviews done since that export (or ever, if none)
//   persisted:    result of requestPersistence()
export function backupStatus({ lastExportAt, reviewsSince, persisted }) {
  const saved = persisted
    ? 'Saved in this browser (protected from automatic clearing).'
    : 'Saved in this browser. Browsers can clear saved data, so keep a backup.';
  const last = lastExportAt ? `Last backup: ${ago(lastExportAt)}.` : 'No backup yet.';
  const stale = lastExportAt ? Date.now() - lastExportAt > 14 * DAY : true;
  const nudge = reviewsSince >= 50 && stale;
  return { text: `${saved} ${last}`, nudge };
}

// Human summary for the import confirmation
export function describeBackup({ exportedAt, reviews }) {
  const when = exportedAt ? new Date(exportedAt).toLocaleDateString() : 'an unknown date';
  return `a backup from ${when} (${reviews || 0} reviews)`;
}
