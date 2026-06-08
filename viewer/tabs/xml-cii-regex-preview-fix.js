const FLAG='__xmlCiiRegexPreviewFix_v1';
const POP='.model-converters-workflow-popup-overlay .model-converters-workflow-popup';
const PRIMARY='#model-converters-primary-input';
const clean=(v)=>String(v??'').replace(/\s+/g,' ').trim();
const esc=(v)=>String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lname=(el)=>clean(el?.localName||el?.nodeName).replace(/^.*:/,'').toLowerCase();
function childText(parent,name){return clean(Array.from(parent?.children||[]).find((el)=>lname(el)===name.toLowerCase())?.textContent)}
function tokens(branch,delim='-'){return clean(branch).replace(/^\/+|\/B\d+$/gi,'').split(delim||'-').map((x)=>x.trim()).filter(Boolean)}
function positions(value){return String(value||'4').split(/[,+]/).map((x)=>Number(x.trim())).filter((n)=>Number.isFinite(n)&&n>0)}
function keyFrom(branch,delim,pos,joiner=''){const t=tokens(branch,delim);return positions(pos).map((p)=>t[Math.round(p)-1]||'').filter(Boolean).join(joiner)}
function invalidSample(v){const s=clean(v);return !s||/\brows?\b/i.test(s)||(!s.includes('/')&&!s.includes('-'))}
async function firstBranch(){const file=document.querySelector(PRIMARY)?.files?.[0];if(!file||!/\.xml$/i.test(file.name||''))return'';let xml='';try{xml=await file.text()}catch{return''}try{const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))return'';for(const b of Array.from(doc.getElementsByTagName('*')).filter((e)=>lname(e)==='branch')){const n=childText(b,'branchname')||clean(b.getAttribute('branchname')||b.getAttribute('name'));if(n)return n}}catch{}return''}
async function fix(){const popup=document.querySelector(POP);if(!popup)return;const sample=popup.querySelector('[data-xml-cii-regex-path="linelist.sampleBranchName"]');const pos=popup.querySelector('[data-xml-cii-regex-path="linelist.lineKeyTokenPositions"]');if(!sample||!pos)return;if(invalidSample(sample.value)){const b=await firstBranch();if(b){sample.value=b;sample.dispatchEvent(new Event('input',{bubbles:true}));sample.dispatchEvent(new Event('change',{bubbles:true}))}}const delim=popup.querySelector('[data-xml-cii-regex-path="linelist.tokenDelimiter"]')?.value||'-';const joiner=popup.querySelector('[data-xml-cii-regex-path="linelist.lineKeyJoiner"]')?.value||'';const key=keyFrom(sample.value,delim,pos.value||'4',joiner);const row=Array.from(popup.querySelectorAll('.mc-regex-extract-table tbody tr')).find((tr)=>/^line\s*key$/i.test(clean(tr.children?.[0]?.textContent)));const strong=row?.querySelector('.mc-regex-preview-cell strong');if(strong)strong.textContent=key||'—';const body=popup.querySelector('.mc-regex-tokens-table tbody');if(body)body.innerHTML=tokens(sample.value,delim).map((tok,i)=>`<tr><td>${i+1}</td><td>${esc(tok)}</td></tr>`).join('')}
let timer=0;function schedule(){clearTimeout(timer);timer=setTimeout(()=>fix().catch((e)=>console.warn('XML->CII regex preview fix failed:',e)),120)}
function installXmlCiiRegexPreviewFix() {
  window.installXmlCiiRegexPreviewFix = installXmlCiiRegexPreviewFix;if(window[FLAG])return;window[FLAG]=true;new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});document.addEventListener('click',schedule,true);document.addEventListener('input',schedule,true);document.addEventListener('change',schedule,true);schedule()}
installXmlCiiRegexPreviewFix();
