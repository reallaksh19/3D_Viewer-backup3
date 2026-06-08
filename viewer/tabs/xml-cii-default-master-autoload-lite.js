const FLAG = '__xmlCiiDefaultMaterialWeightAutoload_v3';
const INPUT_SELECTOR = '[data-option-key="supportConfigJson"]';
const RAW_REPO_BASE = 'https://raw.githubusercontent.com/reallaksh19/3D_Viewer/main/';

const DEFAULT_MASTER_PATHS = Object.freeze({
  materialMap: 'docs/Masters/PCF_MAT_MAP.TXT',
  weightValveCa8: 'docs/Masters/wtValveweights.json',
  pipingClassIndex: 'docs/Masters/SpecwisePipingClass/index.json',
  pipingClassShardBase: 'docs/Masters/SpecwisePipingClass/',
  legacyPipingClassMaster: 'docs/Masters/Piping_class_master.json',
});

const DEFAULTS = Object.freeze({
  material: Object.freeze({
    title: 'Material Map',
    sectionKey: 'material',
    rowsKey: 'mapRows',
    pathKey: 'materialMap',
    parse: parseMaterialMap,
    fieldMap: Object.freeze({ code: 'code', material: 'material' }),
  }),
  weight: Object.freeze({
    title: 'Weights / Valve CA8',
    sectionKey: 'weight',
    rowsKey: 'masterRows',
    pathKey: 'weightValveCa8',
    parse: parseJsonRows,
    aliases: Object.freeze({
      bore: Object.freeze(['convertedBore', 'Converted Bore', 'Size (NPS)', 'Size', 'NPS', 'DN', 'NB', 'Bore']),
      rating: Object.freeze(['Rating', 'RATING', 'Class', 'CLASS', 'Pressure Class']),
      length: Object.freeze(['Length (RF-F/F)', 'RF-F/F', 'Length', 'LEN', 'Face To Face', 'faceToFace']),
      valveType: Object.freeze(['Type Description', 'Valve Type', 'Type', 'Description']),
      weight: Object.freeze(['RF/RTJ KG', 'Valve Weight', 'Weight', 'weight', 'valveWeight']),
    }),
  }),
});

function text(value) { return value == null ? '' : String(value); }
function clean(value) { return text(value).replace(/\s+/g, ' ').trim(); }
function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function normalizePath(pathValue) { return clean(pathValue).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\.\.\//, '').replace(/^\/+/, ''); }

function parseConfig() {
  const input = document.querySelector(INPUT_SELECTOR);
  if (!input) return { input: null, config: null };
  try {
    const config = JSON.parse(input.value || '{}');
    const cfg = isObject(config) ? config : {};
    cfg.masterPaths = isObject(cfg.masterPaths) ? cfg.masterPaths : {};
    for (const [key, value] of Object.entries(DEFAULT_MASTER_PATHS)) {
      if (!clean(cfg.masterPaths[key])) cfg.masterPaths[key] = value;
    }
    return { input, config: cfg };
  } catch {
    return { input, config: null };
  }
}

function writeConfig(input, config) {
  const next = JSON.stringify(config, null, 2);
  if (input.value === next) return;
  input.value = next;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function parseJsonRows(rawText) {
  const parsed = JSON.parse(rawText || '[]');
  if (Array.isArray(parsed)) return parsed;
  if (!isObject(parsed)) return [];
  for (const key of ['rows', 'masterRows', 'mapRows', 'data', 'items']) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }
  for (const value of Object.values(parsed)) {
    if (Array.isArray(value) && value.every((item) => isObject(item))) return value;
  }
  return [];
}

function parseMaterialMap(rawText) {
  return text(rawText)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\d{4}$/.test(line))
    .map((line, index) => {
      const match = line.match(/^(\S+)\s+(.+)$/);
      return {
        _rowIndex: index + 1,
        code: match ? match[1].trim() : '',
        material: match ? match[2].trim() : line,
      };
    });
}

function rowKeys(rows) {
  const keys = [];
  const seen = new Set();
  for (const row of (rows || []).slice(0, 50)) {
    for (const key of Object.keys(row || {})) {
      if (!seen.has(key)) { seen.add(key); keys.push(key); }
    }
  }
  return keys;
}

function normalizeHeader(value) {
  return clean(value).toLowerCase().replace(/[_\-/()."']/g, ' ').replace(/\s+/g, ' ').trim();
}

function autoFieldMap(rows, aliases, existingMap = {}) {
  const headers = rowKeys(rows);
  const next = { ...(existingMap || {}) };
  for (const [field, names] of Object.entries(aliases || {})) {
    if (next[field]) continue;
    let best = '';
    let score = 0;
    for (const header of headers) {
      const h = normalizeHeader(header);
      for (const name of names) {
        const n = normalizeHeader(name);
        const current = h === n ? 100 : (h.includes(n) || n.includes(h) ? 80 : 0);
        if (current > score) { score = current; best = header; }
      }
    }
    if (best && score >= 80) next[field] = best;
  }
  return next;
}

function pathCandidates(pathValue) {
  const raw = clean(pathValue);
  if (!raw) return [];
  if (/^https?:\/\//i.test(raw)) return [raw];
  const normalized = normalizePath(raw);
  const base = location.pathname.replace(/[^/]*$/, '');

  // GitHub Pages currently serves the viewer as the site root, so /docs can be
  // absent in the deployed artifact. Try raw GitHub first to avoid noisy 404s;
  // local paths remain as fallback for local/dev deployments.
  return Array.from(new Set([
    `${RAW_REPO_BASE}${normalized}`,
    `${location.origin}/3D_Viewer/${normalized}`,
    `${location.origin}${base}${normalized}`,
    `../${normalized}`,
    `./${normalized}`,
    raw,
  ]));
}

async function fetchRows(def, config) {
  const configuredPath = clean(config?.masterPaths?.[def.pathKey]) || DEFAULT_MASTER_PATHS[def.pathKey];
  const errors = [];
  for (const url of pathCandidates(configuredPath)) {
    try {
      const response = await fetch(url, { cache: 'force-cache', mode: 'cors' });
      if (!response.ok) { errors.push(`${url}: HTTP ${response.status}`); continue; }
      const rawText = await response.text();
      const rows = def.parse(rawText);
      if (!rows.length) { errors.push(`${url}: 0 rows`); continue; }
      return { rows, url, configuredPath };
    } catch (error) {
      errors.push(`${url}: ${clean(error?.message || error)}`);
    }
  }
  throw new Error(`${def.title} could not be loaded from ${configuredPath}. ${errors.join(' | ')}`);
}

async function loadDefault(masterKey, force = false) {
  const def = DEFAULTS[masterKey];
  if (!def) return false;
  const { input, config } = parseConfig();
  if (!input || !config) return false;
  if (!force && Array.isArray(config?.[def.sectionKey]?.[def.rowsKey]) && config[def.sectionKey][def.rowsKey].length > 0) {
    writeConfig(input, config);
    return true;
  }
  const { rows, url, configuredPath } = await fetchRows(def, config);
  const section = isObject(config[def.sectionKey]) ? config[def.sectionKey] : {};
  section[def.rowsKey] = rows;
  section.fieldMap = def.fieldMap ? { ...(section.fieldMap || {}), ...def.fieldMap } : autoFieldMap(rows, def.aliases, section.fieldMap || {});
  section.defaultUrl = configuredPath;
  section.masterUrl = configuredPath;
  section._autoloadedFrom = url;
  section._autoloadedRows = rows.length;
  section._autoloadedAt = new Date().toISOString();
  config[def.sectionKey] = section;
  config._xmlCiiDefaultMasters = {
    ...(config._xmlCiiDefaultMasters || {}),
    materialAndWeightLoadedAt: new Date().toISOString(),
    loaded: [`${def.title}: ${rows.length} row(s)`],
    note: 'Material Map and Weights/Valve CA8 are loaded by editable configured paths. Piping Class uses specwise shards.',
  };
  writeConfig(input, config);
  console.info(`XML->CII default master loaded: ${def.title}: ${rows.length} row(s) from ${url}`);
  return true;
}

let busy = false;
let lastSignature = '';
async function autoloadDefaults() {
  if (busy) return;
  const { input, config } = parseConfig();
  if (!input || !config) return;
  const signature = Object.entries(DEFAULTS)
    .map(([key, def]) => `${key}:${clean(config.masterPaths?.[def.pathKey])}:${Array.isArray(config?.[def.sectionKey]?.[def.rowsKey]) ? config[def.sectionKey][def.rowsKey].length : 0}`)
    .join('|');
  if (signature === lastSignature) return;
  lastSignature = signature;
  const missing = Object.entries(DEFAULTS).filter(([, def]) => !Array.isArray(config?.[def.sectionKey]?.[def.rowsKey]) || config[def.sectionKey][def.rowsKey].length <= 0);
  if (!missing.length) {
    writeConfig(input, config);
    return;
  }
  busy = true;
  try {
    const loaded = [];
    for (const [key, def] of missing) {
      await loadDefault(key, true);
      const { config: after } = parseConfig();
      const count = Array.isArray(after?.[def.sectionKey]?.[def.rowsKey]) ? after[def.sectionKey][def.rowsKey].length : 0;
      loaded.push(`${def.title}: ${count} row(s)`);
    }
    console.info(`XML->CII default masters loaded: ${loaded.join(' · ')}`);
  } catch (error) {
    console.warn('XML->CII default material/weight autoload failed:', error);
  } finally {
    busy = false;
  }
}

function interceptDefaultLoadClicks(event) {
  const button = event.target?.closest?.('[data-xml-cii-load-default]');
  const masterKey = button?.getAttribute?.('data-xml-cii-load-default') || '';
  if (!DEFAULTS[masterKey]) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  loadDefault(masterKey, true).catch((error) => console.warn(`XML->CII ${masterKey} default load failed:`, error));
}

let raf = 0;
function schedule() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => autoloadDefaults());
}

function installXmlCiiDefaultMaterialWeightAutoload() {
  window.installXmlCiiDefaultMaterialWeightAutoload = installXmlCiiDefaultMaterialWeightAutoload;
  if (window[FLAG]) return;
  window[FLAG] = true;
  schedule();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', interceptDefaultLoadClicks, true);
  document.addEventListener('change', (event) => { if (event.target?.matches?.(INPUT_SELECTOR)) schedule(); }, true);
}

installXmlCiiDefaultMaterialWeightAutoload();
