import { loadStickyState, state, setActiveTab } from './state.js';
import { RuntimeEvents } from '../contracts/runtime-events.js';
import { renderViewer3D } from '../tabs/viewer3d-tab.js?v=20260518-statusbar-theme-12';
import { renderViewer3DRvm } from '../tabs/viewer3d-rvm-tab.js?v=20260518-statusbar-theme-12';
import { renderBasicGlbPcfPanel } from '../js/pcf2glb/ui/BasicGlbPcfPanel.js';
import { renderPcfxConverterTab } from '../tabs/pcfx-converter-tab.js';
import { renderModelExchangeTab } from '../tabs/model-exchange-tab.js';
import { renderInterchangeConfigTab } from '../tabs/interchange-config-tab.js';
import { renderSupportMappingConfigTab } from '../tabs/support-mapping-config-tab.js';
import { renderAdapterMappingTab } from '../tabs/adapter-mapping-tab.js';
import { mount as mountRvmJsonPcfExtractTab } from '../tabs/rvm-json-pcf-extract-tab.js';
import { renderUniversalXmlConverterTab } from '../tabs/universal-xml-converter-tab.js';
import { renderXmlCompareTab } from '../tabs/xml-compare-tab.js';
import { emit, on } from './event-bus.js';
import { initDevDebugWindow, destroyDevDebugWindow } from '../debug/dev-debug-window.js';
import { loadRvmSource } from '../rvm/RvmLoadPipeline.js';
import { RvmStaticBundleLoader } from '../rvm/RvmStaticBundleLoader.js';
import { RvmHelperBridge } from '../converters/rvm-helper-bridge.js';
import { RvmGitHubActionsBridge } from '../converters/rvm-github-bridge.js';
import { convertRevFileToAvevaHierarchy } from '../rvm/RevLocalLoader.js?v=20260508-control-counts';
import { showToast } from './toast.js';
import { showLoading, hideLoading } from './loading.js';
import { requestPat } from './pat-modal.js';

const TAB_CONFIG_URL = './opt/tab-visibility.json';

const IS_DEV = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

function _renderHome(container) {
  container.innerHTML = `
    <section style="padding:20px;min-height:100%;font-family:system-ui;background:#0f1724;color:#d9e6f7;">
      <h1 style="margin:0 0 8px;color:#8fc5ff;">PCF / GLB / RVM Viewer</h1>
      <p style="margin:0;color:#a9bad0;">Select a tab to load that module. Model Converters are loaded only when opened.</p>
    </section>`;
  return null;
}

async function renderEnhancedModelConvertersTab(container) {
  const { renderModelConvertersTab } = await import('../tabs/model-converters-tab.js?v=20260608-core-safe-1');
  const destroyBase = renderModelConvertersTab(container);
  let destroyEnhancer = null;
  let destroyNpsEnhancer = null;

  try {
    await import('../tabs/xml-cii-linelist-smart-map.js?v=20260608-linelist-smart-map-3');
  } catch (error) {
    console.warn('[model-converters] XML CII line-list smart map skipped:', error);
  }

  try {
    await import('../tabs/xml-cii-hydro-ui-patch.js?v=20260608-hydro-ui-no-panel-4');
  } catch (error) {
    console.warn('[model-converters] XML CII line list/hydro repair skipped:', error);
  }

  try {
    await import('../tabs/xml-cii-regex-preview-fix.js?v=20260608-regex-preview-1');
  } catch (error) {
    console.warn('[model-converters] XML CII regex preview fix skipped:', error);
  }

  try {
    await import('../tabs/xml-cii-workflow-order-fix.js?v=20260608-workflow-order-1');
  } catch (error) {
    console.warn('[model-converters] XML CII workflow order fix skipped:', error);
  }

  try {
    await import('../tabs/xml-cii-default-master-autoload-lite.js?v=20260608-material-weight-defaults-3');
  } catch (error) {
    console.warn('[model-converters] XML CII material/weight default autoload skipped:', error);
  }

  try {
    await import('../tabs/xml-cii-specwise-pipingclass-loader.js?v=20260608-specwise-pipingclass-2');
  } catch (error) {
    console.warn('[model-converters] XML CII specwise piping-class loader skipped:', error);
  }

  try {
    await import('../tabs/xml-cii-preview-branch-fallback.js?v=20260608-preview-branch-fallback-1');
  } catch (error) {
    console.warn('[model-converters] XML CII preview branch fallback skipped:', error);
  }

  try {
    await import('../tabs/xml-cii-preview-stable-patch.js?v=20260608-preview-stable-2');
  } catch (error) {
    console.warn('[model-converters] XML CII stable preview patch skipped:', error);
  }

  try {
    await import('../tabs/xml-cii-run-input-process-patch.js?v=20260608-run-input-process-4');
  } catch (error) {
    console.warn('[model-converters] XML CII run input process patch skipped:', error);
  }

  try {
    const { enhanceModelConvertersTab } = await import('../tabs/model-converters-ui-enhancements.js?v=20260608-core-safe-1');
    destroyEnhancer = enhanceModelConvertersTab(container);
  } catch (error) {
    console.warn('[model-converters] UI enhancement skipped:', error);
  }

  try {
    const { enhanceNpsBoreMasterTab } = await import('../tabs/nps-bore-master-enhancements.js?v=20260608-core-safe-1');
    destroyNpsEnhancer = enhanceNpsBoreMasterTab(container);
  } catch (error) {
    console.warn('[model-converters] NPS/Bore enhancement skipped:', error);
  }

  return () => {
    try { destroyNpsEnhancer?.(); } catch {}
    try { destroyEnhancer?.(); } catch {}
    try { destroyBase?.(); } catch {}
  };
}

const TABS = [
  { id: 'home',         label: 'Home',          group: 'Start', render: _renderHome },
  { id: 'viewer3d',     label: '3D Viewer',     group: 'Viewers', render: renderViewer3D },
  { id: 'viewer3d-rvm', label: '3D RVM Viewer', group: 'Viewers', render: renderViewer3DRvm },
  { id: 'rvm-json-pcf-extract',    label: 'JSON → PCF Extract',     group: 'Extraction', render: (container, ctx) => mountRvmJsonPcfExtractTab(container, ctx) },
  { id: 'universal-xml-converter', label: 'XML Converter',           group: 'Extraction', render: renderUniversalXmlConverterTab },
  { id: 'xml-compare',             label: 'XML Compare',             group: 'Extraction', render: renderXmlCompareTab },
  { id: 'model-converters', label: 'Model Converters',  group: 'Convert', render: renderEnhancedModelConvertersTab },
  { id: 'model-exchange',   label: 'Format Converter',  group: 'Convert', render: renderModelExchangeTab },
  { id: 'interchange-config',    label: 'Converter Config', group: 'Config', render: renderInterchangeConfigTab },
  { id: 'support-mapping-config', label: 'Support Config',  group: 'Config', render: renderSupportMappingConfigTab },
  { id: 'adapter-mapping',        label: '⚙ Adapter Config', group: 'Config', render: renderAdapterMappingTab },
  ...(IS_DEV ? [
    { id: 'adv-glb',        label: 'Basic GLB/PCF Viewer', group: 'Dev', render: renderBasicGlbPcfPanel },
    { id: 'pcfx-converter', label: 'PCF↔PCFX↔GLB',        group: 'Dev', render: renderPcfxConverterTab },
  ] : []),
];

let _visibleTabs = [...TABS];
let _switchHandlerBound = false;

export async function init() {
  loadStickyState();
  if (IS_DEV) {
    try { destroyDevDebugWindow(); } catch {}
  }
  _visibleTabs = await _loadVisibleTabs();
  _buildTabBar();
  _bindAppSwitchHandler();
  _bindGlobalEvents();
  setActiveTab(_initialTabId());
}

function _initialTabId() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('tab') || window.location.hash.replace(/^#/, '');
  if (requested && _visibleTabs.some((tab) => tab.id === requested)) return requested;
  if (state.activeTab && state.activeTab !== 'summary' && state.activeTab !== 'model-converters' && _visibleTabs.some((tab) => tab.id === state.activeTab)) {
    return state.activeTab;
  }
  return _visibleTabs.some((tab) => tab.id === 'home') ? 'home' : (_visibleTabs[0]?.id || 'viewer3d');
}

async function _loadVisibleTabs() {
  try {
    const response = await fetch(TAB_CONFIG_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    if (!config || typeof config !== 'object') return [...TABS];
    const hidden = new Set(Array.isArray(config.hiddenTabs) ? config.hiddenTabs : []);
    const order = Array.isArray(config.order) ? config.order : [];
    const tabById = new Map(TABS.map((tab) => [tab.id, tab]));
    const ordered = [];
    if (tabById.has('home') && !hidden.has('home')) ordered.push(tabById.get('home'));
    for (const id of order) {
      const tab = tabById.get(id);
      if (tab && !hidden.has(id) && !ordered.includes(tab)) ordered.push(tab);
    }
    for (const tab of TABS) {
      if (!hidden.has(tab.id) && !ordered.includes(tab)) ordered.push(tab);
    }
    return ordered;
  } catch (error) {
    console.warn('[tabs] Failed to load tab visibility config:', error);
    return [...TABS];
  }
}

function _buildTabBar() {
  const tabBar = document.getElementById('tab-bar');
  if (!tabBar) return;
  tabBar.innerHTML = '';
  const groups = new Map();
  for (const tab of _visibleTabs) {
    if (!groups.has(tab.group)) groups.set(tab.group, []);
    groups.get(tab.group).push(tab);
  }
  for (const [group, tabs] of groups) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tab-group';
    const label = document.createElement('div');
    label.className = 'tab-group-label';
    label.textContent = group;
    wrapper.appendChild(label);
    for (const tab of tabs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tab-btn';
      button.dataset.tab = tab.id;
      button.textContent = tab.label;
      wrapper.appendChild(button);
    }
    tabBar.appendChild(wrapper);
  }
}

function _bindAppSwitchHandler() {
  if (_switchHandlerBound) return;
  _switchHandlerBound = true;
  const tabBar = document.getElementById('tab-bar');
  tabBar?.addEventListener('click', (event) => {
    const button = event.target?.closest?.('.tab-btn');
    if (!button) return;
    const tabId = button.dataset.tab;
    if (tabId) setActiveTab(tabId);
  });
}

function _bindGlobalEvents() {
  on(RuntimeEvents.TAB_CHANGED, (tabId) => {
    void _renderActiveTab(tabId);
  });
}

let _destroyActiveTab = null;
let _renderSerial = 0;
async function _renderActiveTab(tabId) {
  const serial = ++_renderSerial;
  const container = document.getElementById('app') || document.getElementById('tab-content');
  if (!container) return;
  try { _destroyActiveTab?.(); } catch {}
  _destroyActiveTab = null;
  const tab = _visibleTabs.find((entry) => entry.id === tabId) || _visibleTabs.find((entry) => entry.id === 'home') || _visibleTabs[0];
  document.querySelectorAll('.tab-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab?.id);
  });
  container.innerHTML = '';
  if (!tab) return;
  if (tab.id !== 'home') {
    const loading = document.createElement('div');
    loading.className = 'model-converters-muted';
    loading.style.cssText = 'padding:16px;color:#9fb2c7;font-family:system-ui';
    loading.textContent = `Loading ${tab.label}…`;
    container.appendChild(loading);
  }
  try {
    const destroy = await tab.render(container, { state, emit, showToast, showLoading, hideLoading, requestPat, loadRvmSource, RvmStaticBundleLoader, RvmHelperBridge, RvmGitHubActionsBridge, convertRevFileToAvevaHierarchy });
    if (serial !== _renderSerial) {
      try { destroy?.(); } catch {}
      return;
    }
    _destroyActiveTab = typeof destroy === 'function' ? destroy : null;
  } catch (error) {
    if (serial !== _renderSerial) return;
    console.error(error);
    container.innerHTML = `<div class="error-card">Failed to render ${tab?.label || 'tab'}: ${String(error?.message || error)}</div>`;
  }
}
