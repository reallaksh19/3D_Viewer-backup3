const FLAG = '__xmlCiiHydroSavedRowsPatch_v1';
const CONSOLIDATED_FLAG = '__xmlCiiHydroSavedRowsAndCleanup_v3';
const HYDRO_COL = 'data-xml-cii-hydro-saved-col';
const HYDRO_MAP = 'data-mc-hydro-pressure-map';
const POPUP_SELECTOR = '.model-converters-workflow-popup-overlay .model-converters-workflow-popup';
const HYDRO_CONTROL_SELECTOR = `.mc-xml-cii-hydro-map, [${HYDRO_MAP}]`;

function txt(v) { return v == null ? '' : String(v); }
function clean(v) { return txt(v).replace(/\s+/g, ' ').trim(); }
function activePopup() { return document.querySelector(POPUP_SELECTOR); }
function visible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
}
function cfg() {
  const input = document.querySelector('[data-option-key="supportConfigJson"]');
  if (!input) return { input: null, config: null, linelist: null };
  try {
    const config = JSON.parse(input.value || '{}');
    config.linelist = config.linelist && typeof config.linelist === 'object' ? config.linelist : {};
    config.linelist.fieldMap = config.linelist.fieldMap && typeof config.linelist.fieldMap === 'object' ? config.linelist.fieldMap : {};
    config.linelist.masterRows = Array.isArray(config.linelist.masterRows) ? config.linelist.masterRows : [];
    return { input, config, linelist: config.linelist };
  } catch { return { input, config: null, linelist: null }; }
}
function findHydroField(rows) {
  const keys = [];
  const seen = new Set();
  for (const row of rows || []) for (const k of Object.keys(row || {})) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  for (const k of keys) {
    const probe = `${k} | ${(rows || []).slice(0, 5).map((r) => txt(r && r[k])).join(' | ')}`.toUpperCase();
    if (probe.includes('HYDRO') || /TEST\s*PRESS/.test(probe)) return k;
  }
  return '';
}
function hydroField() {
  const c = cfg();
  const rows = c.linelist?.masterRows || [];
  const field = txt(c.linelist?.fieldMap?.hydroPressure || localStorage.getItem('xmlCii.hydroPressureField') || findHydroField(rows));
  if (field && c.input && c.config) {
    c.config.linelist.fieldMap.hydroPressure = field;
    c.input.value = JSON.stringify(c.config, null, 2);
  }
  return field;
}
function rowVal(row, key) {
  if (!row || !key) return '';
  if (row[key] != null) return txt(row[key]);
  if (row._raw && row._raw[key] != null) return txt(row._raw[key]);
  return '';
}
function savedTables() {
  const popup = activePopup();
  if (!popup) return [];
  return Array.from(popup.querySelectorAll('table')).filter((table) => {
    const head = Array.from(table.querySelectorAll('th')).map(clean).join('|');
    return head.includes('_sourceRowIndex') && head.includes('Line Seq No.') && head.includes('Density Mixed');
  });
}
function addSavedColumn() {
  if (window[CONSOLIDATED_FLAG]) return;
  const field = hydroField();
  const c = cfg();
  if (!field || !c.linelist) return;
  for (const table of savedTables()) {
    table.querySelectorAll(`[${HYDRO_COL}="true"]`).forEach((n) => n.remove());
    const header = Array.from(table.querySelectorAll('tr')).find((tr) => Array.from(tr.children).some((td) => clean(td).includes('_sourceRowIndex')));
    if (!header) continue;
    const heads = Array.from(header.children).map(clean);
    if (heads.some((h) => h.toLowerCase().includes('hydro'))) continue;
    let at = heads.findIndex((h) => h === 'T3');
    if (at < 0) at = heads.findIndex((h) => h === 'p1');
    if (at < 0) at = Math.max(0, heads.length - 1);
    const srcCol = Math.max(0, heads.findIndex((h) => h.includes('_sourceRowIndex')));
    const th = document.createElement(header.children[at]?.tagName || 'th');
    th.setAttribute(HYDRO_COL, 'true');
    th.textContent = 'Hydro Test Pressure';
    header.children[at].insertAdjacentElement('afterend', th);
    for (const tr of Array.from(table.querySelectorAll('tr'))) {
      if (tr === header) continue;
      const cells = Array.from(tr.children);
      if (!cells.length) continue;
      const sourceIndex = Number.parseInt(clean(cells[srcCol]), 10);
      const sourceRow = Number.isFinite(sourceIndex) ? c.linelist.masterRows[sourceIndex - 1] : null;
      const td = document.createElement(cells[at]?.tagName === 'TH' ? 'th' : 'td');
      td.setAttribute(HYDRO_COL, 'true');
      td.textContent = rowVal(sourceRow, field);
      (cells[Math.min(at, cells.length - 1)] || tr.lastElementChild).insertAdjacentElement('afterend', td);
    }
  }
}
function cleanupFloatingHydroControls() {
  const popup = activePopup();
  for (const el of Array.from(document.querySelectorAll(HYDRO_CONTROL_SELECTOR))) {
    if (!popup || !popup.contains(el)) {
      try { el.blur?.(); } catch {}
      el.remove();
      continue;
    }
    const r = el.getBoundingClientRect();
    const pr = popup.getBoundingClientRect();
    const outsidePopup = r.left < pr.left - 2 || r.right > pr.right + 2 || r.top < pr.top - 2 || r.bottom > pr.bottom + 2;
    if (!visible(el) || outsidePopup) {
      try { el.blur?.(); } catch {}
      el.remove();
    }
  }
}
let raf = 0;
function refresh() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    cleanupFloatingHydroControls();
    if (!window[CONSOLIDATED_FLAG]) addSavedColumn();
  });
}
function installXmlCiiHydroSavedRowsPatch() {
  window.installXmlCiiHydroSavedRowsPatch = installXmlCiiHydroSavedRowsPatch;
  if (window[CONSOLIDATED_FLAG] || window[FLAG]) return;
  window[FLAG] = true;
  refresh();
  new MutationObserver(refresh).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', (e) => { if (clean(e.target?.textContent).toLowerCase().includes('save mapping')) setTimeout(refresh, 50); }, true);
  document.addEventListener('change', (e) => { if (e.target?.matches?.(HYDRO_CONTROL_SELECTOR)) setTimeout(refresh, 0); }, true);
  document.addEventListener('blur', (e) => { if (e.target?.matches?.(HYDRO_CONTROL_SELECTOR)) setTimeout(refresh, 0); }, true);
}
installXmlCiiHydroSavedRowsPatch();