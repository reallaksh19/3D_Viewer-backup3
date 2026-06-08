const FLAG = '__xmlCiiElementLengthRunPatch_v1';
const RUN_SELECTOR = '#model-converters-run';
const PRIMARY_SELECTOR = '#model-converters-primary-input';
const CONVERTER_SELECTOR = '#model-converters-select';

function text(value) { return value == null ? '' : String(value); }
function clean(value) { return text(value).replace(/\s+/g, ' ').trim(); }
function localName(el) { return clean(el?.localName || el?.nodeName).replace(/^.*:/, '').toLowerCase(); }
function childrenByName(parent, name) { return Array.from(parent?.children || []).filter((el) => localName(el) === name.toLowerCase()); }
function firstChild(parent, name) { return childrenByName(parent, name)[0] || null; }
function firstText(parent, name) { return clean(firstChild(parent, name)?.textContent); }
function ensureChild(doc, parent, name) {
  let child = firstChild(parent, name);
  if (!child) {
    child = parent.namespaceURI ? doc.createElementNS(parent.namespaceURI, name) : doc.createElement(name);
    parent.appendChild(child);
  }
  return child;
}
function point(value) {
  const nums = clean(value).match(/-?\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  return nums.length >= 3 ? nums.slice(0, 3) : null;
}
function distance(a, b) {
  return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) : null;
}
function positiveNodeNumber(node) {
  const value = Number(firstText(node, 'NodeNumber'));
  return Number.isFinite(value) && value > 0;
}
function patchElementLengths(xmlText) {
  if (!/<\s*Branchname\b/i.test(xmlText)) return xmlText;
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) return xmlText;
  let changed = false;
  for (const branch of Array.from(doc.getElementsByTagName('*')).filter((el) => localName(el) === 'branch')) {
     const nodes = childrenByName(branch, 'Node');
     for (let i = 0; i < nodes.length; i += 1) {
       const current = point(firstText(nodes[i], 'Position'));
       if (!current) continue;
       let len = null;
       for (let j = i + 1; j < nodes.length; j += 1) {
         if (!positiveNodeNumber(nodes[j])) continue;
         len = distance(current, point(firstText(nodes[j], 'Position')));
         break;
       }
       if (len != null && Number.isFinite(len)) {
         ensureChild(doc, nodes[i], 'ElementLengthMm').textContent = len.toFixed(3);
         changed = true;
       }
     }
   }
  return changed ? new XMLSerializer().serializeToString(doc) : xmlText;
}
async function handleRunClick(event) {
  const run = event.target?.closest?.(RUN_SELECTOR);
  if (!run || run.dataset.xmlCiiElementLengthPatched === 'true') return;
  const converter = document.querySelector(CONVERTER_SELECTOR)?.value || '';
  if (converter !== 'xml_to_cii') return;
  const input = document.querySelector(PRIMARY_SELECTOR);
  const file = input?.files?.[0];
  if (!file || !/\.xml$/i.test(file.name || '')) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  const original = await file.text();
  const patched = patchElementLengths(original);
  if (patched !== original) {
    const nextFile = new File([patched], file.name, { type: file.type || 'application/xml', lastModified: file.lastModified });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(nextFile);
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  run.dataset.xmlCiiElementLengthPatched = 'true';
  run.click();
  setTimeout(() => { delete run.dataset.xmlCiiElementLengthPatched; }, 0);
}
function installXmlCiiElementLengthRunPatch() {
  if (window[FLAG]) return;
  window[FLAG] = true;
  window.installXmlCiiElementLengthRunPatch = installXmlCiiElementLengthRunPatch;
  document.addEventListener('click', (event) => { void handleRunClick(event); }, true);
}
installXmlCiiElementLengthRunPatch();
