// schema.js — the sponsor CRM's data model, shared by the browser app and
// the Cloudflare Worker (workers/sponsor-crm), so both validate the same way.
// No private data lives here: only field names, types and generic lists.

export const STAGES = [
  'Researching', 'Pitched', 'Follow-up 1 sent', 'Follow-up 2 sent',
  'In conversation', 'Negotiating', 'Won', 'Delivered', 'Paid', 'Lost', 'No reply',
];
export const OPEN_STAGES = ['Pitched', 'Follow-up 1 sent', 'Follow-up 2 sent', 'In conversation', 'Negotiating'];
export const WON_STAGES = ['Won', 'Delivered', 'Paid'];
export const CLOSED_STAGES = ['Paid', 'Lost', 'No reply'];

export const SOURCES = ['Cold', 'Warm', 'Inbound', 'Renewal'];
export const FITS = ['High', 'Medium', 'Low'];
export const CONTACT_METHODS = ['email', 'form'];
export const VIDEO_STATUSES = ['open', 'pitched', 'booked', 'sponsor_free'];
export const VIDEO_STATUS_LABELS = { open: 'Open', pitched: 'Pitched', booked: 'Booked', sponsor_free: 'Sponsor-free' };
export const VIDEO_FORMATS = ['guide', 'milestone', 'story', 'other'];
export const ACTIVITY_KINDS = ['note', 'call', 'meeting', 'form', 'email', 'system'];

// Starting category list; the app keeps the editable list in settings
export const DEFAULT_CATEGORIES = [
  'Tutoring & lessons', 'E-books, manga & import', 'Japan travel', 'Study abroad & schools',
  'Learning apps', 'Keyboards & desk', 'Snack boxes', 'VPN', 'Learning & creator tools', 'Other',
];

const text = (label, max = 200, extra = {}) => ({ type: 'text', label, max, ...extra });
const long = (label, max = 5000) => ({ type: 'longtext', label, max });
const date = (label) => ({ type: 'date', label });
const money = (label, extra = {}) => ({ type: 'money', label, ...extra });
const oneOf = (label, values, extra = {}) => ({ type: 'enum', label, values, ...extra });
const ref = (label, entity, extra = {}) => ({ type: 'ref', label, entity, ...extra });

// Each entity: its D1 table and the fields a client may write.
// `virtual` fields are stored elsewhere (company domains live in their own table).
export const ENTITIES = {
  companies: {
    table: 'companies', label: 'Company',
    fields: {
      name: text('Name', 120, { required: true }),
      domains: { type: 'domains', label: 'Email domains', virtual: true },
      category: text('Category', 60),
      fit: oneOf('Fit', FITS),
      website: { type: 'url', label: 'Website' },
      contact_method: oneOf('Contact method', CONTACT_METHODS),
      form_url: { type: 'url', label: 'Web form URL' },
      notes: long('Notes'),
    },
  },
  contacts: {
    table: 'contacts', label: 'Contact',
    fields: {
      company_id: ref('Company', 'companies', { required: true }),
      name: text('Name', 120),
      email: { type: 'email', label: 'Email' },
      role: text('Role', 120),
      notes: long('Notes', 2000),
    },
  },
  deals: {
    table: 'deals', label: 'Deal',
    fields: {
      company_id: ref('Company', 'companies', { required: true }),
      contact_id: ref('Contact', 'contacts'),
      source: oneOf('Source', SOURCES),
      package: text('Package', 80),
      video_id: ref('Video slot', 'videos'),
      slot_note: text('Slot note', 200),
      stage: oneOf('Stage', STAGES, { required: true }),
      pitched_on: date('Pitched on'),
      replied_on: date('Replied on'),
      quoted: money('Quoted ($)'),
      final: money('Final ($)'),
      publish_date: date('Publish date'),
      deliverables: long('Deliverables', 2000),
      usage_rights: long('Usage rights', 1000),
      exclusivity: long('Exclusivity', 1000),
      next_action: text('Next action', 300),
      next_action_date: date('Next action date'),
      lost_reason: text('Lost reason', 300),
      notes: long('Notes'),
    },
  },
  payments: {
    table: 'payments', label: 'Payment',
    fields: {
      deal_id: ref('Deal', 'deals', { required: true }),
      amount: money('Amount ($)', { required: true }),
      invoiced_on: date('Invoiced on'),
      paid_on: date('Paid on'),
      method: text('Method', 60),
      fees: money('Fees ($)'),
      net: money('Net ($)'),
      notes: long('Notes', 1000),
    },
  },
  videos: {
    table: 'videos', label: 'Video',
    fields: {
      title: text('Title', 200, { required: true }),
      publish_date: date('Publish date'),
      format: oneOf('Format', VIDEO_FORMATS),
      sponsor_status: oneOf('Sponsor status', VIDEO_STATUSES),
      youtube_id: text('YouTube ID', 20, { pattern: /^[A-Za-z0-9_-]{6,20}$/ }),
      notes: long('Notes', 2000),
    },
  },
  rate_card: {
    table: 'rate_card', label: 'Package',
    fields: {
      package: text('Package', 80, { required: true }),
      standard: money('Standard ($)'),
      floor: money('Floor ($)'),
      included: long('What’s included', 1000),
      notes: long('Notes', 1000),
      sort: { type: 'int', label: 'Order', min: 0, max: 999 },
    },
  },
  activities: {
    table: 'activities', label: 'Activity',
    fields: {
      company_id: ref('Company', 'companies'),
      deal_id: ref('Deal', 'deals'),
      kind: oneOf('Kind', ACTIVITY_KINDS.filter((k) => k !== 'system'), { required: true }),
      occurred_at: { type: 'datetime', label: 'When' },
      title: text('Title', 200),
      body: long('Details', 5000),
    },
  },
};

// --- Validation ---------------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const DOMAIN = /^(?=.{3,190}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export const isUuid = (v) => typeof v === 'string' && UUID.test(v);

export function isIsoDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// "https://www.Brand.com/x", "@brand.com", "brand.com" -> "brand.com"
export function normalizeDomain(v) {
  let s = String(v || '').trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^.*@/, '').replace(/[/?#].*$/, '').replace(/^www\./, '');
  return DOMAIN.test(s) ? s : null;
}

function clean(field, raw) {
  if (raw === undefined) return { skip: true };
  const blank = raw === null || (typeof raw === 'string' && raw.trim() === '');
  if (blank) {
    if (field.type === 'domains') return { value: [] };
    return field.required ? { error: 'is required' } : { value: null };
  }
  switch (field.type) {
    case 'text':
    case 'longtext': {
      if (typeof raw !== 'string' && typeof raw !== 'number') return { error: 'must be text' };
      const s = String(raw).trim().replace(/\u0000/g, '');
      if (s.length > field.max) return { error: `must be ${field.max} characters or fewer` };
      if (field.type === 'text' && /[\r\n]/.test(s)) return { value: s.replace(/\s*[\r\n]+\s*/g, ' ') };
      if (field.pattern && !field.pattern.test(s)) return { error: 'has an invalid format' };
      return { value: s };
    }
    case 'email': {
      const s = String(raw).trim().toLowerCase();
      return EMAIL.test(s) && s.length <= 254 ? { value: s } : { error: 'must be an email address' };
    }
    case 'url': {
      const s = String(raw).trim();
      if (s.length > 500) return { error: 'is too long' };
      try {
        const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'must be a web address' };
        return { value: u.href };
      } catch { return { error: 'must be a web address' }; }
    }
    case 'date':
      return isIsoDate(raw) ? { value: raw } : { error: 'must be a date (YYYY-MM-DD)' };
    case 'datetime': {
      const d = new Date(raw);
      if (typeof raw !== 'string' || Number.isNaN(d.getTime())) return { error: 'must be a date and time' };
      return { value: d.toISOString() };
    }
    case 'money': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[$,\s]/g, ''));
      if (!Number.isFinite(n) || n < 0 || n > 10000000) return { error: 'must be an amount' };
      return { value: Math.round(n * 100) / 100 };
    }
    case 'int': {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < (field.min ?? -1e9) || n > (field.max ?? 1e9)) return { error: 'must be a whole number' };
      return { value: n };
    }
    case 'enum':
      return field.values.includes(raw) ? { value: raw } : { error: `must be one of: ${field.values.join(', ')}` };
    case 'ref':
      return isUuid(raw) ? { value: raw.toLowerCase() } : { error: 'must be a record ID' };
    case 'domains': {
      const list = Array.isArray(raw) ? raw : String(raw).split(/[\s,;]+/);
      if (list.length > 20) return { error: 'has too many domains' };
      const out = [];
      for (const d of list) {
        if (d === '' || d == null) continue;
        const n = normalizeDomain(d);
        if (!n) return { error: `has an invalid domain: ${String(d).slice(0, 60)}` };
        if (!out.includes(n)) out.push(n);
      }
      return { value: out };
    }
    default:
      return { error: 'is not writable' };
  }
}

// Validate a create (partial = false) or an update (partial = true).
// Unknown keys are rejected, so a client can only touch listed fields.
export function validate(entityName, input, { partial = false } = {}) {
  const entity = ENTITIES[entityName];
  if (!entity) return { ok: false, errors: { _: 'Unknown record type' } };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: { _: 'Expected an object' } };
  const errors = {};
  const values = {};
  for (const key of Object.keys(input)) {
    if (key === 'id') continue;
    if (!entity.fields[key]) errors[key] = 'is not a field you can set';
  }
  for (const [key, field] of Object.entries(entity.fields)) {
    if (partial && input[key] === undefined) continue;
    const r = clean(field, input[key]);
    if (r.skip) { if (field.required && !partial) errors[key] = 'is required'; continue; }
    if (r.error) errors[key] = `${field.label} ${r.error}`;
    else values[key] = r.value;
  }
  if (input.id !== undefined && !isUuid(input.id)) errors.id = 'ID must be a UUID';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values };
}
