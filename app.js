/* ─── Sea Lamp PWA — app.js ─── */
/* Thin launcher: detects lamp, provides basic controls, links to full WLED UI */

'use strict';

const AP_BASE   = 'http://4.3.2.1';
const MDNS_HOST = 'seazencity.local';
const LS_KEY    = 'sealamp_host';

let lampHost = localStorage.getItem(LS_KEY) || '';
let lampOn   = false;
let lampBri  = 128;

/* ── DOM refs ── */
const $  = id => document.getElementById(id);
const headline   = $('headline');
const subline    = $('subline');
const setupCard  = $('setupCard');
const controlCard= $('controlCard');
const setupBtns  = $('setupButtons');
const ipBlock    = $('ipBlock');
const ipInput    = $('ipInput');
const ipHint     = $('ipHint');
const btnCheck   = $('btnCheck');
const btnFind    = $('btnFind');
const btnUseIp   = $('btnUseIp');
const btnAutoIp  = $('btnAutoIp');
const btnOn      = $('btnOn');
const btnOff     = $('btnOff');
const briSlider  = $('briSlider');
const briVal     = $('briVal');
const statusDot  = $('statusDot');
const statusText = $('statusText');
const lampAddr   = $('lampAddr');
const btnFullUI  = $('btnFullUI');
const diagEl     = $('diag');

/* ── Helpers ── */
function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const ms   = opts.timeout || 4000;
  const tid  = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal, ...opts })
    .then(r => { clearTimeout(tid); return r.json(); })
    .catch(e => { clearTimeout(tid); throw e; });
}

function diag(msg) {
  const ts = new Date().toLocaleTimeString();
  diagEl.textContent = `[${ts}] ${msg}\n` + diagEl.textContent;
}

/* ── Setup flow ── */
async function checkAP() {
  headline.textContent = 'Checking lamp access point…';
  subline.textContent  = 'Trying to reach ' + AP_BASE;
  diag('Checking AP at ' + AP_BASE);
  try {
    const info = await fetchJson(AP_BASE + '/json/info', { timeout: 2500 });
    diag('AP reachable! Name: ' + (info.name || '?'));
    headline.textContent = 'Lamp found (AP mode)';
    subline.textContent  = 'Connect the lamp to your home Wi-Fi, then come back.';
    return info;
  } catch {
    diag('AP not reachable');
    headline.textContent = 'Lamp not on AP';
    subline.textContent  = 'The lamp may already be on your Wi-Fi, or not powered on.';
    return null;
  }
}

function pickStaIp(info) {
  /* Try to extract the STA IP from WLED json/info */
  if (!info || !info.wifi) return null;
  const ip = info.wifi.bssid ? null : null; // bssid doesn't help
  /* WLED provides "ip" in the nw (network) block in newer versions */
  if (info.nw && info.nw.ins && info.nw.ins.length) {
    for (const n of info.nw.ins) {
      if (n.ip && n.ip !== '0.0.0.0' && n.ip !== '(IP unset)') return n.ip;
    }
  }
  return null;
}

async function autoDetectIp() {
  diag('Trying to get STA IP from AP…');
  try {
    const info = await fetchJson(AP_BASE + '/json/info', { timeout: 2500 });
    const ip   = pickStaIp(info);
    if (ip) {
      diag('Found STA IP: ' + ip);
      ipInput.value = ip;
      ipHint.textContent = 'Detected: ' + ip;
    } else {
      diag('Could not detect STA IP from AP info');
      ipHint.textContent = 'Could not detect IP. Enter it manually.';
    }
  } catch {
    diag('Could not reach AP to detect IP');
    ipHint.textContent = 'AP not reachable. Enter IP manually.';
  }
}

async function tryHost(host) {
  const base = host.startsWith('http') ? host : 'http://' + host;
  diag('Trying ' + base + '…');
  try {
    const info = await fetchJson(base + '/json/info', { timeout: 3000 });
    diag('Lamp reachable at ' + base);
    return { base, info };
  } catch {
    diag('Not reachable: ' + base);
    return null;
  }
}

async function findLamp() {
  headline.textContent = 'Searching for lamp…';
  subline.textContent  = 'Trying mDNS and saved address…';

  /* Try saved host first */
  if (lampHost) {
    const r = await tryHost(lampHost);
    if (r) return connectLamp(r.base, r.info);
  }

  /* Try mDNS */
  const r = await tryHost(MDNS_HOST);
  if (r) return connectLamp(r.base, r.info);

  /* Not found — show IP input */
  headline.textContent = 'Lamp not found';
  subline.textContent  = 'Could not reach the lamp automatically.';
  ipBlock.style.display = '';
  diag('Auto-discovery failed. Manual IP needed.');
}

async function useManualIp() {
  const ip = ipInput.value.trim();
  if (!ip) return;
  const r = await tryHost(ip);
  if (r) return connectLamp(r.base, r.info);
  ipHint.textContent = 'Could not reach lamp at ' + ip;
}

/* ── Connected state ── */
function connectLamp(base, info) {
  lampHost = base.replace(/^https?:\/\//, '');
  localStorage.setItem(LS_KEY, lampHost);
  diag('Connected to ' + lampHost);

  setupCard.style.display   = 'none';
  controlCard.style.display = '';
  lampAddr.textContent = lampHost;
  btnFullUI.href = 'http://' + lampHost;
  statusDot.classList.add('on');
  statusText.textContent = info.name || 'Sea Lamp';

  /* Sync current state */
  syncState();
}

async function syncState() {
  try {
    const state = await fetchJson('http://' + lampHost + '/json/state', { timeout: 3000 });
    lampOn  = !!state.on;
    lampBri = state.bri || 128;
    briSlider.value    = lampBri;
    briVal.textContent = lampBri;
    btnOn.classList.toggle('active', lampOn);
    btnOff.classList.toggle('active', !lampOn);
    statusDot.classList.toggle('on', lampOn);
    diag('State synced: on=' + lampOn + ', bri=' + lampBri);
  } catch (e) {
    diag('Could not sync state: ' + e.message);
  }
}

async function sendState(payload) {
  try {
    await fetch('http://' + lampHost + '/json/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    diag('Sent: ' + JSON.stringify(payload));
    await syncState();
  } catch (e) {
    diag('Send failed: ' + e.message);
  }
}

/* ── Event listeners ── */
btnCheck.addEventListener('click', checkAP);
btnFind.addEventListener('click', findLamp);
btnUseIp.addEventListener('click', useManualIp);
btnAutoIp.addEventListener('click', autoDetectIp);
btnOn.addEventListener('click', () => sendState({ on: true }));
btnOff.addEventListener('click', () => sendState({ on: false }));

briSlider.addEventListener('input', () => {
  briVal.textContent = briSlider.value;
});
briSlider.addEventListener('change', () => {
  sendState({ bri: parseInt(briSlider.value, 10) });
});

/* ── Init ── */
(async function init() {
  diag('PWA loaded. Origin: ' + location.origin);
  diag('Protocol: ' + location.protocol);

  /* If we have a saved host, try it first */
  if (lampHost) {
    diag('Saved host: ' + lampHost);
    const r = await tryHost(lampHost);
    if (r) return connectLamp(r.base, r.info);
    diag('Saved host unreachable, checking AP…');
  }

  /* Quick AP check */
  const info = await checkAP();
  if (info) {
    /* We're on AP — show setup */
    ipBlock.style.display = '';
    autoDetectIp();
  } else {
    /* Not on AP — try mDNS */
    const r = await tryHost(MDNS_HOST);
    if (r) return connectLamp(r.base, r.info);

    headline.textContent = 'Welcome to Sea Lamp';
    subline.textContent  = 'Power on the lamp and connect to its Wi-Fi network, then tap "Check availability".';
    ipBlock.style.display = '';
  }
})();

/* ── Service Worker ── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(e => diag('SW error: ' + e.message));
}
