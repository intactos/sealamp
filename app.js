/* ─── Sea Lamp PWA — app.js v1.2 ─── */
/* Pages: 0 (auto-detect) → 1 (setup instructions) → 4 (controls) */
/* Setup WiFi is done on the lamp's own page at 4.3.2.1 (HTTP, in browser). */
/* The PWA (HTTPS) cannot fetch HTTP endpoints — mixed content blocked by Chrome. */

'use strict';

const MDNS_HOST = 'http://seazencity.local';
const LS_KEY    = 'sealamp_host';

let lampHost = '';
let lampOn   = false;
let lampBri  = 255;
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
  // Start automatic polling every 4 seconds
  pollTimer = setInterval(autoSearchLamp, 4000);
  autoSearchLamp(); // Try immediately
}

async function autoSearchLamp() {
  // Try saved host first
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
  // Keep searching...
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



/* ── Page 4: Controls ── */
function connectLamp(host, info) {
  lampHost = host;
  localStorage.setItem(LS_KEY, host);
  showPage(4);

  $('lampName').textContent = (info && info.name) || 'Sea Lamp';
  $('btnFullUI').href = 'http://' + host + '/';
  syncState();
  initColorWheel();
  
  // Initialize preset buttons
  document.querySelectorAll('.preset-btn-vert').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = parseInt(btn.dataset.preset);
      if (preset) applyPreset(preset);
    });
  });

  // Initialize color swatches
  document.querySelectorAll('.swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const color = swatch.dataset.color;
      if (color) setSwatch(color);
    });
  });
  
  // Poll state every 2 seconds to keep UI in sync
  pollTimer = setInterval(syncState, 2000);
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

function openFullControls() {
  if (!lampHost) {
    alert('Lamp not connected');
    return;
  }
  const url = 'http://' + lampHost;
  try {
    const win = window.open(url, '_blank');
    if (win) {
      win.addEventListener('load', () => {
        if (win.document.documentElement.requestFullscreen) {
          win.document.documentElement.requestFullscreen().catch(() => {});
        }
      });
    } else {
      alert('Could not open window. Check if popups are allowed.');
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

/* ── Preset handler ── */
async function applyPreset(num) {
  try {
    await fetch('http://' + lampHost + '/json/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ps: num })
    });
    syncState();
  } catch {}
}

/* ── Swatch handler ── */
async function setSwatch(hex) {
  // Convert hex to RGB
  const rgb = hex.match(/[A-Fa-f0-9]{2}/g).map(x => parseInt(x, 16));
  try {
    await fetch('http://' + lampHost + '/json/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ "seg": [{ "col": [[rgb[0], rgb[1], rgb[2]]] }] })
    });
    syncState();
  } catch {}
}

/* ── Color wheel init (iro.js from unpkg) ── */
let colorWheel = null;
function initColorWheel() {
  if (!lampHost || colorWheel) return;
  
  const wheelEl = $('colorWheel');
  if (!wheelEl) return;
  
  // Load iro.js from unpkg CDN
  const script = document.createElement('script');
  script.src = 'https://unpkg.com/@jaames/iro@5.5.2/dist/iro.min.js';
  script.crossOrigin = 'anonymous';
  script.onload = () => {
    if (window.iro && wheelEl) {
      colorWheel = new iro.ColorPicker(wheelEl, {
        width: 220,
        color: '#ff0000',
        borderWidth: 1,
        borderColor: '#fff',
        layout: [
          {
            component: iro.ui.Wheel,
            options: {}
          }
        ]
      });
      
      // Remove loading text
      const loadingText = $('wheelLoading');
      if (loadingText) loadingText.style.display = 'none';
      
      // Send color on change
      colorWheel.on('color:change', (color) => {
        const rgb = color.rgb;
        fetch('http://' + lampHost + '/json/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ "seg": [{ "col": [[rgb.r, rgb.g, rgb.b]] }] })
        }).catch(() => {});
      });
    }
  };
  script.onerror = () => {
    const loadingText = $('wheelLoading');
    if (loadingText) loadingText.textContent = 'Color wheel failed to load. Use swatches below.';
  };
  document.head.appendChild(script);
}

/* ── Event listeners ── */
$('btnRetryLamp').addEventListener('click', retryLamp);
$('btnPower').addEventListener('click', togglePower);
$('btnFullUI').addEventListener('click', openFullControls);

$('briSlider').addEventListener('change', () => {
  sendBri($('briSlider').value);
});

/* ── Init ── */
initDetect();

/* ── Service Worker ── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
