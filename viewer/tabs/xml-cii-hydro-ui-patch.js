const FLAG = '__xmlCiiLineListHydroScopedFix_v4';
const HYDRO_COL = 'data-xml-cii-hydro-col';
const FIELD_STORAGE = 'xmlCii.hydroPressureField';
const POPUP_SELECTOR = '.model-converters-workflow-popup-overlay .model-converters-workflow-popup';

const HYDRO_ALIASES = Object.freeze([
  'hydroPressure', 'Hydro Test Pressure', 'Hydrotest Pressure', 'Hydro Pressure',
  'Hydro Pr', 'Hyd Test Pr', 'Hyd. Test Pressure', 'Test Pressure',
  'TEST_PRESSURE', 'HYDRO_TEST_PRESSURE', 'Pressure Test', 'Proof Pressure',
]);

function txt(value) { return value == null ? '' : String(value); }
function clean(value) { return txt(value).replace(/\s+/g, ' ').trim(); }
function norm(value) { return clean(value).toUpperCase().replace(/[\s_.\-\/()]/g, ''); }
function activePopup() { return document.querySelector(POPUP_SELECTOR); }

function parseConfig() {
  const input = document.querySelector('[data-option-key="supportConfigJson"]');
  if (!input) return { input: null, cfg: null, linelist: null };
  try {
    const cfg = JSON.parse(input.value || '{}');
    cfg.linelist = cfg.linelist && typeof cfg.linelist === 'object' ? cfg.linelist : {};
    cfg.linelist.fieldMap = cfg.linelist.fieldMap && typeof cfg.linelist.fieldMap === 'object' ? cfg.linelist.fieldMap : {};
    cfg.linelist.masterRows = Array.isArray(cfg.linelist.masterRows) ? cfg.linelist.masterRows : [];
    cfg.overrides = cfg.overrides && typeof cfg.overrides === 'object' ? cfg.overrides : {};
    cfg.overrides.processData = cfg.overrides.processData && typeof cfg.overrides.processData === 'object' ? cfg.overrides.processData : {};
    return { input, cfg, linelist: cfg.linelist };
  } catch {
    return { input, cfg: null, linelist: null };
  }
}
function writeConfig(state, changed) {
  if (!changed || !state?.input || !state?.cfg) return false;
  const next = JSON.stringify(state.cfg, null, 2);
  if (state.input.value === next) return false;
  state.input.value = next;
  state.input.dispatchEvent(new Event('input', { bubbles: true }));
  state.input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
function rowValue(row, keys) {
  if (!row) return '';
  for (const key of (keys || []).filter(Boolean)) {
    if (row[key] != null && clean(row[key]) !== '') return txt(row[key]);
    if (row._raw && row._raw[key] != null && clean(row._raw[key]) !== '') return txt(row._raw[key]);
  }
  return '';
}
function allRowKeys(rows) {
  const keys = [];
  const seen = new Set();
  for (const row of rows || []) {
    for (const key of Object.keys(row || {})) if (!seen.has(key)) { seen.add(key); keys.push(key); }
    for (const key of Object.keys(row?._raw || {})) if (!seen.has(key)) { seen.add(key); keys.push(key); }
  }
  return keys;
}
function scoreHydroHeader(key, rows) {
  const k = norm(key);
  if (!k) return 0;
  let score = 0;
  for (const alias of HYDRO_ALIASES) {
    const a = norm(alias);
    if (k === a) score = Math.max(score, 100);
    else if (k.includes(a) || a.includes(k)) score = Math.max(score, 82);
  }
  if (/HYDRO|HYD/.test(k)) score = Math.max(score, 75);
  if (/TEST.*PRESS|PRESS.*TEST|PROOF.*PRESS/.test(k)) score = Math.max(score, 72);
  const sample = (rows || []).slice(0, 12).map((row) => rowValue(row, [key])).join(' ').toUpperCase();
  if (/HYDRO|HYD\s*TEST|TEST\s*PRESS|PROOF\s*PRESS/.test(`${key} ${sample}`)) score = Math.max(score, 68);
  return score;
}
function detectHydroField(rows) {
  let best = '';
  let bestScore = 0;
  for (const key of allRowKeys(rows)) {
    const score = scoreHydroHeader(key, rows);
    if (score > bestScore) { best = key; bestScore = score; }
  }
  return bestScore >= 68 ? best : '';
}
function preferredHydroField(linelist) {
  const rows = Array.isArray(linelist?.masterRows) ? linelist.masterRows : [];
  let field = clean(linelist?.fieldMap?.hydroPressure);
  if (!field) {
    try { field = clean(localStorage.getItem(FIELD_STORAGE)); } catch {}
  }
  if (!field) field = detectHydroField(rows);
  if (field) {
    try { localStorage.setItem(FIELD_STORAGE, field); } catch {}
  }
  return field;
}
function lineKeyFromRow(row, fieldMap = {}) {
  const key1 = rowValue(row, [fieldMap.lineKey1, 'lineKey1', 'Service', 'ColumnX1', 'LINEKEY1', 'Line Key 1']);
  const key2 = rowValue(row, [fieldMap.lineKey2, 'lineKey2', 'Line number', 'Line Number', 'ColumnX2', 'LINEKEY2', 'Line Key 2']);
  const composite = `${clean(key1)}${clean(key2)}`;
  if (composite && !/^service\s*line\s*(number|no)?$/i.test(composite)) return composite;
  return rowValue(row, ['lineNo', 'lineNoKey', 'Line No. Key', 'Line No Key', 'lineKey', 'LineKey', 'PipelineReference', 'Pipeline Ref', 'PIPELINE_REF', 'ColumnX1', 'lineSeqNo', 'Line Seq No.', fieldMap.lineSeqNo]);
}

const PROCESS_FIELD_KEYS = Object.freeze({
  hydroPressure: HYDRO_ALIASES,
});

function syncLineListRows() {
  const st = parseConfig();
  if (!st.input || !st.cfg || !st.linelist) return false;
  const rows = st.linelist.masterRows;
  const fieldMap = st.linelist.fieldMap || {};
  let changed = false;

  if (!clean(st.linelist.lineKeyTokenPositions) && !clean(st.linelist.branchNameRegex)) {
    st.linelist.lineKeyTokenPositions = '4';
    changed = true;
  }

  const hydroField = preferredHydroField(st.linelist);
  if (hydroField && st.linelist.fieldMap.hydroPressure !== hydroField) {
    st.linelist.fieldMap.hydroPressure = hydroField;
    changed = true;
  }

  for (const row of rows) {
    const key = clean(lineKeyFromRow(row, fieldMap));
    if (key) {
      if (norm(row.lineNo) !== norm(key)) { row.lineNo = key; changed = true; }
      if (norm(row.lineNoKey) !== norm(key)) { row.lineNoKey = key; changed = true; }
      if (norm(row.lineKey) !== norm(key)) { row.lineKey = key; changed = true; }
    }
    for (const [target, keys] of Object.entries(PROCESS_FIELD_KEYS)) {
      const mapped = fieldMap[target] ? [fieldMap[target], ...keys] : keys;
      const value = rowValue(row, mapped);
      if (clean(value) && clean(row[target]) !== clean(value)) { row[target] = value; changed = true; }
    }
    if (key && st.cfg.overrides?.processData) {
      const processOverride = st.cfg.overrides.processData[key] || {};
      const value = clean(row.hydroPressure);
      if (value && clean(processOverride.hydroPressure) !== value) {
        processOverride.hydroPressure = value;
        st.cfg.overrides.processData[key] = processOverride;
        changed = true;
      }
    }
  }
  return writeConfig(st, changed);
}

function cellTexts(row) { return Array.from(row?.children || []).map((cell) => clean(cell.textContent)); }
function addSavedRowsHydroColumn() {
  const popup = activePopup();
  const st = parseConfig();
  if (!popup || !st.linelist?.masterRows?.length) return;
  const hydroField = preferredHydroField(st.linelist);
  if (!hydroField) return;

  for (const table of Array.from(popup.querySelectorAll('table'))) {
    table.querySelectorAll(`[${HYDRO_COL}]`).forEach((node) => node.remove());
    const headerRow = Array.from(table.querySelectorAll('tr')).find((tr) => {
      const joined = cellTexts(tr).join('|').toLowerCase();
      return (joined.includes('line no. key') || joined.includes('line seq no') || joined.includes('_sourcerowindex'))
        && (joined.includes('p1') || joined.includes('t3') || joined.includes('density') || joined.includes('bore'));
    });
    if (!headerRow || cellTexts(headerRow).some((h) => /hydro\s*test\s*pressure/i.test(h))) continue;
    const heads = cellTexts(headerRow);
    const insertAfter = Math.max(0, heads.findIndex((h) => /^T3$/i.test(h) || /^P1$/i.test(h) || /density/i.test(h)));
    const sourceCol = Math.max(0, heads.findIndex((h) => /_sourcerowindex|source row|^#$/i.test(h)));
    const th = document.createElement('th');
    th.setAttribute(HYDRO_COL, 'true');
    th.textContent = 'Hydro Test Pressure';
    (headerRow.children[insertAfter] || headerRow.lastElementChild).insertAdjacentElement('afterend', th);

    Array.from(table.tBodies?.[0]?.rows || []).filter((tr) => tr !== headerRow && tr.children.length).forEach((tr, visualIndex) => {
      const cells = Array.from(tr.children);
      let sourceIndex = Number.parseInt(clean(cells[sourceCol]?.textContent), 10);
      if (!Number.isFinite(sourceIndex) || sourceIndex < 1) sourceIndex = visualIndex + 1;
      const row = st.linelist.masterRows[sourceIndex - 1];
      const td = document.createElement('td');
      td.setAttribute(HYDRO_COL, 'true');
      td.textContent = rowValue(row, ['hydroPressure', hydroField, ...HYDRO_ALIASES]);
      (cells[Math.min(insertAfter, cells.length - 1)] || tr.lastElementChild).insertAdjacentElement('afterend', td);
    });
  }
}

let raf = 0;
function refresh() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    if (!activePopup() && !document.querySelector('[data-option-key="supportConfigJson"]')) return;
    syncLineListRows();
    addSavedRowsHydroColumn();
  });
}

function installXmlCiiLineListHydroFix() {
  window.installXmlCiiLineListHydroFix = installXmlCiiLineListHydroFix;
  if (window[FLAG]) return;
  window[FLAG] = true;
  refresh();
  new MutationObserver(refresh).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', refresh, true);
  document.addEventListener('input', (event) => {
    if (event.target?.matches?.('[data-xml-cii-field-map], [data-option-key="supportConfigJson"]')) refresh();
  }, true);
  document.addEventListener('change', (event) => {
    if (event.target?.matches?.('[data-xml-cii-field-map], [data-option-key="supportConfigJson"]')) refresh();
  }, true);
}

installXmlCiiLineListHydroFix();
