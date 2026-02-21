# Sea Lamp PWA — Seamless Workflow Spec

## Goal
Rewrite the PWA as a step-by-step wizard that walks the consumer from first power-on to controlling the lamp with minimum taps and zero URL typing. Entry point is a QR code on the lamp/packaging.

## Architecture
- PWA hosted on GitHub Pages (HTTPS) at https://intactos.github.io/sealamp/
- Communicates with lamp via fetch() to http://4.3.2.1 (AP mode) and http://seazencity.local (STA mode)
- Service worker caches shell for offline use
- Color palette matches WLED UI (#111/#222/#48a)

---

## Pages

### Page 0: Auto-detect (Landing)

**File changes:** Rewrite `app.js` init logic and `index.html` structure.

**UI:**
- Sea Lamp logo (centered)
- "Sea Lamp" title
- Animated pulse/spinner
- Text: "Looking for your lamp…"

**Logic (automatic, no buttons):**
1. Check localStorage for saved host → try to reach it → if ok → Page 4
2. Try http://seazencity.local/json/info → if ok → Page 4
3. Try http://4.3.2.1/json/info → if ok → Page 2
4. All failed after ~4s → Page 1

**Buttons:** None.

---

### Page 1: Connect to Lamp WiFi

**UI:**
- Step indicator: 1 of 3
- Heading: "Connect to your lamp"
- Body: "Open your phone's WiFi settings and connect to the network named **seazencity**. No password needed. Then come back here."
- One button: "Open WiFi Settings" (primary, full-width)
- Below button: "Waiting for connection…" with pulse animation

**Logic:**
- Every 2 seconds, ping http://4.3.2.1/json/info
- On success → auto-advance to Page 2 (no tap needed)

**Buttons:** 1 — "Open WiFi Settings"

---

### Page 2: Pick Your Home WiFi

**UI:**
- Step indicator: 2 of 3
- Heading: "Choose your WiFi"
- Body: "Select the network you want your lamp to use."
- WiFi list from lamp scan API, sorted strongest-first
- Strongest network pre-selected, fills the network name field
- Network name field (pre-filled)
- Password field (with show/hide eye toggle)
- One button: "Connect" (primary, full-width)
- Small "Refresh list" link at bottom

**Logic:**
- On page load: call lamp scan API to get WiFi list
- Tapping a different network updates name field, clears password
- On "Connect": POST credentials to lamp WiFi config endpoint
- Button shows "Saving…" briefly → advance to Page 3

**Buttons:** 1 — "Connect"
**Links:** 1 — "Refresh list"

---

### Page 3: Reconnect to Home WiFi

**UI:**
- Step indicator: 3 of 3
- Heading: "Almost done!"
- Body: "Your lamp is connecting to **{network name}**. Now switch your phone back to the same WiFi network."
- One button: "Open WiFi Settings" (primary, full-width)
- Below: "Finding your lamp…" with pulse animation
- After 15s: "Taking longer than expected…" + "Enter lamp IP manually" link → reveals IP input + Connect button

**Logic:**
- Every 2 seconds, ping http://seazencity.local/json/info
- On success → save host to localStorage → auto-advance to Page 4

**Buttons:** 1 — "Open WiFi Settings"
**Fallback:** IP input + Connect (appears after 15s)

---

### Page 4: Controls

**UI:**
- Sea Lamp logo (small, top)
- Lamp name or "Sea Lamp"
- Status dot: green (on) / dim (off)
- Large power toggle button (tap to toggle)
- Brightness slider (full-width, value sent on release)
- Divider
- "Open full controls" button (secondary) → opens http://seazencity.local in browser
- Small text: "Opens the complete interface in your browser"

**Bottom (tiny):**
- "Disconnect" link → clears localStorage → returns to Page 0
- Version number

**Logic:**
- On load: GET /json/state → sync power + brightness
- Power toggle: POST {"on":"t"}
- Brightness: POST {"bri": value} on slider release

**Buttons:** 1 toggle + 1 link
**Links:** 1 — "Disconnect"

---

## Files to Change

### index.html
- Replace all current HTML with page-based wizard structure
- All 5 pages as divs, only one visible at a time
- Step indicators for pages 1-3
- WiFi list container for page 2
- Controls layout for page 4

### app.js
- Complete rewrite as wizard state machine
- Page navigation: showPage(n) hides all, shows one
- Page 0: auto-detect logic with Promise.race / sequential fallback
- Page 1: AP polling loop (2s interval)
- Page 2: WiFi scan API, network list rendering, credential submission
- Page 3: mDNS/host polling loop (2s interval), 15s fallback timer
- Page 4: state sync, power toggle, brightness control
- WiFi settings intent: try Android intent, fallback to instructions
- All polling loops cleared when leaving a page

### styles.css
- Keep current WLED-matching palette
- Add step indicator styles
- Add WiFi list item styles
- Add pulse/spinner animation
- Add power toggle button styles (large, glowing)
- Add page transition (simple fade or instant swap)

### manifest.webmanifest
- No changes needed

### sw.js
- Bump cache version after changes

---

## Implementation Order
1. Rewrite index.html with all page structures
2. Rewrite app.js with wizard logic
3. Update styles.css with new component styles
4. Bump sw.js cache version
5. Test locally / commit / push
