/* ─── Sea Lamp PWA — app.js v1.2 ─── */
/* Pages: 0 (auto-detect) → 1 (setup instructions) → 4 (controls) */
/* Setup WiFi is done on the lamp's own page at 4.3.2.1 (HTTP, in browser). */
/* The PWA (HTTPS) cannot fetch HTTP endpoints — mixed content blocked by Chrome. */

'use strict';

const MDNS_HOST = 'http://seazencity.local';
const LS_KEY    = 'sealamp_host';

let lampHost = '';
let lampOn   = false;
let lampBri  = 128;
let pollTimer = null;

/* ── Helpers ── */
function $(id) { return document.getElementById(id); }

function fetchJ(url, opts = {}) {
  const c = new AbortController();
  const ms = opts.timeout || 4000;
  const t = setTimeout(() => c.abort(), ms);
  const init = Object.assign({}, opts, { signal: c.signal });
  delete init.timeout;
  return fetch(url, init)
    .then(r => { clearTimeout(t); return r.json(); })
    .catch(e => { clearTimeout(t); throw e; });
}

function showPage(n) {
  clearInterval(pollTimer);
  pollTimer = null;
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  $('page' + n).classList.remove('hidden');
}

/* ── Page 0: Auto-detect ── */
async function initDetect() {
  showPage(0);
  $('p0status').textContent = 'Looking for your lamp…';

  // 1. Saved host
  const saved = localStorage.getItem(LS_KEY);
  if (saved) {
    $('p0status').textContent = 'Reconnecting…';
    try {
      const info = await fetchJ('http://' + saved + '/json/info', { timeout: 3000 });
      return connectLamp(saved, info);
    } catch {
      // Saved lamp is unavailable → recovery mode
      return goPage2();
    }
  }

  // 2. mDNS
  $('p0status').textContent = 'Checking local network…';
  try {
    const info = await fetchJ(MDNS_HOST + '/json/info', { timeout: 3000 });
    return connectLamp('seazencity.local', info);
  } catch {}

  // 3. Not found → setup page (first time)
  goPage1();
}

/* ── Page 1: Setup instructions ── */
function goPage1() {
  showPage(1);
  $('p1searching').classList.add('hidden');
  $('p1notfound').classList.add('hidden');
  $('p1ipblock').classList.add('hidden');
}

/* ── Page 2: Lamp Lost (Recovery) ── */
function goPage2() {
  showPage(2);
  $('p2searching').classList.add('hidden');
}

async function retryLamp() {
  const searchEl = $('p2searching');
  searchEl.classList.remove('hidden');

  // Try saved host
  const saved = localStorage.getItem(LS_KEY);
  if (saved) {
    try {
      const info = await fetchJ('http://' + saved + '/json/info', { timeout: 3000 });
      return connectLamp(saved, info);
    } catch {}
  }

  // Try mDNS
  try {
    const info = await fetchJ(MDNS_HOST + '/json/info', { timeout: 3000 });
    return connectLamp('seazencity.local', info);
  } catch {}

  // Still not found
  searchEl.classList.add('hidden');
}

async function findLamp() {
  const searchEl = $('p1searching');
  const notFound = $('p1notfound');
  const ipBlock  = $('p1ipblock');

  searchEl.classList.remove('hidden');
  notFound.classList.add('hidden');
  ipBlock.classList.add('hidden');

  // Try mDNS
  try {
    const info = await fetchJ(MDNS_HOST + '/json/info', { timeout: 4000 });
    return connectLamp('seazencity.local', info);
  } catch {}

  // Try saved host if different
  const saved = localStorage.getItem(LS_KEY);
  if (saved && saved !== 'seazencity.local') {
    try {
      const info = await fetchJ('http://' + saved + '/json/info', { timeout: 3000 });
      return connectLamp(saved, info);
    } catch {}
  }

  // Not found
  searchEl.classList.add('hidden');
  notFound.classList.remove('hidden');
  ipBlock.classList.remove('hidden');
}

async function useManualIp() {
  const ip = $('ipInput').value.trim();
  if (!ip) return;
  try {
    const info = await fetchJ('http://' + ip + '/json/info', { timeout: 3000 });
    connectLamp(ip, info);
  } catch {
    alert('Could not reach lamp at ' + ip);
  }
}

/* ── Page 4: Controls ── */
function connectLamp(host, info) {
  lampHost = host;
  localStorage.setItem(LS_KEY, host);
  showPage(4);

  $('lampName').textContent = (info && info.name) || 'Sea Lamp';
  $('btnFullUI').href = 'http://' + host;
  syncState();
}

async function syncState() {
  try {
    const s = await fetchJ('http://' + lampHost + '/json/state', { timeout: 3000 });
    lampOn  = !!s.on;
    lampBri = s.bri || 128;
    $('briSlider').value = lampBri;
    updatePowerUI();
  } catch {}
}

function updatePowerUI() {
  $('btnPower').classList.toggle('on', lampOn);
  $('statusDot').classList.toggle('on', lampOn);
}

async function togglePower() {
  try {
    const resp = await fetchJ('http://' + lampHost + '/json/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: 't' }),
      timeout: 3000
    });
    lampOn = !!resp.on;
    lampBri = resp.bri || lampBri;
    $('briSlider').value = lampBri;
    updatePowerUI();
  } catch {}
}

async function sendBri(val) {
  try {
    await fetch('http://' + lampHost + '/json/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bri: parseInt(val, 10) })
    });
  } catch {}
}

function disconnect() {
  localStorage.removeItem(LS_KEY);
  lampHost = '';
  initDetect();
}

/* ── Event listeners ── */
$('btnFindLamp').addEventListener('click', findLamp);
$('btnRetryLamp').addEventListener('click', retryLamp);
$('btnUseIp').addEventListener('click', useManualIp);
$('btnPower').addEventListener('click', togglePower);
$('btnDisconnect').addEventListener('click', e => { e.preventDefault(); disconnect(); });

$('briSlider').addEventListener('change', () => {
  sendBri($('briSlider').value);
});

/* ── Init ── */
initDetect();

/* ── Service Worker ── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
