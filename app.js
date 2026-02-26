/* ─── Sea Lamp PWA — app.js v1.7 ─── */
/* Pages: 0 (auto-detect) → 1 (setup instructions) → 4 (controls) */
/* Setup WiFi is done on the lamp's own page at 4.3.2.1 (HTTP, in browser). */
/* The PWA (HTTPS) cannot fetch HTTP endpoints — mixed content blocked by Chrome. */

'use strict';

const MDNS_HOST = 'http://seazencity.local';
const LS_KEY    = 'sealamp_host';

let lampHost = '';
let lampOn   = false;
let lampBri  = 255;
let lastFx   = 0;
let lastColor = { r: 255, g: 0, b: 0 };
let pollTimer = null;
let fadingNow = false; // true during soft-fade, pauses sync

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
  loadPresetNames();
  initColorWheel();
  
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
  
  // Poll lamp: state + preview, sequential (don't overwhelm ESP)
  pollTimer = setInterval(pollCycle, 2500);
  pollCycle(); // first call immediately
}

async function pollCycle() {
  if (fadingNow) return; // don't poll during soft-fade
  await syncState();
  await updateLEDPreview();
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
  } catch {}
}

function updatePowerUI() {
  $('btnPower').classList.toggle('on', lampOn);
  $('statusDot').classList.toggle('on', lampOn);
}

async function updateLEDPreview() {
  const el = $('ledPreview');
  if (!el || !lampHost) return;
  try {
    const live = await fetchJ('http://' + lampHost + '/json/live', { timeout: 3000 });
    if (!live || !Array.isArray(live.leds) || live.leds.length === 0) return;

    const total = live.leds.length;
    const count = Math.min(30, total);
    const step  = Math.max(1, Math.floor(total / count));

    el.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const hex = live.leds[i * step] || '000000';
      // WLED returns "RRGGBB" (6 chars) or "WWRRGGBB" (8 chars)
      const rgb = hex.length > 6 ? hex.substring(2) : hex;
      const d = document.createElement('div');
      d.className = 'led';
      d.style.backgroundColor = '#' + rgb;
      el.appendChild(d);
    }
  } catch {}
}

async function postState(payload) {
  return fetch('http://' + lampHost + '/json/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function togglePower() {
  try {
    if (!lampOn) {
      if (lastFx === 0) {
        // Solid color mode → soft fade via JS brightness ramp
        fadingNow = true;
        const target = parseInt($('briSlider').value, 10) || lampBri || 128;
        // Step 1: turn on at minimum brightness (instant)
        await postState({ on: true, bri: 1, transition: 0 });
        // Step 2: ramp brightness in 7 steps over ~2.8 seconds
        const fracs = [0.04, 0.12, 0.25, 0.42, 0.62, 0.82, 1.0];
        for (const f of fracs) {
          await new Promise(r => setTimeout(r, 400));
          const bri = Math.max(1, Math.round(target * f));
          try { await postState({ bri: bri, transition: 0 }); } catch {}
        }
        fadingNow = false;
      } else {
        // Effect mode → just turn on (WLED restores last effect)
        await postState({ on: true });
      }
    } else {
      // Turning OFF
      await postState({ on: false });
    }
    await syncState();
  } catch { fadingNow = false; }
}

async function sendBri(val) {
  try { await postState({ bri: parseInt(val, 10) }); } catch {}
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
  } catch {}
}

/* ── Preset handler ── */
async function applyPreset(num) {
  try {
    await postState({ ps: num });
    await syncState();
  } catch {}
}

/* ── Load preset names from API ── */
async function loadPresetNames() {
  try {
    const presets = await fetchJ('http://' + lampHost + '/presets.json', { timeout: 3000 });
    
    // Update preset names (2-6) from API
    for (let i = 2; i <= 6; i++) {
      const btn = document.querySelector(`[data-preset="${i}"]`);
      if (btn) {
        const nameEl = btn.querySelector('.preset-name');
        if (nameEl && presets[i]) {
          const presetData = presets[i];
          const presetName = presetData.n || `Preset ${i}`;
          nameEl.textContent = presetName;
        }
      }
    }
  } catch {
    // If loading fails, keep default "Preset N" names
  }
}

/* ── Swatch handler ── */
async function setSwatch(hex) {
  // Convert hex to RGB
  const rgb = hex.match(/[A-Fa-f0-9]{2}/g).map(x => parseInt(x, 16));
  lastColor = { r: rgb[0], g: rgb[1], b: rgb[2] };
  
  // Update color wheel to match swatch
  if (colorWheel) {
    colorWheel.color.rgb = { r: rgb[0], g: rgb[1], b: rgb[2] };
  }
  
  try {
    await postState({ seg: [{ col: [[rgb[0], rgb[1], rgb[2]]] }] });
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
        lastColor = { r: rgb.r, g: rgb.g, b: rgb.b };
        postState({ seg: [{ col: [[rgb.r, rgb.g, rgb.b]] }] }).catch(() => {});
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
