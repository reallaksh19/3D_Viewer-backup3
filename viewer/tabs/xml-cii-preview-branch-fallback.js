const FLAG = '__xmlCiiPreviewBranchFallback_v1';
const INPUT_SELECTOR = '[data-option-key="supportConfigJson"]';
const POPUP_SELECTOR = '.model-converters-workflow-popup-overlay .model-converters-workflow-popup';

function text(value) { return value == null ? '' : String(value); }
function clean(value) { return text(value).replace(/\s+/g, ' ').trim(); }
function norm(value) { return clean(value).toUpperCase().replace(/[\s_.\-\/()"']/g, ''); }
function esc(value) { return text(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function popup() { return document.querySelector(POPUP_SELECTOR); }
function localName(el) { return clean(el?.localName || el?.nodeName).replace(/^.*:/, '').toLowerCase(); }
function childrenByName(parent, name) { return Array.from(parent?.children || []).filter((el) => localName(el) === name.toLowerCase()); }
function firstText(parent, name) { return clean(childrenByName(parent, name)[0]?.textContent); }
function parseConfig() {
  const input = document.querySelector(INPUT_SELECTOR);
  if (!input) return { input: null, config: null };
  try { return { input, config: JSON.parse(input.value || '{}') || {} }; }
  catch { return { input, config: null }; }
}
function writeConfig(input, config) {
  if (!input || !config) return;
  const next = JSON.stringify(config, null, 2);
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
function lineKeyFromRow(row, fieldMap = {}) {
  const key1 = rowValue(row, ['lineKey1', 'ColumnX1', 'LINEKEY1', 'Line Key 1', fieldMap.lineKey1]);
  const key2 = rowValue(row, ['lineKey2', 'ColumnX2', 'LINEKEY2', 'Line Key 2', fieldMap.lineKey2]);
  const composite = `${clean(key1)}${clean(key2)}`;
  return composite || rowValue(row, ['lineNo', 'lineNoKey', 'Line No. Key', 'Line No Key', 'lineKey', 'LineKey', 'PipelineReference', 'Pipeline Ref', 'PIPELINE_REF', 'ColumnX1', 'lineSeqNo', 'Line Seq No.', fieldMap.lineSeqNo]);
}
function tokenAt(branchName, index, delimiter = '-') {
  const pos = Number(index);
  if (!Number.isFinite(pos) || pos <= 0) return '';
  return clean(branchName).replace(/^\/+/, '').replace(/\/B\d+$/i, '').split(delimiter || '-').map((p) => p.trim()).filter(Boolean)[Math.round(pos) - 1] || '';
}
function lineKeyFromBranch(branchName, config) {
  const ll = config?.linelist || {};
  const positions = Array.isArray(ll.lineKeyTokenPositions)
    ? ll.lineKeyTokenPositions
    : text(ll.lineKeyTokenPositions || '4').split(/[,+]/).map((x) => Number(x.trim())).filter(Boolean);
  const key = positions.map((pos) => tokenAt(branchName, pos, ll.tokenDelimiter || '-')).filter(Boolean).join(text(ll.lineKeyJoiner || ''));
  return key || tokenAt(branchName, 4, '-');
}
function boreFromBranch(branchName, config) {
  const token = tokenAt(branchName, config?.weight?.boreTokenIndex || 3, config?.weight?.tokenDelimiter || '-');
  const raw = clean(token).replace(/"/g, '');
  const n = Number(raw);
  if (!Number.isFinite(n)) return '';
  const npsToDn = { 0.5: 15, 0.75: 20, 1: 25, 1.5: 40, 2: 50, 3: 80, 4: 100, 6: 150, 8: 200, 10: 250, 12: 300, 14: 350, 16: 400, 18: 450, 20: 500, 24: 600, 30: 750, 36: 900, 42: 1050, 48: 1200 };
  return npsToDn[n] || n;
}
function branchNodes(doc) {
  return Array.from(doc.getElementsByTagName('*')).filter((el) => localName(el) === 'branch');
}
function branchNameFromBranch(branch) {
  return firstText(branch, 'branchname') || clean(branch.getAttribute?.('branchname') || branch.getAttribute?.('name'));
}
function findLineRow(lineKey, config) {
  const rows = Array.isArray(config?.linelist?.masterRows) ? config.linelist.masterRows : [];
  const fieldMap = config?.linelist?.fieldMap || {};
  return rows.find((row) => norm(lineKeyFromRow(row, fieldMap)) === norm(lineKey)) || null;
}
function findPipingRow(branchName, boreMm, config) {
  const rows = Array.isArray(config?.pipingClass?.masterRows) ? config.pipingClass.masterRows : [];
  const probe = norm(branchName);
  const bore = Number(boreMm);
  return rows.find((row) => {
    const spec = rowValue(row, ['Piping Class', 'pipingClass', 'PIPING_CLASS', '_specwisePipingClassKey']);
    const rowBore = Number(rowValue(row, ['convertedBore', 'Converted Bore', 'DN', 'NB', 'Bore']));
    return spec && probe.includes(norm(spec)) && (!Number.isFinite(bore) || !Number.isFinite(rowBore) || rowBore === bore);
  }) || rows.find((row) => {
    const spec = rowValue(row, ['Piping Class', 'pipingClass', 'PIPING_CLASS', '_specwisePipingClassKey']);
    return spec && probe.includes(norm(spec));
  }) || null;
}
function processValue(config, lineKey, row, field, aliases) {
  const override = config?.overrides?.processData?.[lineKey]?.[field];
  if (clean(override)) return clean(override);
  return rowValue(row, [config?.linelist?.fieldMap?.[field], field, ...aliases]);
}
function hydroValue(config, lineKey, row) {
  return processValue(config, lineKey, row, 'hydroPressure', ['Hydro Test Pressure', 'Hydrotest Pressure', 'Hydro Pressure', 'Hydro Pr', 'Hyd Test Pr', 'Test Pressure', 'HYDRO_TEST_PRESSURE']);
}
function parseXmlBranches(xmlText) {
  const doc = new DOMParser().parseFromString(text(xmlText), 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  return branchNodes(doc).map((branch) => ({ branch, branchName: branchNameFromBranch(branch) })).filter((entry) => entry.branchName);
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
function saveProcess(lineKey, field, value) {
  const { input, config } = parseConfig();
  if (!input || !config || !lineKey) return;
  config.overrides = config.overrides && typeof config.overrides === 'object' ? config.overrides : {};
  config.overrides.processData = config.overrides.processData && typeof config.overrides.processData === 'object' ? config.overrides.processData : {};
  config.overrides.processData[lineKey] = { ...(config.overrides.processData[lineKey] || {}), [field]: clean(value) };
  writeConfig(input, config);
}
function inputCell(field, lineKey, value) {
  return `<input type="text" data-preview-fallback-field="${esc(field)}" data-preview-fallback-linekey="${esc(lineKey)}" value="${esc(value)}" style="width:88px;background:#182334;color:#e6edf5;border:1px solid #31455f;border-radius:4px;padding:4px 6px;">`;
}
async function renderFallbackIfNeeded() {
  const active = popup();
  const host = active?.querySelector('#mc-preview-table-host');
  if (!host || !/No branches found in XML/i.test(host.textContent || '')) return;
  const xmlText = await currentXmlText();
  const branches = parseXmlBranches(xmlText);
  if (!branches.length) return;
  const { config } = parseConfig();
  if (!config) return;
  window.__xmlCiiLastBranchNames = branches.map((entry) => entry.branchName);
  window.__xmlCiiLastXmlText = xmlText;
  const rows = branches.map(({ branchName }) => {
    const lineKey = lineKeyFromBranch(branchName, config);
    const ll = findLineRow(lineKey, config);
    const bore = boreFromBranch(branchName, config);
    const pc = findPipingRow(branchName, bore, config);
    const material = rowValue(pc, ['Material_Name', 'materialName', 'Material']) || rowValue(ll, ['material', 'Material']);
    return {
      branchName, lineKey, bore,
      pipingClass: rowValue(pc, ['Piping Class', 'pipingClass', '_specwisePipingClassKey']) || rowValue(ll, ['pipingClass', 'PipingClass']) || '',
      material,
      rating: rowValue(pc, ['Rating', 'rating']) || rowValue(ll, ['rating', 'Rating']) || '',
      p1: processValue(config, lineKey, ll, 'p1', ['P1', 'Design Pr', 'Operating Pressure']),
      t1: processValue(config, lineKey, ll, 't1', ['T1', 'Design Temp', 'Operating Temp']),
      t2: processValue(config, lineKey, ll, 't2', ['T2', 'Temperature', 'Temp']),
      t3: processValue(config, lineKey, ll, 't3', ['T3', 'Min Temp', 'Temperature3']),
      density: processValue(config, lineKey, ll, 'density', ['Density', 'densityMixed', 'Density Mixed', 'Mixed kg/m3']),
      hydroPressure: hydroValue(config, lineKey, ll),
      wallThickness: rowValue(pc, ['Wall thickness', 'Wall Thickness', 'wallThickness']),
      corrosion: rowValue(pc, ['Corrosion', 'corrosion']),
    };
  });
  host.innerHTML = `<div class="mc-preview-legend"><span class="mc-preview-badge amber">fallback</span> Case-insensitive XML Branch parser used because core preview found no Branch elements.</div>
    <div class="mc-preview-wrap"><table class="mc-preview-table"><thead><tr>
      ${['Branch Name','Line Key','Size','Piping Class','Material','Rating','P1','T1','T2','T3','Density','Hydro Test Pressure','Wall Thk','Corrosion'].map((h) => `<th class="mc-preview-th">${esc(h)}</th>`).join('')}
    </tr></thead><tbody>${rows.map((row) => `<tr class="mc-preview-row">
      <td class="mc-preview-td mc-preview-branch" title="${esc(row.branchName)}">${esc(row.branchName.length > 36 ? '…' + row.branchName.slice(-32) : row.branchName)}</td>
      <td class="mc-preview-td">${esc(row.lineKey || '—')}</td>
      <td class="mc-preview-td">${esc(row.bore ? `${row.bore}mm` : '—')}</td>
      <td class="mc-preview-td">${esc(row.pipingClass || '—')}</td>
      <td class="mc-preview-td">${esc(row.material || '—')}</td>
      <td class="mc-preview-td">${esc(row.rating || '—')}</td>
      <td class="mc-preview-td">${inputCell('p1', row.lineKey, row.p1)}</td>
      <td class="mc-preview-td">${inputCell('t1', row.lineKey, row.t1)}</td>
      <td class="mc-preview-td">${inputCell('t2', row.lineKey, row.t2)}</td>
      <td class="mc-preview-td">${inputCell('t3', row.lineKey, row.t3)}</td>
      <td class="mc-preview-td">${inputCell('density', row.lineKey, row.density)}</td>
      <td class="mc-preview-td">${inputCell('hydroPressure', row.lineKey, row.hydroPressure)}</td>
      <td class="mc-preview-td">${esc(row.wallThickness || '—')}</td>
      <td class="mc-preview-td">${esc(row.corrosion || '—')}</td>
    </tr>`).join('')}</tbody></table></div>`;
  host.querySelectorAll('[data-preview-fallback-field]').forEach((input) => {
    input.addEventListener('input', () => saveProcess(input.getAttribute('data-preview-fallback-linekey') || '', input.getAttribute('data-preview-fallback-field') || '', input.value));
    input.addEventListener('change', () => saveProcess(input.getAttribute('data-preview-fallback-linekey') || '', input.getAttribute('data-preview-fallback-field') || '', input.value));
  });
}
let raf = 0;
function schedule() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => renderFallbackIfNeeded().catch((error) => console.warn('XML->CII fallback preview failed:', error)));
}
function installXmlCiiPreviewBranchFallback() {
  window.installXmlCiiPreviewBranchFallback = installXmlCiiPreviewBranchFallback;
  if (window[FLAG]) return;
  window[FLAG] = true;
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener('click', schedule, true);
  document.addEventListener('change', schedule, true);
  schedule();
}
installXmlCiiPreviewBranchFallback();
