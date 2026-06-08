const FLAG = '__xmlCiiPreviewPostfix_v1';
const INPUT_SELECTOR = '[data-option-key="supportConfigJson"]';
const POPUP_SELECTOR = '.model-converters-workflow-popup-overlay .model-converters-workflow-popup';

function text(value) { return value == null ? '' : String(value); }
function clean(value) { return text(value).replace(/\s+/g, ' ').trim(); }
function esc(value) { return text(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function norm(value) { return clean(value).toUpperCase().replace(/[\s_.\-\/()"']/g, ''); }
function popup() { return document.querySelector(POPUP_SELECTOR); }
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
function localName(el) { return clean(el?.localName || el?.nodeName).replace(/^.*:/, '').toLowerCase(); }
function childrenByName(parent, name) { return Array.from(parent?.children || []).filter((el) => localName(el) === name.toLowerCase()); }
function firstText(parent, name) { return clean(childrenByName(parent, name)[0]?.textContent); }
function parsePoint(value) { const nums = clean(value).match(/-?\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || []; return nums.length >= 3 ? { x: nums[0], y: nums[1], z: nums[2] } : null; }
function dist(a, b) { return a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Infinity; }
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
function xmlNodes(xmlText) {
  const doc = new DOMParser().parseFromString(text(xmlText), 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  const out = [];
  for (const branch of Array.from(doc.getElementsByTagName('*')).filter((el) => localName(el) === 'branch')) {
    const branchName = firstText(branch, 'branchname') || clean(branch.getAttribute?.('branchname') || branch.getAttribute?.('name'));
    for (const node of childrenByName(branch, 'node')) out.push({ branchName, nodeNumber: firstText(node, 'nodenumber'), position: firstText(node, 'position'), dtxr: firstText(node, 'dtxr_pos') || firstText(node, 'dtxr_ps') });
  }
  return out;
}
function stagedEntries(stagedText) {
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
  Array.isArray(parsed) ? parsed.forEach(walk) : walk(parsed);
  return out;
}
function dtxrForBranch(branchName, nodes, staged) {
  const branchNodes = nodes.filter((n) => norm(n.branchName) === norm(branchName));
  const direct = branchNodes.map((n) => n.dtxr).filter(Boolean)[0];
  if (direct) return direct;
  for (const node of branchNodes) {
    const p = parsePoint(node.position);
    const hit = staged.find((entry) => dist(p, entry.pos) <= 1.0);
    if (hit) return hit.dtxr;
  }
  return '';
}
function inputHtml(field, lineKey, value) {
  return `<div class="mc-preview-pd-cell ${clean(value) ? 'mc-preview-pd-override' : 'mc-preview-pd-empty'}" style="display:flex;gap:2px;align-items:center;">
    <input type="text" data-xml-cii-preview-post-edit="${esc(field)}" data-xml-cii-preview-post-linekey="${esc(lineKey)}" value="${esc(value)}" placeholder="—" style="width:84px;background:#182334;color:#e6edf5;border:1px solid #31455f;border-radius:4px;padding:4px 6px;">
    <button type="button" data-xml-cii-preview-post-fill="${esc(field)}" style="border:0;background:#223247;color:#9cc5ff;border-radius:3px;cursor:pointer;">↓</button>
  </div>`;
}
function save(lineKey, field, value) {
  const { input, cfg } = parseConfig();
  if (!input || !cfg || !lineKey) return;
  cfg.overrides.processData[lineKey] = { ...(cfg.overrides.processData[lineKey] || {}), [field]: clean(value) };
  if ((field === 'wallThickness' || field === 'corrosion') && Array.isArray(cfg.pipingClass?.masterRows)) {
    for (const row of cfg.pipingClass.masterRows) {
      const spec = row['Piping Class'] || row.pipingClass || row._specwisePipingClassKey;
      if (spec && norm(lineKey).includes(norm(spec))) {
        if (field === 'wallThickness') row.wallThickness = row['Wall thickness'] = clean(value);
        if (field === 'corrosion') row.corrosion = row.Corrosion = clean(value);
      }
    }
  }
  writeConfig(input, cfg);
}
async function fixPreview() {
  const active = popup();
  const table = active?.querySelector('.mc-preview-table');
  if (!table) return;
  const headers = Array.from(table.querySelectorAll('thead th')).map((th) => clean(th.textContent).replace(/Edit$/, '').trim());
  const idx = (re) => headers.findIndex((h) => re.test(h));
  const dtxrIdx = idx(/^DTXR$/i);
  const branchIdx = idx(/^Branch Name$/i);
  const lineKeyIdx = idx(/^Line Key$/i);
  const col = {
    materialCode: idx(/^Mat\. Code$/i), p1: idx(/^P1/i), t1: idx(/^T1/i), t2: idx(/^T2/i), t3: idx(/^T3/i),
    hydroPressure: idx(/^Hydro/i), density: idx(/^Density$/i), wallThickness: idx(/^Wall Thk/i), corrosion: idx(/^Corrosion/i),
  };
  const nodes = await xmlNodes(await currentXmlText());
  const staged = await stagedEntries(await currentStagedText());
  const { cfg } = parseConfig();
  table.querySelectorAll('tbody tr.mc-preview-row').forEach((tr) => {
    const cells = Array.from(tr.children);
    const branchName = clean(cells[branchIdx]?.getAttribute('title') || cells[branchIdx]?.textContent || '').replace(/^…/, '');
    const lineKey = clean(cells[lineKeyIdx]?.textContent || '').replace(/^—$/, '');
    if (dtxrIdx >= 0) {
      const dtxr = dtxrForBranch(branchName, nodes, staged);
      const cell = tr.children[dtxrIdx];
      if (cell && (cell.querySelector('input') || dtxr)) {
        cell.className = 'mc-preview-td mc-preview-dtxr';
        cell.title = dtxr;
        cell.textContent = dtxr || '—';
      }
    }
    if (!lineKey) return;
    const process = cfg?.overrides?.processData?.[lineKey] || {};
    for (const [field, i] of Object.entries(col)) {
      if (i < 0) continue;
      const cell = tr.children[i];
      if (!cell || cell.querySelector('[data-xml-cii-preview-post-edit]')) continue;
      if (field === 'materialCode' && cell.classList.contains('mc-preview-dtxr')) continue;
      const current = process[field] || clean(cell.textContent).replace(/↓/g, '').replace(/^—$/, '');
      if (field === 'wallThickness' || field === 'corrosion' || field === 'materialCode') cell.innerHTML = inputHtml(field, lineKey, current);
    }
  });
  bind(table);
}
function bind(root) {
  root.querySelectorAll('[data-xml-cii-preview-post-edit]').forEach((input) => {
    if (input.dataset.bound === 'true') return;
    input.dataset.bound = 'true';
    const s = () => save(input.getAttribute('data-xml-cii-preview-post-linekey') || '', input.getAttribute('data-xml-cii-preview-post-edit') || '', input.value);
    input.addEventListener('input', s);
    input.addEventListener('change', s);
    input.addEventListener('click', (event) => event.stopPropagation());
  });
  root.querySelectorAll('[data-xml-cii-preview-post-fill]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const field = button.getAttribute('data-xml-cii-preview-post-fill') || '';
      const src = button.previousElementSibling;
      const val = clean(src?.value || '');
      if (!field || !val) return;
      root.querySelectorAll(`[data-xml-cii-preview-post-edit="${CSS.escape(field)}"]`).forEach((input) => {
        if (input === src) return;
        input.value = val;
        save(input.getAttribute('data-xml-cii-preview-post-linekey') || '', field, val);
      });
    });
  });
}
let raf = 0;
function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => fixPreview().catch((e) => console.warn('XML->CII preview postfix failed:', e))); }
function installXmlCiiPreviewPostfix() {
  window.installXmlCiiPreviewPostfix = installXmlCiiPreviewPostfix;
  if (window[FLAG]) return;
  window[FLAG] = true;
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener('click', schedule, true);
  document.addEventListener('change', schedule, true);
  schedule();
}
installXmlCiiPreviewPostfix();
