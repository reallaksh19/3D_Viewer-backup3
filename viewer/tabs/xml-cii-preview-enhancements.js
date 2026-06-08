const FLAG = '__xmlCiiPreviewEnhancements_v1';
const INPUT_SELECTOR = '[data-option-key="supportConfigJson"]';
const POPUP_SELECTOR = '.model-converters-workflow-popup-overlay .model-converters-workflow-popup';
const SKIP_WEIGHT_TYPES = /^(TEE|TEES|ELBO|ELBOW|OLET|BRANCH|DATUM|BEND|BENDS|GASK|GASKET|REDU|REDUCER)$/i;

function text(value) { return value == null ? '' : String(value); }
function clean(value) { return text(value).replace(/\s+/g, ' ').trim(); }
function esc(value) { return text(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function norm(value) { return clean(value).toUpperCase().replace(/[\s_.\-\/()"']/g, ''); }
function popup() { return document.querySelector(POPUP_SELECTOR); }
function localName(el) { return clean(el?.localName || el?.nodeName).replace(/^.*:/, '').toLowerCase(); }
function childrenByName(parent, name) { return Array.from(parent?.children || []).filter((el) => localName(el) === name.toLowerCase()); }
function firstText(parent, name) { return clean(childrenByName(parent, name)[0]?.textContent); }
function parseConfig() {
  const input = document.querySelector(INPUT_SELECTOR);
  if (!input) return { input: null, cfg: null };
  try {
    const cfg = JSON.parse(input.value || '{}') || {};
    cfg.overrides = cfg.overrides && typeof cfg.overrides === 'object' ? cfg.overrides : {};
    cfg.overrides.processData = cfg.overrides.processData && typeof cfg.overrides.processData === 'object' ? cfg.overrides.processData : {};
    return { input, cfg };
  } catch { return { input, cfg: null }; }
}
function writeConfig(input, cfg) {
  const next = JSON.stringify(cfg, null, 2);
  if (input.value === next) return;
  input.value = next;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
function rowValue(row, keys) {
  for (const key of (keys || []).filter(Boolean)) {
    if (row?.[key] != null && clean(row[key]) !== '') return text(row[key]);
    if (row?._raw?.[key] != null && clean(row._raw[key]) !== '') return text(row._raw[key]);
  }
  return '';
}
async function currentXmlText() {
  if (window.__xmlCiiLastXmlText) return window.__xmlCiiLastXmlText;
  for (const input of Array.from(document.querySelectorAll('input[type="file"]'))) {
    if (input.matches('[data-xml-cii-import-master]')) continue;
    const file = input.files?.[0];
    if (file && /\.xml$/i.test(file.name || '')) return file.text();
  }
  return '';
}
async function currentStagedText() {
  for (const input of Array.from(document.querySelectorAll('input[type="file"]'))) {
    if (input.matches('[data-xml-cii-import-master]')) continue;
    const file = input.files?.[0];
    if (file && /\.(json|txt)$/i.test(file.name || '')) return file.text();
  }
  return '';
}
function parsePoint(value) {
  const nums = clean(value).match(/-?\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  return nums.length >= 3 ? { x: nums[0], y: nums[1], z: nums[2] } : null;
}
function dist(a, b) { return a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Infinity; }
function branchNodes(xmlText) {
  const doc = new DOMParser().parseFromString(text(xmlText), 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  const out = [];
  for (const branch of Array.from(doc.getElementsByTagName('*')).filter((el) => localName(el) === 'branch')) {
    const branchName = firstText(branch, 'branchname') || clean(branch.getAttribute?.('branchname') || branch.getAttribute?.('name'));
    for (const node of childrenByName(branch, 'node')) {
      out.push({
        branchName,
        nodeNumber: firstText(node, 'nodenumber'),
        componentType: firstText(node, 'componenttype'),
        position: firstText(node, 'position'),
        dtxr: firstText(node, 'dtxr_pos') || firstText(node, 'dtxr_ps'),
      });
    }
  }
  return out;
}
function stagedEntriesFromJson(stagedText) {
  if (!clean(stagedText)) return [];
  let parsed;
  try { parsed = JSON.parse(stagedText); } catch { return []; }
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    const attrs = node.attributes || node.attrs || node.ATTRIBUTES || {};
    const dtxr = clean(attrs.DTXR || attrs.DESC || attrs.DESCRIPTION || attrs.NAME || node.name || node.label);
    const posRaw = attrs.POSI || attrs.POS || attrs.POSITION || attrs.POSITIONXYZ || node.position;
    const pos = parsePoint(Array.isArray(posRaw) ? posRaw.join(' ') : posRaw);
    if (dtxr && pos) out.push({ dtxr, pos });
    for (const key of ['children', 'items', 'components']) if (Array.isArray(node[key])) node[key].forEach(walk);
  };
  if (Array.isArray(parsed)) parsed.forEach(walk); else walk(parsed);
  return out;
}
function lineKeyForBranch(branchName, cfg) {
  const ll = cfg?.linelist || {};
  const tokens = clean(branchName).replace(/^\/+/, '').replace(/\/B\d+$/i, '').split(ll.tokenDelimiter || '-').map((p) => p.trim()).filter(Boolean);
  const positions = Array.isArray(ll.lineKeyTokenPositions) ? ll.lineKeyTokenPositions : text(ll.lineKeyTokenPositions || '4').split(/[,+]/).map((x) => Number(x.trim())).filter(Boolean);
  return positions.map((p) => tokens[Math.round(p) - 1] || '').filter(Boolean).join(text(ll.lineKeyJoiner || '')) || tokens[3] || '';
}
function dtxrForBranch(branchName, xmlNodes, stagedEntries) {
  const branchXmlNodes = xmlNodes.filter((node) => norm(node.branchName) === norm(branchName));
  const direct = branchXmlNodes.map((node) => node.dtxr).filter(Boolean)[0];
  if (direct) return direct;
  for (const node of branchXmlNodes) {
    const p = parsePoint(node.position);
    if (!p) continue;
    const match = stagedEntries.find((entry) => dist(p, entry.pos) <= 1.0);
    if (match) return match.dtxr;
  }
  return '';
}
function dtxrForNode(branchName, nodeNumber, xmlNodes, stagedEntries) {
  const node = xmlNodes.find((n) => norm(n.branchName) === norm(branchName) && clean(n.nodeNumber) === clean(nodeNumber));
  if (!node) return '';
  if (node.dtxr) return node.dtxr;
  const p = parsePoint(node.position);
  if (!p) return '';
  const match = stagedEntries.find((entry) => dist(p, entry.pos) <= 1.0);
  return match?.dtxr || '';
}
function saveProcessValue(lineKey, field, value) {
  const { input, cfg } = parseConfig();
  if (!input || !cfg || !lineKey) return;
  cfg.overrides.processData[lineKey] = { ...(cfg.overrides.processData[lineKey] || {}), [field]: clean(value) };
  if (field === 'wallThickness' || field === 'corrosion') updatePipingMasterRows(cfg, lineKey, field, clean(value));
  writeConfig(input, cfg);
}
function updatePipingMasterRows(cfg, lineKey, field, value) {
  const rows = Array.isArray(cfg.pipingClass?.masterRows) ? cfg.pipingClass.masterRows : [];
  if (!rows.length || !value) return;
  for (const row of rows) {
    const spec = rowValue(row, ['Piping Class', 'pipingClass', 'PIPING_CLASS', '_specwisePipingClassKey']);
    if (spec && norm(lineKey).includes(norm(spec))) {
      if (field === 'wallThickness') row.wallThickness = row['Wall thickness'] = value;
      if (field === 'corrosion') row.corrosion = row.Corrosion = value;
    }
  }
}
function inputHtml(field, lineKey, value) {
  return `<div class="mc-preview-pd-cell ${clean(value) ? 'mc-preview-pd-override' : 'mc-preview-pd-empty'}" style="display:flex;gap:2px;align-items:center;">
    <input type="text" data-xml-cii-preview-edit="${esc(field)}" data-xml-cii-preview-linekey="${esc(lineKey)}" value="${esc(value)}" placeholder="—" style="width:84px;background:#182334;color:#e6edf5;border:1px solid #31455f;border-radius:4px;padding:4px 6px;">
    <button type="button" data-xml-cii-preview-filldown="${esc(field)}" data-xml-cii-preview-linekey="${esc(lineKey)}" style="border:0;background:#223247;color:#9cc5ff;border-radius:3px;cursor:pointer;">↓</button>
  </div>`;
}
function makeEditable(td, field, lineKey, value) {
  if (!td || td.querySelector('[data-xml-cii-preview-edit]')) return;
  td.innerHTML = inputHtml(field, lineKey, clean(value).replace(/^—$/, ''));
}
async function enhancePreviewTable() {
  const active = popup();
  const table = active?.querySelector('.mc-preview-table');
  if (!table) return;
  const { cfg } = parseConfig();
  if (!cfg) return;
  const headers = Array.from(table.querySelectorAll('thead th')).map((th) => clean(th.textContent).replace(/Edit$/, '').trim());
  const ratingIdx = headers.findIndex((h) => /^Rating$/i.test(h));
  const lineKeyIdx = headers.findIndex((h) => /^Line Key$/i.test(h));
  const branchIdx = headers.findIndex((h) => /^Branch Name$/i.test(h));
  const matIdx = headers.findIndex((h) => /^Mat\. Code$/i.test(h));
  const p1Idx = headers.findIndex((h) => /^P1/i.test(h));
  const t1Idx = headers.findIndex((h) => /^T1/i.test(h));
  const t2Idx = headers.findIndex((h) => /^T2/i.test(h));
  const t3Idx = headers.findIndex((h) => /^T3/i.test(h));
  const hydroIdx = headers.findIndex((h) => /^Hydro/i.test(h));
  const densityIdx = headers.findIndex((h) => /^Density$/i.test(h));
  const wallIdx = headers.findIndex((h) => /^Wall Thk/i.test(h));
  const corrIdx = headers.findIndex((h) => /^Corrosion/i.test(h));

  const xmlText = await currentXmlText();
  const stagedText = await currentStagedText();
  const xmlNodes = branchNodes(xmlText);
  const staged = stagedEntriesFromJson(stagedText);

  if (ratingIdx >= 0 && !headers.some((h) => /^DTXR$/i.test(h))) {
    const th = document.createElement('th');
    th.className = 'mc-preview-th';
    th.textContent = 'DTXR';
    table.querySelector('thead tr')?.children[ratingIdx]?.insertAdjacentElement('afterend', th);
    table.querySelectorAll('tbody tr.mc-preview-row').forEach((tr) => {
      const cells = Array.from(tr.children);
      const branchName = clean(cells[branchIdx]?.getAttribute('title') || cells[branchIdx]?.textContent || '').replace(/^…/, '');
      const td = document.createElement('td');
      td.className = 'mc-preview-td mc-preview-dtxr';
      const value = dtxrForBranch(branchName, xmlNodes, staged);
      td.title = value;
      td.textContent = value || '—';
      cells[ratingIdx]?.insertAdjacentElement('afterend', td);
    });
    table.querySelectorAll('.mc-preview-node-row .mc-preview-node-cell').forEach((td) => {
      const colspan = Number(td.getAttribute('colspan') || 0);
      if (Number.isFinite(colspan) && colspan > 0) td.setAttribute('colspan', String(colspan + 1));
    });
  }

  table.querySelectorAll('tbody tr.mc-preview-row').forEach((tr) => {
    const cells = Array.from(tr.children);
    const lineKey = clean(cells[lineKeyIdx]?.textContent).replace(/^—$/, '');
    if (!lineKey) return;
    const process = cfg.overrides?.processData?.[lineKey] || {};
    const editable = [
      [matIdx, 'materialCode'], [p1Idx, 'p1'], [t1Idx, 't1'], [t2Idx, 't2'], [t3Idx, 't3'],
      [hydroIdx, 'hydroPressure'], [densityIdx, 'density'], [wallIdx, 'wallThickness'], [corrIdx, 'corrosion'],
    ];
    editable.forEach(([idx, field]) => {
      if (idx < 0) return;
      const cell = Array.from(tr.children)[idx];
      const existingInput = cell?.querySelector('input');
      if (existingInput) return;
      let value = process[field] || clean(cell?.textContent).replace(/↓/g, '').replace(/^—$/, '');
      if (field === 'materialCode') {
        const editableVal = cell?.querySelector?.('.mc-preview-editable-val')?.textContent;
        value = process.materialCode || editableVal || value;
      }
      makeEditable(cell, field, lineKey, value);
    });
  });
  bindPreviewEditors(table);
  addResizeHandles(table);
  filterPreviewNodeWeights(table);
}
function bindPreviewEditors(root) {
  root.querySelectorAll('[data-xml-cii-preview-edit]').forEach((input) => {
    if (input.dataset.bound === 'true') return;
    input.dataset.bound = 'true';
    const save = () => saveProcessValue(input.getAttribute('data-xml-cii-preview-linekey') || '', input.getAttribute('data-xml-cii-preview-edit') || '', input.value);
    input.addEventListener('input', save);
    input.addEventListener('change', save);
    input.addEventListener('click', (event) => event.stopPropagation());
  });
  root.querySelectorAll('[data-xml-cii-preview-filldown]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const field = button.getAttribute('data-xml-cii-preview-filldown') || '';
      const sourceInput = button.previousElementSibling;
      const value = clean(sourceInput?.value || '');
      if (!field || !value) return;
      let filled = 0;
      root.querySelectorAll(`[data-xml-cii-preview-edit="${CSS.escape(field)}"]`).forEach((input) => {
        if (input === sourceInput) return;
        input.value = value;
        saveProcessValue(input.getAttribute('data-xml-cii-preview-linekey') || '', field, value);
        filled += 1;
      });
      button.textContent = `↓ ${filled}`;
      setTimeout(() => { button.textContent = '↓'; }, 1200);
    });
  });
}
function addResizeHandles(table) {
  if (table.dataset.resizeReady === 'true') return;
  table.dataset.resizeReady = 'true';
  table.style.tableLayout = 'fixed';
  table.querySelectorAll('thead th').forEach((th) => {
    th.style.position = 'relative';
    const grip = document.createElement('span');
    grip.style.cssText = 'position:absolute;right:0;top:0;width:6px;height:100%;cursor:col-resize;user-select:none;';
    grip.title = 'Drag to resize column';
    th.appendChild(grip);
    let startX = 0;
    let startW = 0;
    const move = (event) => {
      const w = Math.max(48, startW + event.clientX - startX);
      th.style.width = `${w}px`;
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    grip.addEventListener('mousedown', (event) => {
      startX = event.clientX;
      startW = th.getBoundingClientRect().width;
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      event.preventDefault();
    });
  });
}
function filterPreviewNodeWeights(table) {
  table.querySelectorAll('.mc-preview-node-table tbody tr').forEach((tr) => {
    const type = clean(tr.children[1]?.textContent || '');
    if (SKIP_WEIGHT_TYPES.test(type)) tr.remove();
  });
}
async function enhanceWeightPopup() {
  const active = popup();
  const table = active?.querySelector('.mc-rigid-review-table');
  if (!table) return;
  const xmlNodes = branchNodes(await currentXmlText());
  const staged = stagedEntriesFromJson(await currentStagedText());
  table.querySelectorAll('tbody tr').forEach((tr) => {
    const cells = Array.from(tr.children);
    const branchName = clean(cells[0]?.getAttribute('title') || cells[0]?.textContent || '');
    const nodeNumber = clean(cells[3]?.textContent || '');
    const dtxrCell = cells[4];
    const typeText = clean(dtxrCell?.textContent || '');
    if (SKIP_WEIGHT_TYPES.test(typeText) || SKIP_WEIGHT_TYPES.test(dtxrCell?.title || '')) {
      tr.remove();
      return;
    }
    const dtxr = dtxrForNode(branchName, nodeNumber, xmlNodes, staged);
    if (dtxr && dtxrCell) {
      dtxrCell.textContent = dtxr;
      dtxrCell.title = 'DTXR_POS/DTXR_PS/staged fallback';
    }
  });
}
let raf = 0;
function schedule() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    enhancePreviewTable().catch((error) => console.warn('XML->CII preview enhancement failed:', error));
    enhanceWeightPopup().catch((error) => console.warn('XML->CII weight popup enhancement failed:', error));
  });
}
function installXmlCiiPreviewEnhancements() {
  window.installXmlCiiPreviewEnhancements = installXmlCiiPreviewEnhancements;
  if (window[FLAG]) return;
  window[FLAG] = true;
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener('click', schedule, true);
  document.addEventListener('change', schedule, true);
  schedule();
}
installXmlCiiPreviewEnhancements();
