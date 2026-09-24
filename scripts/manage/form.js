// form.js — forms generated from the shared schema. Values go in and out
// as plain data; the Worker validates again on save.

import { ENTITIES } from './schema.js';
import { h } from './dom.js';

let uid = 0;

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function widget(name, field, value, opt, onInput) {
  const id = `f${++uid}-${name}`;
  let input;
  let extra = null;
  const common = { id, name, oninput: onInput, onchange: onInput };
  const choices = opt.choices;
  if (field.type === 'enum' || field.type === 'ref' || choices) {
    const list = choices || field.values.map((v) => ({ value: v, label: (opt.labels && opt.labels[v]) || v }));
    input = h('select', common,
      field.required && !opt.allowBlank ? null : h('option', { value: '' }, opt.blankLabel || '—'),
      list.map((c) => h('option', { value: c.value, selected: c.value === value }, c.label)));
    if (value && !list.some((c) => c.value === value)) input.append(h('option', { value, selected: true }, opt.missingLabel || value));
  } else if (field.type === 'longtext') {
    input = h('textarea', { ...common, rows: opt.rows || 3, maxlength: field.max }, value || '');
  } else if (field.type === 'domains') {
    input = h('input', { ...common, type: 'text', value: (value || []).join(', '), autocapitalize: 'off', spellcheck: 'false', placeholder: 'brand.com, brand.co.jp' });
  } else {
    const type = { date: 'date', email: 'email', url: 'url', int: 'number', datetime: 'datetime-local' }[field.type] || 'text';
    const attrs = { ...common, type, value: field.type === 'datetime' ? toLocalInput(value) : value ?? '' };
    if (field.type === 'money') Object.assign(attrs, { inputmode: 'decimal', placeholder: '$' });
    if (field.type === 'text') attrs.maxlength = field.max;
    if (field.type === 'email' || field.type === 'url') Object.assign(attrs, { autocapitalize: 'off', spellcheck: 'false' });
    if (opt.datalist) attrs.list = `${id}-list`;
    input = h('input', attrs);
    if (opt.datalist) extra = h('datalist', { id: `${id}-list` }, opt.datalist.map((v) => h('option', { value: v })));
  }
  return { id, input, extra };
}

function readValue(field, input) {
  const raw = input.value;
  if (field.type === 'domains') return raw.split(/[\s,;]+/).filter(Boolean);
  if (raw === '') return null;
  if (field.type === 'datetime') return new Date(raw).toISOString();
  if (field.type === 'money') return Number(String(raw).replace(/[$,\s]/g, ''));
  if (field.type === 'int') return Number(raw);
  return raw;
}

// sections: [{ title, fields: ['name', …], wide: ['notes'] }]
// options:  { fieldName: { choices, datalist, labels, rows, hint, blankLabel, label } }
export function buildForm(entityName, record, sections, options = {}, { onChange } = {}) {
  const fields = ENTITIES[entityName].fields;
  const inputs = {};
  const errors = {};
  const initial = {};
  const form = h('form', { class: 'crm-form', novalidate: true, onsubmit: (e) => e.preventDefault() });

  for (const section of sections) {
    const grid = h('div', { class: 'crm-form-grid' });
    for (const name of section.fields) {
      const field = fields[name];
      const opt = options[name] || {};
      const value = record ? record[name] : opt.default ?? null;
      const { id, input, extra } = widget(name, field, value, opt, () => onChange && onChange(name));
      inputs[name] = input;
      initial[name] = JSON.stringify(readValue(field, input));
      const err = h('p', { class: 'crm-field-error', id: `${id}-err`, 'aria-live': 'polite' });
      errors[name] = err;
      input.setAttribute('aria-describedby', `${id}-err`);
      const wide = field.type === 'longtext' || (section.wide || []).includes(name);
      grid.append(h('div', { class: ['crm-field', wide && 'is-wide'], dataset: { field: name } },
        h('label', { for: id }, opt.label || field.label, field.required ? h('span', { class: 'crm-req', 'aria-hidden': 'true' }, ' *') : null),
        input, extra,
        opt.hint ? h('p', { class: 'crm-field-hint' }, opt.hint) : null,
        err));
    }
    form.append(section.title ? h('fieldset', { class: 'crm-fieldset' }, h('legend', {}, section.title), grid) : grid);
  }

  return {
    el: form,
    inputs,
    // All values (create) or just the changed ones (update)
    values({ changedOnly = false } = {}) {
      const out = {};
      for (const [name, input] of Object.entries(inputs)) {
        const v = readValue(fields[name], input);
        if (changedOnly && JSON.stringify(v) === initial[name]) continue;
        out[name] = v;
      }
      return out;
    },
    dirty() { return Object.keys(this.values({ changedOnly: true })).length > 0; },
    set(name, value) {
      const input = inputs[name];
      if (!input) return;
      input.value = value ?? '';
      input.dispatchEvent(new Event('change'));
    },
    showErrors(details) {
      Object.values(errors).forEach((e) => { e.textContent = ''; });
      Object.values(inputs).forEach((i) => i.removeAttribute('aria-invalid'));
      if (!details || typeof details !== 'object') return;
      let first = null;
      for (const [name, msg] of Object.entries(details)) {
        if (!errors[name]) continue;
        errors[name].textContent = String(msg);
        inputs[name].setAttribute('aria-invalid', 'true');
        first = first || inputs[name];
      }
      if (first) first.focus();
    },
  };
}
