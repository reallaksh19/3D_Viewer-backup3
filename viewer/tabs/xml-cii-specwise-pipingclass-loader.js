const FLAG = '__xmlCiiSpecwisePipingClassLoader_v2';
const INPUT_SELECTOR = '[data-option-key="supportConfigJson"]';
const POPUP_SELECTOR = '.model-converters-workflow-popup-overlay .model-converters-workflow-popup';
const RAW_REPO_BASE = 'https://raw.githubusercontent.com/reallaksh19/3D_Viewer/main/';

const DEFAULT_MASTER_PATHS = Object.freeze({
  materialMap: 'docs/Masters/PCF_MAT_MAP.TXT',
  weightValveCa8: 'docs/Masters/wtValveweights.json',
  pipingClassIndex: 'docs/Masters/SpecwisePipingClass/index.json',
  pipingClassShardBase: 'docs/Masters/SpecwisePipingClass/',
  legacyPipingClassMaster: 'docs/Masters/Piping_class_master.json',
});

const PIPING_FIELD_MAP = Object.freeze({
  pipingClass: 'Piping Class',
  convertedBore: 'convertedBore',
  componentType: 'Component Type',
  rating: 'Rating',
  materialName: 'Material_Name',
  schedule: 'SCH',
  wallThickness: 'Wall thickness',
  corrosion: 'Corrosion',
  endCondition: 'End Condition',
});

function text(value) { return value == null ? '' : String(value); }
function clean(value) { return text(value).replace(/\s+/g, ' ').trim(); }
function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function popup() { return document.querySelector(POPUP_SELECTOR); }
function esc(value) { return text(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function normalizeProbe(value) { return clean(value).toUpperCase().replace(/["'\s]/g, ''); }
function normalizePath(pathValue) { return clean(pathValue).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\.\.\//, '').replace(/^\/+/, ''); }
function ensureSlash(pathValue) { const p = clean(pathValue).replace(/\\/g, '/'); return p.endsWith('/') ? p : `${p}/`; }

function parseConfig() {
  const input = document.querySelector(INPUT_SELECTOR);
  if (!input) return { input: null, config: null };
  try {
    const parsed = JSON.parse(input.value || '{}');
    const config = isObject(parsed) ? parsed : {};
    config.masterPaths = isObject(config.masterPaths) ? config.masterPaths : {};
    for (const [key, value] of Object.entries(DEFAULT_MASTER_PATHS)) {
      if (!clean(config.masterPaths[key])) config.masterPaths[key] = value;
    }
    return { input, config };
  } catch {
    return { input, config: null };
  }
}

function writeConfig(input, config) {
  if (!input || !config) return;
  const next = JSON.stringify(config, null, 2);
  if (input.value === next) return;
  input.value = next;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function pathCandidates(pathValue) {
  const raw = clean(pathValue);
  if (!raw) return [];
  if (/^https?:\/\//i.test(raw)) return [raw];
  const normalized = normalizePath(raw);
  const pageBase = location.pathname.replace(/[^/]*$/, '');
  return Array.from(new Set([
    `${RAW_REPO_BASE}${normalized}`,
    `${location.origin}/3D_Viewer/${normalized}`,
    `${location.origin}${pageBase}${normalized}`,
    `../${normalized}`,
    `./${normalized}`,
    raw,
  ]));
}

async function fetchTextFromPath(pathValue) {
  const errors = [];
  for (const url of pathCandidates(pathValue)) {
    try {
      const response = await fetch(url, { cache: 'force-cache', mode: 'cors' });
      if (!response.ok) { errors.push(`${url}: HTTP ${response.status}`); continue; }
      const rawText = await response.text();
      if (!clean(rawText)) { errors.push(`${url}: empty response`); continue; }
      return { rawText, url };
    } catch (error) {
      errors.push(`${url}: ${clean(error?.message || error)}`);
    }
  }
  throw new Error(`Unable to fetch ${pathValue}. ${errors.join(' | ')}`);
}

function rowsFromShardJson(rawText) {
  const parsed = JSON.parse(rawText || '[]');
  if (Array.isArray(parsed)) return { rows: parsed, meta: {} };
  if (isObject(parsed)) {
    if (Array.isArray(parsed.rows)) return { rows: parsed.rows, meta: parsed };
    if (Array.isArray(parsed.masterRows)) return { rows: parsed.masterRows, meta: parsed };
    if (Array.isArray(parsed.data)) return { rows: parsed.data, meta: parsed };
  }
  return { rows: [], meta: isObject(parsed) ? parsed : {} };
}

function extractBranchNamesFromXmlText(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  const branchNames = [];
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (clean(el.localName || el.nodeName).toLowerCase() === 'branchname') {
      const value = clean(el.textContent);
      if (value) branchNames.push(value);
    }
  }
  return Array.from(new Set(branchNames));
}

function classEntriesFromIndex(index) {
  if (!isObject(index)) return [];
  const classes = isObject(index.classes) ? index.classes : {};
  return Object.entries(classes)
    .map(([key, meta]) => ({ key: clean(key), meta: isObject(meta) ? meta : {} }))
    .filter((entry) => entry.key)
    .sort((a, b) => normalizeProbe(b.key).length - normalizeProbe(a.key).length || a.key.localeCompare(b.key, undefined, { numeric: true }));
}

function matchSpecKeys(index, branchNames) {
  const branches = branchNames.map((branch) => ({ branch, probe: normalizeProbe(branch) })).filter((entry) => entry.probe);
  const matched = new Map();
  for (const entry of classEntriesFromIndex(index)) {
    const tokens = Array.isArray(entry.meta.matchTokens) && entry.meta.matchTokens.length ? entry.meta.matchTokens : [entry.key];
    const probes = tokens.map(normalizeProbe).filter(Boolean).sort((a, b) => b.length - a.length);
    const found = branches.find((branchEntry) => probes.some((probe) => branchEntry.probe.includes(probe)));
    if (found) matched.set(entry.key, { ...entry, matchedBranch: found.branch });
  }
  return Array.from(matched.values());
}

function shardPathForEntry(config, entry) {
  const base = ensureSlash(config.masterPaths?.pipingClassShardBase || DEFAULT_MASTER_PATHS.pipingClassShardBase);
  const file = clean(entry.meta?.file) || `${entry.key}.json`;
  if (/^https?:\/\//i.test(file)) return file;
  return `${base}${file}`;
}

function updatePipingClassSection(input, config, index, loadedEntries, loadedRows, indexUrl) {
  const section = isObject(config.pipingClass) ? config.pipingClass : {};
  section.masterRows = loadedRows;
  section.fieldMap = { ...PIPING_FIELD_MAP, ...(isObject(section.fieldMap) ? section.fieldMap : {}) };
  section.mode = 'specwise-shards';
  section.indexUrl = config.masterPaths.pipingClassIndex;
  section.shardBase = config.masterPaths.pipingClassShardBase;
  section.defaultUrl = config.masterPaths.pipingClassIndex;
  section.masterUrl = config.masterPaths.pipingClassIndex;
  section._specwise = {
    loadedAt: new Date().toISOString(),
    indexUrl,
    indexRowCount: Number(index.rowCount) || 0,
    indexClassCount: Number(index.classCount) || Object.keys(index.classes || {}).length,
    matchedSpecKeys: loadedEntries.map((entry) => entry.key),
    matchedBranchSamples: loadedEntries.slice(0, 20).map((entry) => ({ specKey: entry.key, branchName: entry.matchedBranch })),
    loadedRowCount: loadedRows.length,
    note: 'Loaded by simple branch-name containment matching. Regex is not used for piping-class shard selection.',
  };
  config.pipingClass = section;
  writeConfig(input, config);
}

let lastXmlSignature = '';
let lastStatus = null;
let busy = false;

async function loadSpecwisePipingClassForBranches(branchNames, sourceLabel = 'XML') {
  if (busy) return;
  const { input, config } = parseConfig();
  if (!input || !config || !branchNames.length) return;
  const signature = `${sourceLabel}|${branchNames.join('|')}`;
  if (signature === lastXmlSignature && config.pipingClass?._specwise?.loadedRowCount >= 0) return;
  lastXmlSignature = signature;
  busy = true;
  try {
    const { rawText, url: indexUrl } = await fetchTextFromPath(config.masterPaths.pipingClassIndex);
    const index = JSON.parse(rawText || '{}');
    const matches = matchSpecKeys(index, branchNames);
    const loadedRows = [];
    const loadedEntries = [];
    const errors = [];

    for (const entry of matches) {
      try {
        const shardPath = shardPathForEntry(config, entry);
        const { rawText: shardText, url: shardUrl } = await fetchTextFromPath(shardPath);
        const { rows, meta } = rowsFromShardJson(shardText);
        if (!rows.length) throw new Error(`${shardPath} returned 0 rows`);
        const taggedRows = rows.map((row) => ({ ...row, _specwisePipingClassKey: entry.key, _specwiseShardUrl: shardUrl }));
        loadedRows.push(...taggedRows);
        loadedEntries.push({ ...entry, shardUrl, rowCount: rows.length, meta });
      } catch (error) {
        errors.push(`${entry.key}: ${clean(error?.message || error)}`);
      }
    }

    updatePipingClassSection(input, config, index, loadedEntries, loadedRows, indexUrl);
    window.__xmlCiiPipingClassSpecCache = { branchNames, index, loadedEntries, loadedRows, errors, updatedAt: new Date().toISOString() };
    lastStatus = {
      ok: true,
      sourceLabel,
      branchCount: branchNames.length,
      indexClassCount: Number(index.classCount) || Object.keys(index.classes || {}).length,
      matchedSpecCount: matches.length,
      loadedSpecCount: loadedEntries.length,
      loadedRowCount: loadedRows.length,
      errors,
      message: `Piping Class: ${loadedEntries.length}/${matches.length} shard(s), ${loadedRows.length} row(s), ${branchNames.length} branchname(s).`,
    };
    renderStatusPanel();
    if (errors.length) console.warn(`XML->CII specwise piping class load warnings: ${errors.join(' || ')}`);
  } catch (error) {
    lastStatus = { ok: false, sourceLabel, branchCount: branchNames.length, message: `Piping Class index load failed: ${clean(error?.message || error)}` };
    renderStatusPanel();
    console.warn('XML->CII specwise piping class load failed:', error);
  } finally {
    busy = false;
  }
}

async function inspectXmlFile(file) {
  if (!file || !/\.xml$/i.test(file.name || '')) return;
  const xmlText = await file.text();
  const branchNames = extractBranchNamesFromXmlText(xmlText);
  window.__xmlCiiLastBranchNames = branchNames;
  window.__xmlCiiLastXmlText = xmlText;
  if (branchNames.length) await loadSpecwisePipingClassForBranches(branchNames, file.name || 'XML');
  else {
    lastStatus = { ok: false, sourceLabel: file.name || 'XML', branchCount: 0, message: 'No <branchname> values found in selected XML.' };
    renderStatusPanel();
  }
}

function scanExistingXmlInputs() {
  for (const input of Array.from(document.querySelectorAll('input[type="file"]'))) {
    if (input.matches('[data-xml-cii-import-master]')) continue;
    const file = input.files?.[0];
    if (file && /\.xml$/i.test(file.name || '')) inspectXmlFile(file).catch((error) => console.warn('XML->CII XML scan failed:', error));
  }
}

function masterPathPanelHtml(config) {
  const paths = { ...DEFAULT_MASTER_PATHS, ...(config.masterPaths || {}) };
  const field = (key, label, help) => `
    <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9cc5ff;">
      <span>${esc(label)}</span>
      <input type="text" data-xml-cii-master-path="${esc(key)}" value="${esc(paths[key])}"
        style="background:#182334;color:#e6edf5;border:1px solid #31455f;border-radius:5px;padding:6px 8px;width:100%;box-sizing:border-box;">
      <span style="color:#7d91aa;font-size:11px;">${esc(help)}</span>
    </label>`;
  const status = lastStatus
    ? `<div style="margin-top:8px;padding:8px 10px;border:1px solid ${lastStatus.ok ? '#2b7656' : '#7f3040'};border-radius:8px;color:${lastStatus.ok ? '#7dffc0' : '#ffc2c2'};background:#111d2e;">${esc(lastStatus.message || '')}</div>`
    : '<div style="margin-top:8px;color:#7d91aa;">Piping Class index has not been loaded in this session yet.</div>';
  return `<div id="xml-cii-master-path-panel" style="margin:10px 0 14px;padding:12px;border:1px solid #263b55;border-radius:10px;background:#0d1728;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">
      <div>
        <div style="font-weight:700;color:#d7e6ff;">Master Paths / Specwise Piping Class Index</div>
        <div style="font-size:12px;color:#8da7c3;">Editable paths used by XML→CII master loading. Piping Class uses shard index + branchname contains search.</div>
      </div>
      <button type="button" data-xml-cii-rescan-piping-class style="background:#1a5fa3;color:#fff;border:none;border-radius:5px;padding:6px 10px;cursor:pointer;">Rescan XML</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">
      ${field('materialMap', 'Material Map Path', 'Default: docs/Masters/PCF_MAT_MAP.TXT')}
      ${field('weightValveCa8', 'Weights / Valve CA8 Path', 'Default: docs/Masters/wtValveweights.json')}
      ${field('pipingClassIndex', 'Piping Class Index Path', 'Default: docs/Masters/SpecwisePipingClass/index.json')}
      ${field('pipingClassShardBase', 'Piping Class Shard Folder', 'Default: docs/Masters/SpecwisePipingClass/')}
      ${field('legacyPipingClassMaster', 'Legacy Full Piping Class Master', 'Fallback/source file only; not autoloaded.')}
    </div>
    ${status}
  </div>`;
}

function renderStatusPanel() {
  const host = document.getElementById('xml-cii-master-path-panel');
  if (!host) return;
  const { config } = parseConfig();
  if (!config) return;
  host.outerHTML = masterPathPanelHtml(config);
  bindPathPanel();
}

function injectPathPanel() {
  const active = popup();
  const { input, config } = parseConfig();
  if (!active || !input || !config) return;
  if (!document.getElementById('xml-cii-master-path-panel')) {
    const detail = active.querySelector('.model-converters-workflow-detail');
    const title = active.querySelector('.model-converters-workflow-detail-title');
    const anchor = title || detail?.firstElementChild;
    if (anchor) anchor.insertAdjacentHTML('afterend', masterPathPanelHtml(config));
  }
  bindPathPanel();
}

function bindPathPanel() {
  const panel = document.getElementById('xml-cii-master-path-panel');
  if (!panel || panel.dataset.bound === 'true') return;
  panel.dataset.bound = 'true';
  panel.querySelectorAll('[data-xml-cii-master-path]').forEach((input) => {
    input.addEventListener('change', () => {
      const { input: cfgInput, config } = parseConfig();
      if (!cfgInput || !config) return;
      const key = input.getAttribute('data-xml-cii-master-path') || '';
      config.masterPaths = { ...DEFAULT_MASTER_PATHS, ...(config.masterPaths || {}), [key]: input.value };
      writeConfig(cfgInput, config);
    });
  });
  panel.querySelector('[data-xml-cii-rescan-piping-class]')?.addEventListener('click', () => {
    const branches = Array.isArray(window.__xmlCiiLastBranchNames) ? window.__xmlCiiLastBranchNames : [];
    if (branches.length) loadSpecwisePipingClassForBranches(branches, 'rescan').catch((error) => console.warn(error));
    else scanExistingXmlInputs();
  });
}

function interceptLegacyPipingClassDefault(event) {
  const button = event.target?.closest?.('[data-xml-cii-load-default="pipingClass"]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  const branches = Array.isArray(window.__xmlCiiLastBranchNames) ? window.__xmlCiiLastBranchNames : [];
  if (branches.length) loadSpecwisePipingClassForBranches(branches, 'piping-class-default').catch((error) => console.warn(error));
  else scanExistingXmlInputs();
}

let raf = 0;
function refresh() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const { input, config } = parseConfig();
    if (input && config) writeConfig(input, config);
    injectPathPanel();
  });
}

function installXmlCiiSpecwisePipingClassLoader() {
  window.installXmlCiiSpecwisePipingClassLoader = installXmlCiiSpecwisePipingClassLoader;
  if (window[FLAG]) return;
  window[FLAG] = true;
  refresh();
  scanExistingXmlInputs();
  new MutationObserver(refresh).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', interceptLegacyPipingClassDefault, true);
  document.addEventListener('change', (event) => {
    if (event.target?.matches?.('input[type="file"]') && !event.target.matches('[data-xml-cii-import-master]')) {
      const file = event.target.files?.[0];
      if (file) inspectXmlFile(file).catch((error) => console.warn('XML->CII XML scan failed:', error));
    }
    if (event.target?.matches?.(INPUT_SELECTOR)) refresh();
  }, true);
  document.addEventListener('click', (event) => {
    const txtValue = clean(event.target?.textContent || '');
    if (/Config|Import Masters|Preview|Run/i.test(txtValue)) setTimeout(refresh, 0);
  }, true);
}

installXmlCiiSpecwisePipingClassLoader();
