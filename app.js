/* ─── Sea Lamp PWA — app.js v3.4 ─── */
/* Pages: 0 (auto-detect) → 1 (setup instructions) → 4 (controls) */

'use strict';

var APP_VERSION = '3.5';

const MDNS_HOST = 'http://seazencity.local';
const LS_KEY    = 'sealamp_host';

let lampHost = '';
let lampOn   = false;
let lampBri  = 255;
let lastFx   = 0;
let lastColor = { r: 255, g: 0, b: 0 };
let pollId    = null;   // setTimeout id (NOT setInterval)
let polling   = false;  // guard against overlapping polls
var fading    = false;  // true while waiting for fade confirmation

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
  clearTimeout(pollId);  pollId  = null;
  polling = false;
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
    } catch(e) {
      // Saved lamp is unavailable → recovery mode
      return goPage2();
    }
  }

  // 2. mDNS
  $('p0status').textContent = 'Checking local network…';
  try {
    const info = await fetchJ(MDNS_HOST + '/json/info', { timeout: 3000 });
    return connectLamp('seazencity.local', info);
  } catch(e) {}

  // 3. Not found → setup page (first time)
  goPage1();
}

/* ── Page 1: Setup instructions ── */
function goPage1() {
  showPage(1);
  autoSearchLoop();
}

async function autoSearchLoop() {
  await autoSearchLamp();
  if (!lampHost) pollId = setTimeout(autoSearchLoop, 4000);
}

async function autoSearchLamp() {
  // Try saved host first
  const saved = localStorage.getItem(LS_KEY);
  if (saved) {
    try {
      const info = await fetchJ('http://' + saved + '/json/info', { timeout: 3000 });
      return connectLamp(saved, info);
    } catch(e) {}
  }

  // Try mDNS
  try {
    const info = await fetchJ(MDNS_HOST + '/json/info', { timeout: 3000 });
    return connectLamp('seazencity.local', info);
  } catch(e) {}
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
    } catch(e) {}
  }

  // Try mDNS
  try {
    const info = await fetchJ(MDNS_HOST + '/json/info', { timeout: 3000 });
    return connectLamp('seazencity.local', info);
  } catch(e) {}

  // Still not found
  searchEl.classList.add('hidden');
}



/* ── Page 4: Controls ── */
async function connectLamp(host, info) {
  lampHost = host;
  localStorage.setItem(LS_KEY, host);
  showPage(4);

  $('lampName').textContent = (info && info.name) || 'Sea Lamp';
  $('btnFullUI').href = 'http://' + host + '/';

  // Show loaded version on page FIRST so we can verify code is running
  try {
    const verEl = document.getElementById('appVersion');
    if (verEl) verEl.textContent = 'v3.25 / JS ' + APP_VERSION;
  } catch (e) {}

  // Sync state (get real color, brightness, on/off)
  try { await syncState(); } catch (e) {}

  loadPresetNames();
  initColorWheel();   // now lastColor is real, not the default red
  
  // Initialize preset buttons
  document.querySelectorAll('.preset-btn-vert').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = parseInt(btn.dataset.preset);
      if (preset === 1) {
        // Solid Color button - just set current color from wheel
        applySolidColor();
      } else if (preset) {
        applyPreset(preset);
      }
    });
  });

  // Initialize color swatches
  document.querySelectorAll('.swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const color = swatch.dataset.color;
      if (color) setSwatch(color);
    });
  });
  
  // Start poll loop (state only, lightweight)
  schedulePoll(0);
}

function schedulePoll(delayMs) {
  clearTimeout(pollId);
  pollId = setTimeout(runPoll, delayMs);
}

async function runPoll() {
  if (polling || fading) return;
  polling = true;
  try {
    await syncState();
  } catch(e) {}
  polling = false;
  pollId = setTimeout(runPoll, 10000);   // lightweight state poll every 10s
}

async function syncState() {
  try {
    const s = await fetchJ('http://' + lampHost + '/json/state', { timeout: 3000 });
    lampOn  = !!s.on;
    lampBri = s.bri || 128;
    if (Array.isArray(s.seg) && s.seg[0]) {
      lastFx = typeof s.seg[0].fx === 'number' ? s.seg[0].fx : lastFx;
      if (Array.isArray(s.seg[0].col) && s.seg[0].col[0] && s.seg[0].col[0].length >= 3) {
        lastColor = { r: s.seg[0].col[0][0], g: s.seg[0].col[0][1], b: s.seg[0].col[0][2] };
      }
    }
    $('briSlider').value = lampBri;
    updatePowerUI();

    // Keep color wheel in sync (won't fire input:change, only color:change which we ignore)
    if (colorWheel) {
      const wc = colorWheel.color.rgb;
      if (wc.r !== lastColor.r || wc.g !== lastColor.g || wc.b !== lastColor.b) {
        wheelReady = false;
        colorWheel.color.rgb = lastColor;
        setTimeout(() => { wheelReady = true; }, 100);
      }
    }
  } catch(e) {}
}

function updatePowerUI() {
  $('btnPower').classList.toggle('on', lampOn);
  $('statusDot').classList.toggle('on', lampOn);
}



async function postState(payload) {
  return fetch('http://' + lampHost + '/json/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

function togglePower() {
  if (fading) return;
  fading = true;

  if (!lampOn) {
    // ── ON: WLED native transition handles smooth fade (1.5s default) ──
    postState({ on: true })
      .then(function() {
        lampOn = true;
        updatePowerUI();
        fading = false;
        schedulePoll(2000);
      })
      .catch(function(e) { fading = false; });
  } else {
    // ── OFF: WLED native transition handles smooth fade ──
    postState({ on: false })
      .then(function() {
        lampOn = false;
        updatePowerUI();
        fading = false;
        schedulePoll(2000);
      })
      .catch(function(e) { fading = false; });
  }
}

async function sendBri(val) {
  try {
    await postState({ bri: parseInt(val, 10) });
    schedulePoll(400);
  } catch(e) {}
}

function disconnect() {
  localStorage.removeItem(LS_KEY);
  lampHost = '';
  initDetect();
}

function openFullControls() {
  if (!lampHost) return;
  window.open('http://' + lampHost, '_blank');
}

/* ── Solid Color button handler ── */
async function applySolidColor() {
  // Read the color directly from the Color Wheel (not lastColor which syncState overwrites)
  let r = lastColor.r, g = lastColor.g, b = lastColor.b;
  if (colorWheel) {
    const rgb = colorWheel.color.rgb;
    r = rgb.r; g = rgb.g; b = rgb.b;
  }
  try {
    // Use single-segment object format (simpler, no array needed)
    await postState({ on: true, seg: { col: [[r, g, b]], fx: 0 } });
    await syncState();
    schedulePoll(1000);

  } catch(e) {}
}

/* ── Preset handler ── */
async function applyPreset(num) {
  try {
    await postState({ ps: num });
    await syncState();
    schedulePoll(2000);
  } catch(e) {}
}

/* ── Load preset names from API ── */
async function loadPresetNames() {
  try {
    const presets = await fetchJ('http://' + lampHost + '/presets.json', { timeout: 3000 });
    
    // Update preset names (2-6) from API
    for (let i = 2; i <= 6; i++) {
      var btn = document.querySelector('[data-preset="' + i + '"]');
      if (btn) {
        var nameEl = btn.querySelector('.preset-name');
        if (nameEl && presets[i]) {
          var presetData = presets[i];
          var presetName = presetData.n || ('Preset ' + i);
          nameEl.textContent = presetName;
        }
      }
    }
  } catch(e) {
    // If loading fails, keep default "Preset N" names
  }
}

/* ── Swatch handler ── */
async function setSwatch(hex) {
  // Convert hex to RGB
  const rgb = hex.match(/[A-Fa-f0-9]{2}/g).map(x => parseInt(x, 16));
  lastColor = { r: rgb[0], g: rgb[1], b: rgb[2] };
  
  // Update color wheel to match swatch (suppress its event)
  if (colorWheel) {
    wheelReady = false;
    colorWheel.color.rgb = { r: rgb[0], g: rgb[1], b: rgb[2] };
    setTimeout(() => { wheelReady = true; }, 200);
  }
  
  try {
    await postState({ seg: [{ col: [[rgb[0], rgb[1], rgb[2]]] }] });
    await syncState();
    schedulePoll(2000);
  } catch(e) {}
}

/* ── Color wheel init (iro.js from unpkg) ── */
let colorWheel = null;
let wheelReady = false; // suppress initial color:change

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
      const initClr = 'rgb(' + lastColor.r + ',' + lastColor.g + ',' + lastColor.b + ')';
      console.log('[SeaLamp] creating color wheel with:', initClr);
      colorWheel = new iro.ColorPicker(wheelEl, {
        width: 220,
        color: initClr,
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
      
      // Suppress the initial color:change that fires on creation
      setTimeout(() => { wheelReady = true; }, 200);

      // Send color on input (fires continuously while dragging)
      let wheelDebounce = null;
      colorWheel.on('input:change', (color) => {
        if (!wheelReady) return;
        const rgb = color.rgb;
        lastColor = { r: rgb.r, g: rgb.g, b: rgb.b };
        // Throttled POST: only send every 150ms while dragging
        clearTimeout(wheelDebounce);
        wheelDebounce = setTimeout(() => {
          postState({ seg: [{ col: [[rgb.r, rgb.g, rgb.b]] }], tt: 4 }).catch(() => {});
        }, 150);
      });

      // Final color when user lifts finger
      colorWheel.on('input:end', (color) => {
        if (!wheelReady) return;
        const rgb = color.rgb;
        lastColor = { r: rgb.r, g: rgb.g, b: rgb.b };
        postState({ seg: [{ col: [[rgb.r, rgb.g, rgb.b]] }] }).catch(() => {});
        schedulePoll(300);
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
