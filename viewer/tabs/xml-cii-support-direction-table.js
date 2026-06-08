const FLAG = '__xmlCiiSupportDirectionTable_v1';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ROWS = [
  ['REST / SHOE / SADDLE / PAD / WEAR PLATE', '+Y', '+Y', '14', '0, 1, 0', 'Vertical upward support/rest on shoe. Keep +Y in enriched XML and emit CII code 14 with Y direction cosine.'],
  ['GUIDE / GUI / PDO-TYPE-603', 'GUI', 'GUI', '8', '—', 'Guide restraint. CAESAR does not use the REST +Y direction cosine for GUI.'],
  ['LINE STOP / LINESTOP / LIMIT / DIRECTIONAL ANCHOR / XST', 'LIM', 'LIM', '9', '—', 'Limit stop / line stop.'],
  ['ANCHOR / FIXED / FIX', 'ANC', 'ANC', '1', '—', 'Full anchor.'],
  ['SPRING / HANGER', 'YSPR', 'YSPR', '55', '—', 'Spring support placeholder; detailed hanger data belongs in HANGER records.'],
];

function tableHtml() {
  return `<div class="xml-cii-direction-ref" style="margin:8px 0 12px 0;border:1px solid #26384f;border-radius:6px;overflow:auto;background:#0f1724;">
    <div style="padding:7px 8px;color:#9cc5ff;font-weight:700;border-bottom:1px solid #26384f;">Support Mapping and CII Direction Cosines</div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;min-width:760px;">
      <thead><tr>${['Keyword / DTXR text', 'XML Restraint Type', 'CII Type', 'CII Code', 'Direction cosine', 'Notes'].map((h) => `<th style="text-align:left;padding:6px;border-bottom:1px solid #26384f;color:#8ba0c2;">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${ROWS.map((r) => `<tr>${r.map((v, i) => `<td style="padding:6px;border-bottom:1px solid #1e2d42;color:${i === 4 && v !== '—' ? '#5df0a0' : '#cfe2ff'};vertical-align:top;">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function patchPanel() {
  document.querySelectorAll('.support-mapper-panel').forEach((panel) => {
    if (panel.querySelector('.xml-cii-direction-ref')) return;
    const anchor = panel.children[1] || panel.firstElementChild;
    anchor?.insertAdjacentHTML('afterend', tableHtml());
  });
}

let timer = 0;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(patchPanel, 100);
}

function installXmlCiiSupportDirectionTable() {
  window.installXmlCiiSupportDirectionTable = installXmlCiiSupportDirectionTable;
  if (window[FLAG]) return;
  window[FLAG] = true;
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
}

installXmlCiiSupportDirectionTable();
