const FLAG='__xmlCiiWorkflowOrderFix_v1';
function clean(v){return String(v??'').replace(/\s+/g,' ').trim()}
function moveWeightBeforeRun(){
  const roots=document.querySelectorAll('.model-converters-workflow-popup-overlay,.model-converters-root');
  roots.forEach((root)=>{
    const items=Array.from(root.querySelectorAll('button,[role="tab"],.model-converters-workflow-step,.model-converters-workflow-phase,.mc-workflow-step'));
    const weight=items.find((el)=>/4A\s*Weight\s*Match/i.test(clean(el.textContent)));
    const run=items.find((el)=>/^5\s*Run\b/i.test(clean(el.textContent))||/\b5\s*Run\b/i.test(clean(el.textContent)));
    if(weight&&run&&weight.parentElement===run.parentElement){
      const parent=run.parentElement;
      if(Array.from(parent.children).indexOf(weight)>Array.from(parent.children).indexOf(run)) parent.insertBefore(weight,run);
    }
  });
}
let timer=0;function schedule(){clearTimeout(timer);timer=setTimeout(moveWeightBeforeRun,100)}
function installXmlCiiWorkflowOrderFix() {
  window.installXmlCiiWorkflowOrderFix = installXmlCiiWorkflowOrderFix;if(window[FLAG])return;window[FLAG]=true;new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});document.addEventListener('click',schedule,true);schedule()}
installXmlCiiWorkflowOrderFix();
