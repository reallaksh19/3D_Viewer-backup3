const FLAG = '__xmlCiiLineListSmartMap_v3';
const INPUT_SELECTOR = '[data-option-key="supportConfigJson"]';

// Mapping rules use AND between groups, OR inside each group.
// Example densityLiquid: (liquid OR liq) AND (density OR den).
const FIELD_RULES = Object.freeze({
  lineKey1: Object.freeze({
    all: Object.freeze([Object.freeze(['service', 'fluid'])]),
    reject: Object.freeze([/piping\s*class/, /pipe\s*class/, /line\s*(number|no\.?)/, /rating/, /pressure/, /temp/, /density/]),
  }),
  lineKey2: Object.freeze({
    all: Object.freeze([Object.freeze(['line number', 'line no', 'line no.', 'lineno', 'line'])]),
    reject: Object.freeze([/(piping|construction|pipe)\s*class/, /\bspec\b/, /rating/, /material/, /pressure/, /temp/, /density/, /fluid/]),
  }),
  pipingClass: Object.freeze({
    all: Object.freeze([Object.freeze(['piping', 'pipe']), Object.freeze(['class', 'spec'])]),
    reject: Object.freeze([/construction\s*class/, /\bconstruction\b/, /line\s*(number|no\.?)/, /\bservice\b/, /\bfluid\b/, /rating/, /material/, /pressure/, /temp/, /density/, /insulation/]),
  }),
  p1: Object.freeze({
    all: Object.freeze([Object.freeze(['pressure', 'pr']), Object.freeze(['max', 'design'])]),
    reject: Object.freeze([/test\s*pressure/, /hydro/, /hydrostatic/, /proof/, /temp/, /temperature/, /density/, /fluid/, /line\s*(number|no\.?)/, /piping\s*class/]),
  }),
  t1: Object.freeze({
    all: Object.freeze([Object.freeze(['temp', 'temperature']), Object.freeze(['max', 'design'])]),
    reject: Object.freeze([/min/, /pressure/, /test/, /hydro/, /density/]),
  }),
  t2: Object.freeze({
    all: Object.freeze([Object.freeze(['temp', 'temperature'])]),
    optional: Object.freeze([Object.freeze(['normal', 'operating'])]),
    reject: Object.freeze([/max/, /min/, /pressure/, /test/, /hydro/, /density/]),
  }),
  t3: Object.freeze({
    all: Object.freeze([Object.freeze(['temp', 'temperature']), Object.freeze(['min'])]),
    reject: Object.freeze([/max/, /pressure/, /test/, /hydro/, /density/]),
  }),
  hydroPressure: Object.freeze({
    all: Object.freeze([Object.freeze(['pressure', 'pr']), Object.freeze(['hydo', 'hydro', 'test'])]),
    reject: Object.freeze([/temp/, /temperature/, /density/, /line\s*(number|no\.?)/, /piping\s*class/]),
  }),
  insThk: Object.freeze({
    all: Object.freeze([Object.freeze(['insulation', 'ins']), Object.freeze(['thickness', 'thk'])]),
    reject: Object.freeze([/insulation\s*type/]),
  }),
  densityMixed: Object.freeze({
    all: Object.freeze([Object.freeze(['mixed']), Object.freeze(['density', 'den'])]),
    reject: Object.freeze([/gas/, /liquid/, /\bliq\b/]),
  }),
  densityGas: Object.freeze({
    all: Object.freeze([Object.freeze(['gas']), Object.freeze(['density', 'den'])]),
    reject: Object.freeze([/mixed/, /liquid/, /\bliq\b/]),
  }),
  densityLiquid: Object.freeze({
    all: Object.freeze([Object.freeze(['liquid', 'liq']), Object.freeze(['density', 'den'])]),
    reject: Object.freeze([/mixed/, /gas/]),
  }),
  phase: Object.freeze({
    all: Object.freeze([Object.freeze(['fluid', 'phase', 'medium'])]),
    reject: Object.freeze([]),
  }),
});
const TARGETS = FIELD_RULES;

function text(value) { return value == null ? '' : String(value); }
function clean(value) { return text(value).replace(/\s+/g, ' ').trim(); }
function canon(value) {
  return clean(value)
    .toLowerCase()
    .replace(/º/g, '°')
    .replace(/³/g, '3')
    .replace(/[_\-()[\]/|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function isMissingData(value) { const v = clean(value); return !v || v === '-' || /^n\/?a$/i.test(v); }
function firstNumeric(value, preferLast = false) {
  const nums = clean(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g) || [];
  return nums.length ? nums[preferLast ? nums.length - 1 : 0] : '';
}
function wordPattern(alias) {
  const a = canon(alias);
  if (!a) return null;
  if (/^[a-z0-9]+$/.test(a) && a.length <= 4) return new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  return null;
}
function hasAlias(probe, alias) {
  const a = canon(alias);
  if (!a) return false;
  const word = wordPattern(a);
  if (word) return word.test(probe);
  return probe.includes(a);
}
function hasAny(probe, aliases) { return (aliases || []).some((alias) => hasAlias(probe, alias)); }
function groupsMatch(probe, groups) { return (groups || []).every((group) => hasAny(probe, group)); }
function rejectMatch(probe, rejects) { return (rejects || []).some((rx) => rx.test(probe)); }

function parseConfig() {
  const input = document.querySelector(INPUT_SELECTOR);
  if (!input) return { input: null, cfg: null };
  try {
    const cfg = JSON.parse(input.value || '{}');
    cfg.linelist = isObject(cfg.linelist) ? cfg.linelist : {};
    cfg.linelist.fieldMap = isObject(cfg.linelist.fieldMap) ? cfg.linelist.fieldMap : {};
    cfg.linelist.masterRows = Array.isArray(cfg.linelist.masterRows) ? cfg.linelist.masterRows : [];
    cfg.overrides = isObject(cfg.overrides) ? cfg.overrides : {};
    cfg.overrides.processData = isObject(cfg.overrides.processData) ? cfg.overrides.processData : {};
    return { input, cfg };
  } catch {
    return { input, cfg: null };
  }
}
function writeConfig(input, cfg) {
  const next = JSON.stringify(cfg, null, 2);
  if (input.value === next) return false;
  input.value = next;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
function rowValue(row, keys) {
  for (const key of (keys || []).filter(Boolean)) {
    if (row?.[key] != null && clean(row[key]) !== '') return text(row[key]);
    if (row?._raw?.[key] != null && clean(row._raw[key]) !== '') return text(row._raw[key]);
  }
  return '';
}
function allKeys(rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    for (const key of Object.keys(row || {})) if (key !== '_raw' && !seen.has(key)) { seen.add(key); out.push(key); }
    for (const key of Object.keys(row?._raw || {})) if (!seen.has(key)) { seen.add(key); out.push(key); }
  }
  return out;
}
function columnSamples(rows, key, limit = 14) {
  const values = [];
  for (const row of rows || []) {
    const v = rowValue(row, [key]);
    if (clean(v) !== '') values.push(clean(v));
    if (values.length >= limit) break;
  }
  return values;
}
function columnProbe(rows, key) { return canon([key, ...columnSamples(rows, key, 14)].join(' | ')); }
function isBadForTarget(target, probe) {
  const rule = FIELD_RULES[target];
  if (!rule) return false;
  if (rejectMatch(probe, rule.reject)) return true;
  if (!groupsMatch(probe, rule.all)) return true;
  return false;
}
function scoreTarget(target, key, rows) {
  const rule = FIELD_RULES[target];
  if (!rule) return -999;
  const probe = columnProbe(rows, key);
  const header = canon(key);
  if (isBadForTarget(target, probe)) return -999;
  let score = 200;
  if (groupsMatch(header, rule.all) && !rejectMatch(header, rule.reject)) score += 90;
  for (const group of rule.all || []) if (hasAny(header, group)) score += 15;
  for (const group of rule.optional || []) if (hasAny(probe, group)) score += 35;

  if (target === 'lineKey1' && hasAlias(probe, 'service')) score += 80;
  if (target === 'lineKey2' && /line\s*(number|no\.?)/.test(probe)) score += 110;
  if (target === 'pipingClass' && /\bpiping\s*class\b/.test(probe)) score += 180;
  if (target === 'pipingClass' && /\bpipe\s*class\b/.test(probe)) score += 160;
  if (target === 'pipingClass' && /\bpiping\s*spec\b|\bpipe\s*spec\b/.test(probe)) score += 130;
  if (target === 'p1' && /design\s*pressure|pressure\s*design/.test(probe)) score += 140;
  if (target === 'p1' && /max/.test(probe) && /pressure/.test(probe)) score += 100;
  if (target === 't1' && /design\s*temp|temp\s*design/.test(probe)) score += 120;
  if (target === 't1' && /max/.test(probe) && /temp/.test(probe)) score += 100;
  if (target === 't2' && /(normal|operating)/.test(probe)) score += 80;
  if (target === 't3' && /min/.test(probe) && /temp/.test(probe)) score += 100;
  if (target === 'hydroPressure' && /(test\s*pressure|hydro\s*pressure|hydrostatic\s*pressure)/.test(probe)) score += 160;
  if (target === 'insThk' && /insulation/.test(probe) && /(thickness|thk)/.test(probe)) score += 120;
  if (target === 'densityMixed' && /mixed/.test(probe) && /(density|\bden\b)/.test(probe)) score += 120;
  if (target === 'densityGas' && /gas/.test(probe) && /(density|\bden\b)/.test(probe)) score += 120;
  if (target === 'densityLiquid' && /(liquid|\bliq\b)/.test(probe) && /(density|\bden\b)/.test(probe)) score += 120;
  return score;
}
function shouldKeepExisting(target, key, rows) {
  if (!key) return false;
  const probe = columnProbe(rows, key);
  return !isBadForTarget(target, probe) && scoreTarget(target, key, rows) >= 200;
}
function detectMap(rows, existing = {}) {
  const keys = allKeys(rows);
  const result = { ...(existing || {}) };
  const claimed = new Set();
  for (const [target, key] of Object.entries(result)) {
    if (shouldKeepExisting(target, key, rows)) claimed.add(key);
    else if (FIELD_RULES[target]) delete result[target];
  }
  const orderedTargets = ['lineKey1', 'lineKey2', 'pipingClass', 'p1', 't1', 't2', 't3', 'hydroPressure', 'insThk', 'densityMixed', 'densityGas', 'densityLiquid', 'phase'];
  for (const target of orderedTargets) {
    let best = '';
    let bestScore = 0;
    for (const key of keys) {
      if (claimed.has(key) && result[target] !== key) continue;
      const score = scoreTarget(target, key, rows);
      if (score > bestScore) { bestScore = score; best = key; }
    }
    if (best && bestScore >= 200) {
      result[target] = best;
      claimed.add(best);
    }
  }
  if (!result.density && result.densityMixed) result.density = result.densityMixed;
  if (result.p1 && result.hydroPressure && result.p1 === result.hydroPressure) delete result.p1;
  return result;
}
function goodValue(value) { return !isMissingData(value); }
function normalizedValue(row, map, target) { return clean(rowValue(row, [map?.[target], target])); }
function computeLineKey(row, map) {
  const key1 = normalizedValue(row, map, 'lineKey1');
  const key2 = normalizedValue(row, map, 'lineKey2');
  const composite = `${key1}${key2}`;
  if (goodValue(composite) && !/^service\s*line\s*(number|no)?$/i.test(composite)) return composite;
  return rowValue(row, ['lineNo', 'lineNoKey', 'Line No. Key', 'Line No Key', 'lineKey', 'LineKey', map.lineSeqNo, map.lineNo]);
}
function normalizeRows(cfg) {
  const rows = cfg.linelist.masterRows || [];
  const map = cfg.linelist.fieldMap || {};
  let changed = false;
  for (const row of rows) {
    const lineKey = clean(computeLineKey(row, map));
    if (lineKey && clean(row.lineNoKey) !== lineKey) { row.lineNoKey = lineKey; changed = true; }
    if (lineKey && clean(row.lineNo) !== lineKey) { row.lineNo = lineKey; changed = true; }
    if (lineKey && clean(row.lineKey) !== lineKey) { row.lineKey = lineKey; changed = true; }

    const simpleFields = ['pipingClass', 'p1', 't1', 't2', 't3', 'hydroPressure', 'insThk', 'densityMixed', 'densityGas', 'densityLiquid', 'phase'];
    for (const field of simpleFields) {
      const value = normalizedValue(row, map, field);
      if (goodValue(value) && clean(row[field]) !== value) { row[field] = value; changed = true; }
      if (!goodValue(value) && field === 'p1' && clean(row.p1) && map.p1 === undefined) { delete row.p1; changed = true; }
    }
    const density = goodValue(row.densityMixed) ? row.densityMixed : (goodValue(row.densityGas) ? row.densityGas : (goodValue(row.densityLiquid) ? row.densityLiquid : normalizedValue(row, map, 'density')));
    if (goodValue(density) && clean(row.density) !== clean(density)) { row.density = clean(density); changed = true; }

    const numericTargets = { p1: false, t1: false, t2: false, t3: false, hydroPressure: true, insThk: false, density: true, densityMixed: true, densityGas: true, densityLiquid: true };
    for (const [field, preferLast] of Object.entries(numericTargets)) {
      const numeric = firstNumeric(row[field], preferLast);
      if (numeric && clean(row[`${field}Numeric`]) !== numeric) { row[`${field}Numeric`] = numeric; changed = true; }
    }

    if (lineKey) {
      const process = cfg.overrides.processData[lineKey] || {};
      for (const field of ['pipingClass', 'p1', 't1', 't2', 't3', 'hydroPressure', 'insThk', 'density', 'densityMixed', 'densityGas', 'densityLiquid', 'phase']) {
        const value = clean(row[field]);
        if (field === 'p1' && (!map.p1 || (process.hydroPressure && firstNumeric(value) === firstNumeric(process.hydroPressure)))) {
          if (process.p1) { delete process.p1; changed = true; }
          continue;
        }
        if (goodValue(value) && clean(process[field]) !== value) { process[field] = value; changed = true; }
      }
      cfg.overrides.processData[lineKey] = process;
    }
  }
  return changed;
}
function applySmartMap() {
  const { input, cfg } = parseConfig();
  if (!input || !cfg) return;
  const rows = cfg.linelist.masterRows;
  if (!rows.length) return;
  const nextMap = detectMap(rows, cfg.linelist.fieldMap);
  const old = JSON.stringify(cfg.linelist.fieldMap || {});
  cfg.linelist.fieldMap = nextMap;
  let changed = old !== JSON.stringify(nextMap);
  changed = normalizeRows(cfg) || changed;
  if (changed) writeConfig(input, cfg);
}
let raf = 0;
function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(applySmartMap); }
function installXmlCiiLineListSmartMap() {
  window.installXmlCiiLineListSmartMap = installXmlCiiLineListSmartMap;
  if (window[FLAG]) return;
  window[FLAG] = true;
  schedule();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-xml-cii-auto-map="linelist"], [data-xml-cii-save-master="linelist"], [data-xml-cii-master-tab="linelist"]')) {
      setTimeout(schedule, 0);
      setTimeout(schedule, 300);
    }
  }, true);
  document.addEventListener('change', (event) => { if (event.target?.matches?.(INPUT_SELECTOR)) schedule(); }, true);
}
installXmlCiiLineListSmartMap();
