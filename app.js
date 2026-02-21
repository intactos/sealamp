/* ─── Sea Lamp PWA — app.js v1.1 ─── */
/* Step-by-step wizard: detect → connect AP → pick WiFi → reconnect → controls */

'use strict';

const AP_BASE   = 'http://4.3.2.1';
const MDNS_HOST = 'http://seazencity.local';
const LS_KEY    = 'sealamp_host';

let lampHost = '';   // e.g. "seazencity.local" or "192.168.1.73"
let lampOn   = false;
let lampBri  = 128;
let pollTimer = null;
let chosenSSID = '';

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
    } catch {}
  }

  // 2. mDNS
  $('p0status').textContent = 'Checking local network…';
  try {
    const info = await fetchJ(MDNS_HOST + '/json/info', { timeout: 3000 });
    return connectLamp('seazencity.local', info);
  } catch {}

  // 3. AP
  $('p0status').textContent = 'Checking access point…';
  try {
    await fetchJ(AP_BASE + '/json/info', { timeout: 2500 });
    return goPage2();
  } catch {}

  // 4. Nothing found
  goPage1();
}

/* ── Page 1: Connect to lamp WiFi ── */
function goPage1() {
  showPage(1);
  $('p1status').textContent = 'Waiting for connection…';
  pollTimer = setInterval(async () => {
    try {
      await fetchJ(AP_BASE + '/json/info', { timeout: 2000 });
      goPage2();
    } catch {}
  }, 2000);
}

/* ── Page 2: Pick WiFi ── */
async function goPage2() {
  showPage(2);
  $('ssidInput').value = '';
  $('pskInput').value = '';
  chosenSSID = '';
  await scanNetworks();
}

async function scanNetworks() {
  const listEl = $('wifiList');
  listEl.innerHTML = '<p class="muted small">Scanning…</p>';

  // Kick off scan
  try { await fetchJ(AP_BASE + '/json/net', { timeout: 3000 }); } catch {}

  // Poll for results (up to 8 tries, 1.5s apart)
  let nets = [];
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const data = await fetchJ(AP_BASE + '/json/net', { timeout: 3000 });
      if (data.networks && data.networks.length > 0) {
        nets = data.networks;
        break;
      }
    } catch {}
  }

  if (!nets.length) {
    listEl.innerHTML = '<p class="muted small">No networks found. <a href="#" id="btnRescan2">Try again</a></p>';
    const r = $('btnRescan2');
    if (r) r.addEventListener('click', e => { e.preventDefault(); scanNetworks(); });
    return;
  }

  // Sort by signal strength (strongest first), deduplicate SSIDs
  nets.sort((a, b) => b.rssi - a.rssi);
  const seen = new Set();
  const unique = nets.filter(n => {
    if (!n.ssid || seen.has(n.ssid)) return false;
    seen.add(n.ssid);
    return true;
  });

  // Render list
  listEl.innerHTML = '';
  unique.forEach((n, i) => {
    const el = document.createElement('div');
    el.className = 'wifi-item' + (i === 0 ? ' selected' : '');
    el.textContent = n.ssid;
    el.addEventListener('click', () => selectNetwork(n.ssid, el));
    listEl.appendChild(el);
  });

  // Pre-select strongest
  if (unique.length) selectNetwork(unique[0].ssid, listEl.firstChild);
}

function selectNetwork(ssid, el) {
  chosenSSID = ssid;
  $('ssidInput').value = ssid;
  $('pskInput').value = '';
  document.querySelectorAll('.wifi-item').forEach(e => e.classList.remove('selected'));
  if (el) el.classList.add('selected');
}

async function submitWifi() {
  const ssid = $('ssidInput').value.trim();
  const psk  = $('pskInput').value;
  if (!ssid) return;

  const btn = $('btnConnect');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  try {
    // Save WiFi credentials
    await fetch(AP_BASE + '/json/cfg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nw: { ins: [{ ssid, psk }] }, id: { frun: false } })
    });

    // Small delay then reboot
    await new Promise(r => setTimeout(r, 500));
    try {
      await fetch(AP_BASE + '/json/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rb: true })
      });
    } catch {} // lamp may drop connection before responding

    chosenSSID = ssid;
    goPage3();
  } catch (e) {
    btn.textContent = 'Connect';
    btn.disabled = false;
    alert('Could not save WiFi settings. Make sure you\'re connected to seazencity.');
  }
}

/* ── Page 3: Reconnect to home WiFi ── */
function goPage3() {
  showPage(3);
  $('p3ssid').textContent = chosenSSID || 'your WiFi';
  $('p3status').textContent = 'Finding your lamp…';
  $('p3fallback').classList.add('hidden');

  let elapsed = 0;
  pollTimer = setInterval(async () => {
    elapsed += 2;

    // Try mDNS
    try {
      const info = await fetchJ(MDNS_HOST + '/json/info', { timeout: 2500 });
      connectLamp('seazencity.local', info);
      return;
    } catch {}

    // Show fallback after 15s
    if (elapsed >= 15) {
      $('p3status').textContent = 'Taking longer than expected…';
      $('p3fallback').classList.remove('hidden');
    }
  }, 2000);
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
  const btn = $('btnPower');
  btn.classList.toggle('on', lampOn);
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

/* ── Open WiFi settings helper ── */
function openWifiSettings() {
  // Try Android intent for WiFi settings
  window.location.href = 'intent:#Intent;action=android.settings.WIFI_SETTINGS;end';
}

/* ── Event listeners ── */
$('btnWifi1').addEventListener('click', openWifiSettings);
$('btnWifi3').addEventListener('click', openWifiSettings);
$('btnConnect').addEventListener('click', submitWifi);
$('btnRescan').addEventListener('click', e => { e.preventDefault(); scanNetworks(); });
$('btnUseIp').addEventListener('click', useManualIp);
$('btnPower').addEventListener('click', togglePower);
$('btnDisconnect').addEventListener('click', e => { e.preventDefault(); disconnect(); });

$('btnEye').addEventListener('click', () => {
  const inp = $('pskInput');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

$('briSlider').addEventListener('change', () => {
  sendBri($('briSlider').value);
});

/* ── Init ── */
initDetect();

/* ── Service Worker ── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
