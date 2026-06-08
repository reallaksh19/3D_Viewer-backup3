const FLAG = '__xmlCiiPreviewStablePatch_v2';
const POPUP_SELECTOR = '.model-converters-workflow-popup-overlay .model-converters-workflow-popup';
const CFG_SELECTOR = '[data-option-key="supportConfigJson"]';
const PRIMARY = '#model-converters-primary-input';
const SECONDARY = '#model-converters-secondary-input';
const SKIP_WEIGHT_TYPES = /^(TEE|TEES|ELBO|ELBOW|OLET|BRANCH|DATUM|BEND|BENDS|GASK|GASKET|REDU|REDUCER)$/i;

function txt(v) { return v == null ? '' : String(v); }
function clean(v) { return txt(v).replace(/\s+/g, ' ').trim(); }
function esc(v) { return txt(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function canon(v) { return clean(v).toLowerCase().replace(/º/g, '°').replace(/³/g, '3').replace(/[_\-()[\]/|]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function norm(v) { return clean(v).toUpperCase().replace(/[\s_.\-\/()"'=]/g, ''); }
function local(el) { return clean(el?.localName || el?.nodeName).replace(/^.*:/, '').toLowerCase(); }
function kids(p, n) { return Array.from(p?.children || []).filter((el) => local(el) === n.toLowerCase()); }
function childText(p, n) { return clean(kids(p, n)[0]?.textContent); }
function previewRoot() { return document.querySelector(POPUP_SELECTOR) || document; }
function parsePoint(v) { const a = clean(v).match(/-?\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || []; return a.length >= 3 ? { x: a[0], y: a[1], z: a[2] } : null; }
function dist(a, b) { return a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Infinity; }
function psTags(v) { const out = []; for (const m of txt(v).matchAll(/\/?PS-\d+(?:\.\d+)?/gi)) { const t = m[0].toUpperCase().replace(/^\//, '').replace(/\.\d+$/, ''); if (!out.includes(t)) out.push(t); } return out; }
function refTokens(v) { const out = []; for (const m of txt(v).matchAll(/=?\b(\d{6,}\s*\/\s*\d+)\b/g)) { const t = m[1].replace(/\s+/g, ''); if (!out.includes(t)) out.push(t); } return out; }
function cfg() { try { return JSON.parse(document.querySelector(CFG_SELECTOR)?.value || '{}') || {}; } catch { return {}; } }
function rowVal(row, keys) { for (const k of (keys || []).filter(Boolean)) { if (row?.[k] != null && clean(row[k])) return txt(row[k]); if (row?._raw?.[k] != null && clean(row._raw[k])) return txt(row._raw[k]); } return ''; }
function num(v, last = false) { const a = clean(v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g) || []; return a.length ? a[last ? a.length - 1 : 0] : ''; }
function columnProbe(rows, key) { const samples = [key]; for (const r of (rows || []).slice(0, 14)) { const v = rowVal(r, [key]); if (v) samples.push(v); } return canon(samples.join(' | ')); }
function validMappedField(field, c) {
  const key = c.linelist?.fieldMap?.[field];
  if (!key) return false;
  const probe = columnProbe(c.linelist?.masterRows || [], key);
  if (field === 'p1') return /pressure/.test(probe) && !/(test\s*pressure|hydro|hydrostatic|proof|temp|temperature|density|fluid|line\s*(number|no)|piping\s*class)/.test(probe);
  if (field === 'lineKey2') return /line\s*(number|no\.?)/.test(probe) && !/(piping|construction|pipe)\s*class|\bspec\b/.test(probe);
  return true;
}
function lineKeyFromRow(row, c) {
  const fm = c.linelist?.fieldMap || {};
  const k1 = clean(rowVal(row, [fm.lineKey1, 'lineKey1', 'Key 1', 'Service']));
  const k2 = clean(rowVal(row, [fm.lineKey2, 'lineKey2', 'Key 2', 'Line number', 'Line Number']));
  const both = `${k1}${k2}`;
  if (both && !/^serviceline(number|no)?$/i.test(both) && !/pipingclass/i.test(both)) return both;
  return rowVal(row, [fm.lineNoKey, fm.lineNo, fm.lineSeqNo, 'lineNoKey', 'lineNo', 'lineKey', 'lineSeqNo', 'Line No', 'Line Number', 'ColumnX1']);
}
function findLineRow(lineKey, c) { const rows = Array.isArray(c.linelist?.masterRows) ? c.linelist.masterRows : []; return rows.find((r) => norm(lineKeyFromRow(r, c)) === norm(lineKey)) || null; }
function proc(lineKey, field, c, aliases = [], last = false) {
  const hydro = c.overrides?.processData?.[lineKey]?.hydroPressure || c.overrides?.processData?.[norm(lineKey)]?.hydroPressure;
  const override = c.overrides?.processData?.[lineKey]?.[field] || c.overrides?.processData?.[norm(lineKey)]?.[field];
  if (field !== 'p1' && clean(override)) return clean(override);
  if (field === 'p1' && clean(override) && (!hydro || num(override) !== num(hydro))) return clean(override);
  const r = findLineRow(lineKey, c);
  const fm = c.linelist?.fieldMap || {};
  if (field === 'p1' && !validMappedField('p1', c)) return '';
  const raw = rowVal(r, [fm[field], field, ...aliases]);
  return num(raw, last) || clean(raw);
}
async function xmlText() { const f = document.querySelector(PRIMARY)?.files?.[0]; return f ? f.text() : ''; }
async function stagedText() { const f = document.querySelector(SECONDARY)?.files?.[0]; return f ? f.text() : ''; }
function xmlNodeIndex(xml) {
  const doc = new DOMParser().parseFromString(txt(xml), 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  const out = [];
  for (const b of Array.from(doc.getElementsByTagName('*')).filter((e) => local(e) === 'branch')) {
    const branchName = childText(b, 'branchname');
    for (const n of kids(b, 'node')) out.push({
      branchName,
      nodeNumber: childText(n, 'nodenumber'),
      type: childText(n, 'componenttype'),
      pos: parsePoint(childText(n, 'position')),
      refs: refTokens(childText(n, 'componentrefno')),
      tags: psTags([childText(n, 'nodename'), childText(n, 'componentrefno'), childText(n, 'supporttag')].join(' ')),
      dtxr: childText(n, 'dtxr_pos') || childText(n, 'dtxr_ps'),
    });
  }
  return out;
}
function stagedIndex(json, c) {
  if (!clean(json)) return { byTag: new Map(), byRef: new Map(), byPos: [] };
  let data;
  try { data = JSON.parse(json); } catch { return { byTag: new Map(), byRef: new Map(), byPos: [] }; }
  const off = c.dtxrPositionOffset || {};
  const enabled = off.enabled !== false;
  const dx = Number.isFinite(Number(off.xOffset)) ? Number(off.xOffset) : 150500;
  const dy = Number.isFinite(Number(off.yOffset)) ? Number(off.yOffset) : 43000;
  const dz = Number.isFinite(Number(off.zOffset)) ? Number(off.zOffset) : 100000;
  const byTag = new Map();
  const byRef = new Map();
  const byPos = [];
  const add = (map, key, value) => { if (!key || !value) return; map.set(key, [...(map.get(key) || []), value]); };
  const walk = (x) => {
    if (!x || typeof x !== 'object') return;
    const a = x.attributes || x.attrs || x.ATTRIBUTES || {};
    const attrText = `${x.name || ''} ${x.label || ''} ${Object.entries(a).map(([k, v]) => `${k} ${v}`).join(' ')}`;
    const d = clean(a.DTXR || a.DESC || a.DESCRIPTION || a.NAME || x.name || x.label);
    for (const t of psTags(attrText)) add(byTag, t, d);
    for (const r of refTokens(attrText)) add(byRef, r, d);
    const p0 = parsePoint(a.POSI || a.POS || a.POSITION || a.POSITIONXYZ || x.position);
    if (d && p0) byPos.push({ dtxr: d, pos: enabled ? { x: p0.x + dx, y: p0.y + dy, z: p0.z + dz } : p0 });
    ['children', 'items', 'components'].forEach((k) => Array.isArray(x[k]) && x[k].forEach(walk));
  };
  Array.isArray(data) ? data.forEach(walk) : walk(data);
  return { byTag, byRef, byPos };
}
function dtxrForNode(branchName, nodeNo, nodes, staged, c) {
  const n = nodes.find((x) => norm(x.branchName) === norm(branchName) && clean(x.nodeNumber) === clean(nodeNo));
  if (!n) return '';
  if (n.dtxr) return n.dtxr;
  for (const r of n.refs || []) { const v = staged.byRef.get(r)?.filter(Boolean); if (v?.length) return [...new Set(v)].join('|'); }
  for (const t of n.tags || []) { const v = staged.byTag.get(t)?.filter(Boolean); if (v?.length) return [...new Set(v)].join('|'); }
  const tol = Math.max(Number(c.dtxrPositionOffset?.tolerance ?? c.coordinateTolerance ?? 1), 0.001);
  const hit = staged.byPos.find((e) => dist(n.pos, e.pos) <= tol);
  return hit?.dtxr || '';
}
function headers(table) { return Array.from(table.querySelectorAll(':scope > thead th')).map((th) => clean(th.textContent).replace(/Edit$/, '').trim()); }
function removeColumn(table, idx) { if (idx < 0) return; table.querySelectorAll(':scope > thead tr, :scope > tbody > tr').forEach((tr) => { const cells = Array.from(tr.children); if (cells[idx]) cells[idx].remove(); }); }
function removeHeaderColumns(table, predicate) { let hs = headers(table); for (let i = hs.length - 1; i >= 0; i--) if (predicate(hs[i], i)) removeColumn(table, i); }
function editable(field, lineKey, value) { return `<div class="mc-preview-stable-edit"><input data-xml-cii-stable-field="${esc(field)}" data-xml-cii-stable-linekey="${esc(lineKey)}" value="${esc(value)}" placeholder="—" style="width:84px;background:#182334;color:#e6edf5;border:1px solid #31455f;border-radius:4px;padding:4px 6px;"><button type="button" data-xml-cii-stable-fill="${esc(field)}" style="border:0;background:#223247;color:#9cc5ff;border-radius:3px;cursor:pointer;">↓</button></div>`; }
function save(lineKey, field, value) {
  const input = document.querySelector(CFG_SELECTOR);
  if (!input || !lineKey) return;
  const c = cfg();
  c.overrides = c.overrides && typeof c.overrides === 'object' ? c.overrides : {};
  c.overrides.processData = c.overrides.processData && typeof c.overrides.processData === 'object' ? c.overrides.processData : {};
  c.overrides.processData[lineKey] = { ...(c.overrides.processData[lineKey] || {}), [field]: clean(value) };
  const next = JSON.stringify(c, null, 2);
  if (input.value !== next) {
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
function bindEdits(table) {
  table.querySelectorAll('[data-xml-cii-stable-field]').forEach((inp) => {
    if (inp.dataset.bound) return;
    inp.dataset.bound = '1';
    const f = () => save(inp.dataset.xmlCiiStableLinekey, inp.dataset.xmlCiiStableField, inp.value);
    inp.addEventListener('change', f);
    inp.addEventListener('blur', f);
    inp.addEventListener('click', (e) => e.stopPropagation());
  });
  table.querySelectorAll('[data-xml-cii-stable-fill]').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const field = btn.dataset.xmlCiiStableFill;
      const src = btn.previousElementSibling;
      const val = clean(src?.value);
      if (!field || !val) return;
      table.querySelectorAll(`[data-xml-cii-stable-field="${CSS.escape(field)}"]`).forEach((inp) => {
        if (inp !== src) {
          inp.value = val;
          save(inp.dataset.xmlCiiStableLinekey, field, val);
        }
      });
    });
  });
}
function writeEditableCell(row, idx, field, lineKey, value) {
  if (idx < 0 || !row.children[idx]) return;
  const cell = row.children[idx];
  const focused = cell.contains(document.activeElement);
  if (focused) return;
  const currentInput = cell.querySelector(`[data-xml-cii-stable-field="${field}"]`);
  if (currentInput) {
    if (document.activeElement !== currentInput && currentInput.value !== clean(value)) currentInput.value = clean(value);
    return;
  }
  cell.innerHTML = editable(field, lineKey, clean(value));
}
function alignBranchPreview(table, c) {
  removeHeaderColumns(table, (h) => /^DTXR$/i.test(h));
  let hs = headers(table);
  const idx = (re) => hs.findIndex((h) => re.test(h));
  const lineIdx = idx(/^Line Key$/i);
  const t3Idx = idx(/^T3/i);
  let hydroIdx = idx(/^Hydro/i);
  if (hydroIdx < 0 && t3Idx >= 0) {
    const th = document.createElement('th');
    th.className = 'mc-preview-th';
    th.textContent = 'Hydro Test Pressure';
    table.querySelector(':scope > thead tr')?.children[t3Idx]?.insertAdjacentElement('afterend', th);
    table.querySelectorAll(':scope > tbody > tr.mc-preview-row').forEach((tr) => tr.children[t3Idx]?.insertAdjacentHTML('afterend', '<td class="mc-preview-td"></td>'));
    table.querySelectorAll('.mc-preview-node-cell').forEach((td) => td.setAttribute('colspan', String(Number(td.getAttribute('colspan') || hs.length) + 1)));
    hs = headers(table);
    hydroIdx = idx(/^Hydro/i);
  }
  const col = {
    materialCode: idx(/^Mat\. Code/i),
    p1: idx(/^P1/i),
    t1: idx(/^T1/i),
    t2: idx(/^T2/i),
    t3: idx(/^T3/i),
    hydroPressure: hydroIdx,
    density: idx(/^Density$/i),
    wallThickness: idx(/^Wall Thk/i),
    corrosion: idx(/^Corrosion/i),
  };
  table.querySelectorAll(':scope > tbody > tr.mc-preview-row').forEach((tr) => {
    const lineKey = clean(tr.children[lineIdx]?.textContent).replace(/^—$/, '');
    if (!lineKey) return;
    const hydro = proc(lineKey, 'hydroPressure', c, ['HydroPressure', 'Hydro Pressure', 'Hydro Test Pressure', 'Test Pressure'], true);
    const values = {
      materialCode: proc(lineKey, 'materialCode', c, ['MaterialCode', 'Material Code']),
      p1: proc(lineKey, 'p1', c, ['P1', 'Design Pressure', 'Operating Pressure']),
      t1: proc(lineKey, 't1', c, ['T1', 'Temp Max', 'Temperature Max']),
      t2: proc(lineKey, 't2', c, ['T2', 'Temp', 'Temperature']),
      t3: proc(lineKey, 't3', c, ['T3', 'Temp Min', 'Temperature Min'], true),
      hydroPressure: hydro,
      density: proc(lineKey, 'density', c, ['Density'], true) || proc(lineKey, 'densityMixed', c, ['Density Mixed', 'Mixed kg/m3', 'Mixed kg/m³'], true) || proc(lineKey, 'densityGas', c, ['Density Gas', 'Gas kg/m3', 'Gas kg/m³'], true) || proc(lineKey, 'densityLiquid', c, ['Density Liquid', 'Liquid kg/m3', 'Liquid kg/m³'], true),
      wallThickness: proc(lineKey, 'wallThickness', c, ['WallThickness', 'Wall Thickness']),
      corrosion: proc(lineKey, 'corrosion', c, ['Corrosion', 'CorrosionAllowance', 'Corrosion Allowance']),
    };
    Object.entries(col).forEach(([field, i]) => writeEditableCell(tr, i, field, lineKey, values[field] || ''));
  });
  bindEdits(table);
}
function alignNodeWeightTables(table, nodes, staged, c) {
  table.querySelectorAll('.mc-preview-node-table').forEach((nt) => {
    removeHeaderColumns(nt, (h) => /^DTXR$/i.test(h) || /^—$/.test(h));
    let hs = headers(nt);
    const lenIdx = hs.findIndex((h) => /^Length$/i.test(h));
    if (lenIdx < 0) return;
    const th = document.createElement('th');
    th.textContent = 'DTXR';
    nt.querySelector(':scope > thead tr')?.children[lenIdx]?.insertAdjacentElement('afterend', th);
    const branchRow = nt.closest('tr.mc-preview-node-row')?.previousElementSibling;
    const branchName = clean(branchRow?.querySelector('.mc-preview-branch')?.title || branchRow?.children[0]?.textContent || '').replace(/^…/, '');
    nt.querySelectorAll(':scope > tbody > tr').forEach((tr) => {
      const nodeNo = clean(tr.children[0]?.textContent);
      const type = clean(tr.children[1]?.textContent);
      if (Number(nodeNo) <= 0 || SKIP_WEIGHT_TYPES.test(type)) {
        tr.remove();
        return;
      }
      const value = dtxrForNode(branchName, nodeNo, nodes, staged, c);
      const td = document.createElement('td');
      td.className = 'mc-preview-node-dtxr';
      td.title = value;
      td.textContent = value || '—';
      tr.children[lenIdx]?.insertAdjacentElement('afterend', td);
    });
  });
}
async function patch() {
  const root = previewRoot();
  const table = root.querySelector('.mc-preview-table');
  if (!table) return;
  const c = cfg();
  const nodes = xmlNodeIndex(await xmlText());
  const staged = stagedIndex(await stagedText(), c);
  alignBranchPreview(table, c);
  alignNodeWeightTables(table, nodes, staged, c);
}
let timer = 0;
function schedule() { clearTimeout(timer); timer = setTimeout(() => patch().catch((e) => console.warn('XML->CII stable preview patch failed:', e)), 180); }
function scheduleBurst() { schedule(); setTimeout(schedule, 400); setTimeout(schedule, 1000); }
function installXmlCiiPreviewStablePatch() {
  window.installXmlCiiPreviewStablePatch = installXmlCiiPreviewStablePatch;
  if (window[FLAG]) return;
  window[FLAG] = true;
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', scheduleBurst, true);
  document.addEventListener('change', scheduleBurst, true);
  scheduleBurst();
}
installXmlCiiPreviewStablePatch();
