/* ── NiCE CXone Global Map – map.js ─────────────────────────────────────── */
/* Architecture:
 *   config.json  → dataSource: "local" | "github"
 *   data/locations.json + data/platforms.json  ← canonical source files
 *   localStorage  ← working copy for in-browser edits
 *   Export Settings → download nice-cxone-map-settings.json → edit → Import
 */

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULT_TYPE_CFG = {
  cxone: { color: '#2B8EFF', label: 'CXone Software + Cognigy AI' },
  voice: { color: '#8B5CF6', label: 'Voice POP' },
  sov:   { color: '#F59E0B', label: 'SOV Region + Voice POP' },
};
const US_STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware',
  'Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky',
  'Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi',
  'Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico',
  'New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania',
  'Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont',
  'Virginia','Washington','West Virginia','Wisconsin','Wyoming','District of Columbia'
];
const ICON_EM    = { circle:'⬤', pin:'📍', star:'★', square:'■', diamond:'◆' };
const PLAT_COLORS = ['#2B8EFF','#8B5CF6','#F59E0B','#22c55e','#f97316','#e879f9','#06b6d4','#a3e635','#fb7185','#a78bfa'];

// ESRI Canvas tiles — English labels, excellent land/water contrast
const TILES = {
  darkBase:  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  darkRef:   'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
  darkNone:  'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
  lightBase: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  lightRef:  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
  lightNone: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
};
const ESRI_ATTR = 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ';

// ─── Mutable state ────────────────────────────────────────────────────────────
let locations = [], platforms = [], typeConfig = {};
let markerMap = {}, coordOffsets = {}, layerOn = { cxone:true, voice:true, sov:true };
let platformFilter = new Set(), pfTemp = new Set();
let isDark = true, labelsOn = true, pinLabelsOn = true, panelOpen = false;
let editingId = null, selIconVal = 'circle';
let sortKey = 'name', sortDir = 1;
let undoStack = [], toastTimer = null;
let map, baseLayer, refLayer, legendEl = null;
let cfg = {};
let srcLocs = null, srcPlats = null;
let pmWorking = [], mtWorking = {};
let placedLabelRects = [], labelResTimer = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function tryParseArr(s) { try { const d=JSON.parse(s); return Array.isArray(d)&&d.length?d:null; } catch { return null; } }
function tryParseObj(s) { try { const d=JSON.parse(s); return d&&typeof d==='object'&&!Array.isArray(d)?d:null; } catch { return null; } }
function clone(o) { return JSON.parse(JSON.stringify(o)); }

async function fetchJSON(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch { return null; }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  setLoadingMsg('Loading configuration…');

  cfg = await fetchJSON('./config.json') || {};
  const dataSource = cfg.dataSource || 'local';
  const githubBase = cfg.githubRawBase || '';

  // Restore typeConfig from localStorage, then theme/labels
  typeConfig = tryParseObj(localStorage.getItem('nice_typecfg')) || clone(DEFAULT_TYPE_CFG);
  const storedTheme     = localStorage.getItem('nice_theme');
  const storedLabels    = localStorage.getItem('nice_labels');
  const storedPinLabels = localStorage.getItem('nice_pinlabels');
  isDark      = storedTheme     ? storedTheme==='dark'        : (cfg.defaultTheme||'dark')==='dark';
  labelsOn    = storedLabels    ? JSON.parse(storedLabels)    : cfg.defaultLabels !== false;
  pinLabelsOn = storedPinLabels ? JSON.parse(storedPinLabels) : true;

  document.body.className = isDark ? 'dark' : 'light';

  // Load data from configured source
  setLoadingMsg(dataSource === 'github' ? 'Fetching data from GitHub…' : 'Loading local data files…');
  const base = dataSource === 'github' ? githubBase : './data/';
  [srcLocs, srcPlats] = await Promise.all([
    fetchJSON(base + 'locations.json'),
    fetchJSON(base + 'platforms.json'),
  ]);

  // Resolve working data (localStorage overrides source — it's the working copy)
  locations = tryParseArr(localStorage.getItem('nice_locs'))  || srcLocs  || [];
  platforms = tryParseArr(localStorage.getItem('nice_plats')) || srcPlats || [];

  if (!locations.length || !platforms.length) {
    showLoadingError(dataSource, base); return;
  }

  const badge = document.getElementById('source-badge');
  if (badge) {
    badge.textContent = dataSource === 'github' ? '☁ GitHub' : '💾 Local';
    badge.className   = 'source-badge ' + (dataSource === 'github' ? 'github' : '');
  }

  setLoadingMsg('Rendering map…');
  initMap();

  setTimeout(() => {
    const ov = document.getElementById('loading-overlay');
    if (ov) { ov.classList.add('hidden'); setTimeout(() => ov.remove(), 500); }
  }, 300);
}

function setLoadingMsg(msg) { const el=document.getElementById('loading-msg'); if(el) el.textContent=msg; }

function showLoadingError(dataSource, base) {
  const el = document.getElementById('loading-msg'); if (!el) return;
  el.className = 'loading-err';
  if (dataSource === 'local') {
    el.innerHTML = `<strong>Could not load data files.</strong><br><br>
      This map must be served from a web server — it cannot be opened directly as a file.<br><br>
      <strong>Quick fix:</strong> Open a terminal in the <code>nice-cxone-map</code> folder and run:<br>
      <code>python -m http.server 8080</code><br>
      then open <a onclick="window.open('http://localhost:8080')">http://localhost:8080</a> in your browser.<br><br>
      See <strong>README.md</strong> for full setup options.`;
  } else {
    el.innerHTML = `<strong>Could not load data from GitHub.</strong><br><br>
      Check that <code>config.json → githubRawBase</code> is correct and the repository is accessible.<br>
      Tried: <code>${base}</code>`;
  }
}

// ─── Map init ─────────────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { center:[20,10], zoom:2, minZoom:2 });
  // Custom pane: pin labels always render above markers (markerPane = 600)
  map.createPane('pinLabelPane');
  map.getPane('pinLabelPane').style.zIndex = 700;
  map.getPane('pinLabelPane').style.pointerEvents = 'none';
  applyTiles();

  const leg = L.control({ position:'bottomright' });
  leg.onAdd = () => { legendEl = L.DomUtil.create('div','map-legend'); refreshLegend(); return legendEl; };
  leg.addTo(map);

  map.on('contextmenu', e => {
    document.getElementById('m-lat').value = e.latlng.lat.toFixed(4);
    document.getElementById('m-lng').value = e.latlng.lng.toFixed(4);
    document.getElementById('geo-st').textContent = 'Coordinates set from map click ✓';
    document.getElementById('geo-st').className = 'geo-st ok';
    openModal(null);
  });

  document.getElementById('theme-btn').textContent  = isDark   ? '🌙 Dark' : '☀️ Light';
  document.getElementById('labels-btn').textContent = labelsOn ? '🗺️ Map Labels' : '🗺️ No Map Labels';
  if (!labelsOn) document.getElementById('labels-btn').classList.add('active');
  document.getElementById('pinlabels-btn').classList.toggle('active', !pinLabelsOn);
  document.getElementById('pinlabels-btn').textContent = pinLabelsOn ? '📍 Pin Labels' : '📍 Labels Off';

  map.on('zoomend moveend', scheduleResolveOverlaps);

  renderAll();
  refreshLayerButtons();
}

function refreshLegend() {
  if (!legendEl) return;
  legendEl.innerHTML = `<div class="leg-t">Marker Types</div>` +
    Object.entries(typeConfig).map(([,c]) =>
      `<div class="li"><div class="ld" style="background:${c.color}"></div>${c.label}</div>`
    ).join('') +
    `<div style="margin-top:6px;font-size:10px;color:var(--muted)">Click marker for details<br>Right-click map to add pin</div>`;
}

function refreshLayerButtons() {
  ['cxone','voice','sov'].forEach(t => {
    const dot = document.getElementById('dot-' + t);
    if (dot) dot.style.background = typeConfig[t]?.color || '#888';
    const btn = document.querySelector(`.layer-btn[data-layer="${t}"]`);
    if (btn && btn.classList.contains('active')) {
      btn.style.color = typeConfig[t]?.color || '';
      btn.style.borderColor = typeConfig[t]?.color || '';
    }
  });
  const allDot = document.getElementById('dot-all');
  if (allDot) allDot.style.background = `linear-gradient(135deg,${typeConfig.cxone?.color||'#2B8EFF'},${typeConfig.voice?.color||'#8B5CF6'})`;
  buildTypeSelect(document.getElementById('m-type')?.value || 'cxone');
}

// ─── Tiles ────────────────────────────────────────────────────────────────────
function applyTiles() {
  if (baseLayer) map.removeLayer(baseLayer);
  if (refLayer)  { map.removeLayer(refLayer); refLayer = null; }
  if (labelsOn) {
    baseLayer = L.tileLayer(isDark ? TILES.darkBase : TILES.lightBase, { attribution:ESRI_ATTR, maxZoom:19 }).addTo(map);
    refLayer  = L.tileLayer(isDark ? TILES.darkRef  : TILES.lightRef,  { attribution:'', maxZoom:19 }).addTo(map);
  } else {
    baseLayer = L.tileLayer(isDark ? TILES.darkNone : TILES.lightNone, { attribution:'© <a href="https://carto.com">CartoDB</a>', maxZoom:19, subdomains:'abcd' }).addTo(map);
  }
  baseLayer.bringToBack();
}
function toggleTheme() {
  isDark = !isDark; document.body.className = isDark ? 'dark' : 'light';
  document.getElementById('theme-btn').textContent = isDark ? '🌙 Dark' : '☀️ Light';
  applyTiles(); persist();
}
function toggleLabels() {
  labelsOn = !labelsOn;
  const btn = document.getElementById('labels-btn');
  btn.textContent = labelsOn ? '🗺️ Map Labels' : '🗺️ No Map Labels';
  btn.classList.toggle('active', !labelsOn);
  applyTiles(); persist();
}

// ─── Icon builder ─────────────────────────────────────────────────────────────
function buildIcon(type, shape, offsetIdx=0) {
  const c = (typeConfig[type] || DEFAULT_TYPE_CFG[type]).color, s=22, r=11;
  const ox = offsetIdx * 5; // 5px per co-located step (~80% overlap)
  let html, iS, iA, pA;
  switch (shape) {
    case 'pin':
      html = `<svg width="18" height="25" viewBox="0 0 20 28"><path d="M10 1C5 1 1 5 1 10c0 6 9 17 9 17s9-11 9-17C19 5 15 1 10 1z" fill="${c}" stroke="rgba(255,255,255,.8)" stroke-width="1.5"/><circle cx="10" cy="10" r="4" fill="rgba(255,255,255,.85)"/></svg>`;
      iS=[18,25]; iA=[9-ox,24]; pA=[0,-25]; break;
    case 'star': {
      const pts = Array.from({length:5}, (_,i) => {
        const a=(i*72-90)*Math.PI/180, b=(i*72-54)*Math.PI/180;
        return `${r+r*.9*Math.cos(a)},${r+r*.9*Math.sin(a)} ${r+r*.42*Math.cos(b)},${r+r*.42*Math.sin(b)}`;
      }).join(' ');
      html = `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><polygon points="${pts}" fill="${c}" stroke="rgba(255,255,255,.8)" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
      iS=[s,s]; iA=[r-ox,r]; pA=[0,-r]; break;
    }
    case 'square':
      html = `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><rect x="2" y="2" width="${s-4}" height="${s-4}" rx="3" fill="${c}" stroke="rgba(255,255,255,.8)" stroke-width="1.5"/></svg>`;
      iS=[s,s]; iA=[r-ox,r]; pA=[0,-r]; break;
    case 'diamond':
      html = `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><polygon points="${r},2 ${s-2},${r} ${r},${s-2} 2,${r}" fill="${c}" stroke="rgba(255,255,255,.8)" stroke-width="1.5"/></svg>`;
      iS=[s,s]; iA=[r-ox,r]; pA=[0,-r]; break;
    default:
      html = `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><circle cx="${r}" cy="${r}" r="${r-2}" fill="${c}" stroke="rgba(255,255,255,.8)" stroke-width="2"/></svg>`;
      iS=[s,s]; iA=[r-ox,r]; pA=[0,-r];
  }
  return L.divIcon({ className:'', html, iconSize:iS, iconAnchor:iA, popupAnchor:pA });
}

// ─── Tags ─────────────────────────────────────────────────────────────────────
function platColor(name) {
  const idx = platforms.findIndex(p => p.name === name);
  const c   = PLAT_COLORS[Math.max(0,idx) % PLAT_COLORS.length];
  return { bg: c+'28', fg: c };
}
function tagHTML(name) { const {bg,fg}=platColor(name); return `<span class="tag" style="background:${bg};color:${fg}">${name}</span>`; }

// ─── Popup ────────────────────────────────────────────────────────────────────
function cityLine(loc) {
  const cityState = [loc.city, loc.state].filter(Boolean).join(', ');
  return [cityState, loc.country, loc.region].filter(Boolean).join(' · ');
}
function popupHTML(loc) {
  const tags  = (loc.platforms||[]).map(tagHTML).join('');
  const icons = Object.keys(ICON_EM).map(k =>
    `<div class="ipick ${loc.icon===k?'sel':''}" onclick="chIcon('${loc.id}','${k}')" title="${k}">${ICON_EM[k]}</div>`
  ).join('');
  const cfg = typeConfig[loc.type] || DEFAULT_TYPE_CFG[loc.type] || {label:'Unknown'};
  return `<div class="pu-title">${loc.name}</div>
    <div class="pu-sub">${cityLine(loc)}</div>
    <div class="pu-tags">${tags || tagHTML(cfg.label)}</div>
    <div class="icon-pick-row"><span>Icon:</span>${icons}</div>
    <div class="pu-btns">
      <button class="pu-btn" onclick="openModal('${loc.id}')">✏️ Edit</button>
      <button class="pu-btn del" onclick="removeLoc('${loc.id}')">🗑 Remove</button>
    </div>`;
}
function chIcon(id, shape) {
  const loc = locations.find(l => l.id===id); if (!loc) return;
  loc.icon = shape; persist();
  const m = markerMap[id];
  if (m) { m.setIcon(buildIcon(loc.type,shape,coordOffsets[id]||0)); m.setPopupContent(popupHTML(loc)); }
  renderTable(); syncGpinBtn();
}

// ─── Visibility ───────────────────────────────────────────────────────────────
function isVisible(loc) {
  if (!layerOn[loc.type]) return false;
  if (platformFilter.size === 0) return true;
  return (loc.platforms||[]).some(p => platformFilter.has(p));
}
function applyAllVisibility() {
  locations.forEach(loc => {
    const m = markerMap[loc.id]; if (!m) return;
    if (isVisible(loc)) map.addLayer(m); else map.removeLayer(m);
  });
  scheduleResolveOverlaps();
}

// ─── Markers ──────────────────────────────────────────────────────────────────
function buildCoordOffsets() {
  const groups = {};
  locations.forEach(loc => {
    const key = `${loc.lat},${loc.lng}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(loc.id);
  });
  coordOffsets = {};
  Object.values(groups).forEach(ids => ids.forEach((id, idx) => coordOffsets[id] = idx));
}
function addMarker(loc) {
  const m = L.marker([loc.lat, loc.lng], { icon: buildIcon(loc.type, loc.icon||'circle', coordOffsets[loc.id]||0) });
  m.bindPopup(popupHTML(loc), { maxWidth:320 }); m.addTo(map);
  if (!isVisible(loc)) map.removeLayer(m);
  markerMap[loc.id] = m;
  if (loc.labelOn && pinLabelsOn && isVisible(loc)) attachPinLabel(loc, m);
}
function removeLoc(id) {
  map.closePopup();
  const loc = locations.find(l => l.id===id); if (!loc) return;
  const lat = loc.lat, lng = loc.lng;
  undoStack.push({...loc});
  if (markerMap[id]) map.removeLayer(markerMap[id]);
  delete markerMap[id];
  locations = locations.filter(l => l.id!==id);
  buildCoordOffsets();
  locations.filter(l => l.lat===lat && l.lng===lng).forEach(l => {
    const m = markerMap[l.id]; if (m) m.setIcon(buildIcon(l.type, l.icon||'circle', coordOffsets[l.id]||0));
  });
  persist(); updateCounts(); renderTable(); showToast(`"${loc.name}" removed`);
}
function renderAll() {
  Object.values(markerMap).forEach(m => map.removeLayer(m)); markerMap = {};
  buildCoordOffsets();
  locations.forEach(addMarker); updateCounts(); renderTable(); syncGpinBtn();
  scheduleResolveOverlaps();
}
function updateCounts() {
  const c = { cxone:0, voice:0, sov:0 };
  locations.forEach(l => c[l.type]++);
  document.getElementById('cnt-cxone').textContent = c.cxone;
  document.getElementById('cnt-voice').textContent = c.voice;
  document.getElementById('cnt-sov').textContent   = c.sov;
  document.getElementById('cnt-all').textContent   = locations.length;
  document.getElementById('stat-total').textContent = locations.length;
  document.getElementById('sp-count').textContent  = locations.length + ' total';
}

// ─── Layer toggle ─────────────────────────────────────────────────────────────
function toggleLayer(layer) {
  if (layer === 'all') {
    const on = Object.values(layerOn).some(v => !v);
    ['cxone','voice','sov'].forEach(t => { layerOn[t]=on; setAct(t,on); });
    setAct('all', on);
  } else {
    layerOn[layer] = !layerOn[layer];
    setAct(layer, layerOn[layer]);
    setAct('all', Object.values(layerOn).every(v => v));
  }
  applyAllVisibility();
}
function setAct(layer, on) {
  const b = document.querySelector(`.layer-btn[data-layer="${layer}"]`); if (!b) return;
  b.classList.toggle('active', on);
  if (on && typeConfig[layer]) { b.style.color=typeConfig[layer].color; b.style.borderColor=typeConfig[layer].color; }
  else { b.style.color=''; b.style.borderColor=''; }
}

// ─── Global pin shape ─────────────────────────────────────────────────────────
function setAllIcons(shape) {
  if (shape === 'mixed') return;
  locations.forEach(loc => {
    loc.icon = shape;
    const m = markerMap[loc.id];
    if (m) { m.setIcon(buildIcon(loc.type,shape,coordOffsets[loc.id]||0)); m.setPopupContent(popupHTML(loc)); }
  });
  persist(); renderTable(); syncGpinBtn();
}
function syncGpinBtn() {
  const shapes = [...new Set(locations.map(l => l.icon||'circle'))];
  const active = shapes.length===1 ? shapes[0] : 'mixed';
  document.querySelectorAll('.gpin-btn').forEach(b => b.classList.toggle('active', b.dataset.shape===active));
}

// ─── Platform filter modal ────────────────────────────────────────────────────
function openPFModal() { pfTemp=new Set(platformFilter); buildPFModalGrid(); updatePFMatchCount(); document.getElementById('pf-overlay').classList.add('open'); }
function closePFModal() { document.getElementById('pf-overlay').classList.remove('open'); }
function buildPFModalGrid() {
  const g = document.getElementById('pf-modal-grid'); g.innerHTML = '';
  platforms.forEach((p,i) => {
    const color = PLAT_COLORS[i%PLAT_COLORS.length];
    const div = document.createElement('div');
    div.className = 'pf-opt' + (pfTemp.has(p.name)?' checked':'');
    div.onclick = () => {
      if (pfTemp.has(p.name)) { pfTemp.delete(p.name); div.classList.remove('checked'); }
      else                    { pfTemp.add(p.name);    div.classList.add('checked');    }
      updatePFMatchCount();
    };
    div.innerHTML = `<input type="checkbox" ${pfTemp.has(p.name)?'checked':''} onclick="event.stopPropagation();this.parentElement.click()">
      <div class="pf-swatch" style="background:${color}"></div><span>${p.name}</span>`;
    g.appendChild(div);
  });
}
function pfSelectAll() { platforms.forEach(p => pfTemp.add(p.name)); buildPFModalGrid(); updatePFMatchCount(); }
function pfClearAll()  { pfTemp.clear(); buildPFModalGrid(); updatePFMatchCount(); }
function updatePFMatchCount() {
  const n = pfTemp.size===0 ? locations.length : locations.filter(l=>(l.platforms||[]).some(p=>pfTemp.has(p))).length;
  document.getElementById('pf-match-count').textContent = pfTemp.size===0 ? 'Showing all pins' : `Matches: ${n} pin${n!==1?'s':''}`;
}
function applyPFModal() {
  platformFilter = new Set(pfTemp);
  const badge = document.getElementById('pf-badge');
  if (platformFilter.size>0) { badge.style.display='inline'; badge.textContent=platformFilter.size; }
  else badge.style.display='none';
  document.getElementById('pf-btn').classList.toggle('active', platformFilter.size>0);
  applyAllVisibility(); closePFModal();
}

// ─── Undo ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  clearTimeout(toastTimer);
  const t=document.getElementById('toast'), bar=document.getElementById('toast-bar');
  document.getElementById('toast-msg').textContent = msg;
  bar.style.animation='none'; bar.offsetHeight; bar.style.animation='';
  t.classList.add('show');
  document.getElementById('undo-btn').style.display = 'flex';
  toastTimer = setTimeout(() => t.classList.remove('show'), 5200);
}
function undoDelete() {
  if (!undoStack.length) return;
  const loc = undoStack.pop(); locations.push(loc); addMarker(loc);
  persist(); updateCounts(); renderTable(); syncGpinBtn();
  document.getElementById('toast').classList.remove('show');
  if (!undoStack.length) document.getElementById('undo-btn').style.display='none';
  map.flyTo([loc.lat,loc.lng], Math.max(map.getZoom(),4), {duration:1});
}

// ─── Side panel / table ───────────────────────────────────────────────────────
function togglePanel() {
  panelOpen = !panelOpen;
  document.getElementById('side-panel').classList.toggle('hidden', !panelOpen);
  document.getElementById('list-btn').classList.toggle('active', panelOpen);
  if (panelOpen) renderTable();
}
function sortBy(key) {
  if (sortKey===key) sortDir*=-1; else { sortKey=key; sortDir=1; }
  document.querySelectorAll('thead th').forEach(th => th.classList.remove('sorted'));
  const th = document.getElementById('th-'+key);
  if (th) { th.classList.add('sorted'); th.textContent=({name:'Name',region:'Region',country:'Location'}[key])+(sortDir>0?' ↑':' ↓'); }
  renderTable();
}
function renderTable() {
  if (!panelOpen) return;
  const q = (document.getElementById('sp-search').value||'').toLowerCase();
  let rows = locations.filter(l => !q || [l.name,l.city,l.state,l.country,l.region,...(l.platforms||[])].join(' ').toLowerCase().includes(q));
  rows.sort((a,b) => (a[sortKey]||'').localeCompare(b[sortKey]||'')*sortDir);
  const tbody = document.getElementById('sp-tbody'); tbody.innerHTML = '';
  rows.forEach(loc => {
    const tags = (loc.platforms||[]).map(tagHTML).join('');
    const locDisp = [loc.state, loc.country].filter(Boolean).join(', ') || '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="nc" title="${loc.name}">${loc.name}</td>
      <td class="dim" title="${loc.region||''}">${loc.region||'—'}</td>
      <td class="dim" title="${locDisp}">${locDisp}</td>
      <td><div class="tags">${tags||(()=>{const c=typeConfig[loc.type]||DEFAULT_TYPE_CFG[loc.type];return tagHTML(c.label)})()}</div></td>
      <td><div class="row-actions">
        <button class="act-btn fly"  title="Fly to" onclick="flyTo('${loc.id}')">🎯</button>
        <button class="act-btn edit" title="Edit"   onclick="openModal('${loc.id}')">✏️</button>
        <button class="act-btn del"  title="Remove" onclick="removeLoc('${loc.id}')">🗑</button>
      </div></td>`;
    tbody.appendChild(tr);
  });
}
function flyTo(id) {
  const loc = locations.find(l => l.id===id); if (!loc) return;
  map.flyTo([loc.lat,loc.lng], Math.max(map.getZoom(),5), {duration:1.2});
  setTimeout(() => markerMap[id]?.openPopup(), 1400);
}

// ─── Location modal ───────────────────────────────────────────────────────────
const US_VARIANTS = ['usa','us','united states','united states of america'];
function isUSA(v) { return US_VARIANTS.includes((v||'').trim().toLowerCase()); }

function checkUSState() {
  const v = document.getElementById('m-country').value;
  const show = isUSA(v);
  document.getElementById('state-row').style.display = show ? '' : 'none';
  if (show) {
    const sel = document.getElementById('m-state');
    if (sel.options.length <= 1) {
      US_STATES.forEach(s => { const o=document.createElement('option'); o.value=s; o.textContent=s; sel.appendChild(o); });
    }
  }
}

function buildTypeSelect(selected) {
  const sel = document.getElementById('m-type'); if (!sel) return;
  sel.innerHTML = Object.entries(typeConfig).map(([key,cfg]) =>
    `<option value="${key}"${selected===key?' selected':''}>${cfg.label}</option>`
  ).join('');
}

function buildModalPlatGrid(selected) {
  const g = document.getElementById('m-plat-grid'); g.innerHTML = '';
  platforms.forEach(p => {
    const lbl = document.createElement('label'); lbl.className='plat-opt';
    const chk = document.createElement('input'); chk.type='checkbox'; chk.value=p.name;
    chk.checked = selected && selected.includes(p.name); chk.setAttribute('data-plat','1');
    lbl.appendChild(chk); lbl.appendChild(document.createTextNode(' '+p.name)); g.appendChild(lbl);
  });
}
function getSelectedPlats() { return Array.from(document.querySelectorAll('[data-plat]:checked')).map(e=>e.value); }

function openModal(id) {
  editingId = id;
  const loc = id ? locations.find(l=>l.id===id) : null;
  document.getElementById('modal-title').innerHTML = loc ? '✏️ Edit <span class="p">Location</span>' : '＋ Add <span class="p">Location</span>';
  document.getElementById('modal-save-btn').textContent = loc ? 'Save Changes' : 'Add to Map';
  document.getElementById('m-name').value    = loc?.name    || '';
  document.getElementById('m-city').value    = loc?.city    || '';
  document.getElementById('m-country').value = loc?.country || '';
  document.getElementById('m-region').value  = loc?.region  || '';
  document.getElementById('m-lat').value     = loc?.lat     || '';
  document.getElementById('m-lng').value     = loc?.lng     || '';
  document.getElementById('m-label').value      = loc?.label   || '';
  document.getElementById('m-label-on').checked = loc?.labelOn || false;
  buildModalPlatGrid(loc?.platforms||[]);
  buildTypeSelect(loc?.type||'cxone');
  selIcon(loc?.icon||'circle');
  checkUSState();
  if (loc?.state) document.getElementById('m-state').value = loc.state;
  document.getElementById('geo-st').textContent = 'or right-click the map to set coordinates';
  document.getElementById('geo-st').className = 'geo-st';
  document.getElementById('modal').classList.add('open');
}
function closeModal() { document.getElementById('modal').classList.remove('open'); editingId=null; }
function selIcon(shape) { selIconVal=shape; document.querySelectorAll('#m-icon-picker .iopt').forEach(el=>el.classList.toggle('sel',el.dataset.icon===shape)); }
function clearCoords() {
  if (!editingId) {
    document.getElementById('m-lat').value=''; document.getElementById('m-lng').value='';
    document.getElementById('geo-st').textContent=''; document.getElementById('geo-st').className='geo-st';
  }
}
const GEO_CC = {
  'united states':['us'],'usa':['us'],'u.s.a.':['us'],'u.s.':['us'],
  'united kingdom':['gb'],'uk':['gb'],'great britain':['gb'],
  'australia':['au'],'canada':['ca'],'germany':['de'],'france':['fr'],
  'netherlands':['nl'],'singapore':['sg'],'japan':['jp'],'india':['in'],
  'brazil':['br'],'mexico':['mx'],'south africa':['za'],'uae':['ae'],
  'united arab emirates':['ae'],'new zealand':['nz'],'ireland':['ie'],
  'israel':['il'],'saudi arabia':['sa'],'spain':['es'],'italy':['it'],
  'sweden':['se'],'norway':['no'],'denmark':['dk'],'finland':['fi'],
  'switzerland':['ch'],'austria':['at'],'belgium':['be'],'poland':['pl'],
  'portugal':['pt'],'czech republic':['cz'],'hungary':['hu'],
  'romania':['ro'],'greece':['gr'],'turkey':['tr'],'russia':['ru'],
  'china':['cn'],'south korea':['kr'],'taiwan':['tw'],'hong kong':['hk'],
  'indonesia':['id'],'malaysia':['my'],'thailand':['th'],'philippines':['ph'],
  'vietnam':['vn'],'pakistan':['pk'],'bangladesh':['bd'],
  'argentina':['ar'],'chile':['cl'],'colombia':['co'],'peru':['pe'],
  'egypt':['eg'],'nigeria':['ng'],'kenya':['ke'],'ghana':['gh'],
};
async function geocode() {
  const name = document.getElementById('m-name').value.trim(); if (!name) { alert('Enter a location name first.'); return; }
  const st = document.getElementById('geo-st'); st.textContent='Looking up…'; st.className='geo-st';
  // Build composite query from all filled fields for precision
  const city    = document.getElementById('m-city').value.trim();
  const country = document.getElementById('m-country').value.trim();
  const stateVal = isUSA(country) ? document.getElementById('m-state').value : '';
  const parts = [name];
  if (city && city !== name) parts.push(city);
  if (stateVal) parts.push(stateVal);
  if (country) parts.push(country);
  const q = parts.join(', ');
  const cc = GEO_CC[country.toLowerCase()] || [];
  const ccParam = cc.length ? `&countrycodes=${cc.join(',')}` : '';
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&addressdetails=1&accept-language=en${ccParam}`,{headers:{'Accept-Language':'en'}});
    const d = await r.json(); if (!d.length) throw 0;
    // Prefer result matching the expected country
    let best = d[0];
    if (cc.length) { const m = d.find(x => cc.includes(x.address?.country_code)); if (m) best = m; }
    document.getElementById('m-lat').value = parseFloat(best.lat).toFixed(4);
    document.getElementById('m-lng').value = parseFloat(best.lon).toFixed(4);
    if (!document.getElementById('m-city').value && best.address)
      document.getElementById('m-city').value = best.address.city||best.address.town||best.address.village||'';
    if (!document.getElementById('m-country').value && best.address)
      document.getElementById('m-country').value = best.address.country||'';
    checkUSState();
    if (best.address?.country_code==='us' && best.address?.state)
      document.getElementById('m-state').value = best.address.state;
    st.textContent = '✓ '+best.display_name.split(',').slice(0,3).join(','); st.className='geo-st ok';
  } catch {
    st.textContent='Not found — enter coordinates manually.'; st.className='geo-st err';
  }
}
function saveModal() {
  const name = document.getElementById('m-name').value.trim();
  const lat  = parseFloat(document.getElementById('m-lat').value);
  const lng  = parseFloat(document.getElementById('m-lng').value);
  if (!name) { alert('Enter a location name.'); return; }
  if (isNaN(lat)||isNaN(lng)) { alert('Coordinates required. Use "Look up from name" or right-click the map.'); return; }
  const country = document.getElementById('m-country').value.trim();
  const data = {
    name, city:document.getElementById('m-city').value.trim(),
    state: isUSA(country) ? document.getElementById('m-state').value : '',
    country, region:document.getElementById('m-region').value,
    type:document.getElementById('m-type').value,
    platforms:getSelectedPlats(), icon:selIconVal, lat, lng,
    label:   document.getElementById('m-label').value.trim(),
    labelOn: document.getElementById('m-label-on').checked,
  };
  if (editingId) {
    const idx = locations.findIndex(l=>l.id===editingId);
    if (idx>-1) {
      locations[idx] = {...locations[idx],...data};
      const loc=locations[idx], m=markerMap[editingId];
      buildCoordOffsets();
      if (m) { m.setLatLng([loc.lat,loc.lng]); m.setIcon(buildIcon(loc.type,loc.icon,coordOffsets[editingId]||0)); m.setPopupContent(popupHTML(loc)); if(!isVisible(loc)) map.removeLayer(m); else map.addLayer(m); }
      refreshAllPinLabels();
    }
  } else {
    const loc = {id:'c_'+Date.now(),...data}; locations.push(loc);
    const prevColocated = locations.filter(l => l.id!==loc.id && l.lat===loc.lat && l.lng===loc.lng);
    buildCoordOffsets();
    prevColocated.forEach(l => { const m=markerMap[l.id]; if(m) m.setIcon(buildIcon(l.type,l.icon||'circle',coordOffsets[l.id]||0)); });
    addMarker(loc);
    map.flyTo([lat,lng], Math.max(map.getZoom(),5), {duration:1.2});
    setTimeout(() => markerMap[loc.id]?.openPopup(), 1400);
  }
  persist(); updateCounts(); renderTable(); syncGpinBtn(); closeModal();
}

// ─── Platform manager ─────────────────────────────────────────────────────────
function openPlatformMgr() { pmWorking=platforms.map(p=>({...p})); renderPMList(); document.getElementById('pm-overlay').classList.add('open'); }
function closePM() { document.getElementById('pm-overlay').classList.remove('open'); }
function renderPMList() {
  const list=document.getElementById('pm-list'); list.innerHTML='';
  pmWorking.forEach((p,i) => {
    const row=document.createElement('div'); row.className='pm-row';
    const sw=document.createElement('div'); sw.className='pm-swatch'; sw.style.background=PLAT_COLORS[i%PLAT_COLORS.length];
    const inp=document.createElement('input'); inp.className='pm-name-inp'; inp.value=p.name;
    inp.onchange=()=>{pmWorking[i].name=inp.value.trim()};
    const del=document.createElement('button'); del.className='pm-del-btn'; del.textContent='✕';
    del.onclick=()=>{if(confirm(`Remove platform "${p.name}"?`)){pmWorking.splice(i,1);renderPMList()}};
    row.appendChild(sw); row.appendChild(inp); row.appendChild(del); list.appendChild(row);
  });
}
function addPlatform() {
  const inp=document.getElementById('pm-new-name'), name=inp.value.trim(); if(!name) return;
  if(pmWorking.find(p=>p.name.toLowerCase()===name.toLowerCase())){alert('Already exists.');return}
  pmWorking.push({id:'p_'+Date.now(),name}); renderPMList(); inp.value='';
}
function savePlatforms() { platforms=pmWorking.map(p=>({...p})); persist(); closePM(); }

// ─── Marker type editor ───────────────────────────────────────────────────────
function openMT() { mtWorking=clone(typeConfig); renderMTList(); document.getElementById('mt-overlay').classList.add('open'); }
function closeMT() { document.getElementById('mt-overlay').classList.remove('open'); }
function renderMTList() {
  const list=document.getElementById('mt-list'); list.innerHTML='';
  Object.entries(mtWorking).forEach(([key,cfg]) => {
    const row=document.createElement('div'); row.className='mt-row';
    row.innerHTML=`
      <span class="mt-key">${key}</span>
      <input type="color" class="mt-color-inp" value="${cfg.color}"
        oninput="mtWorking['${key}'].color=this.value;document.getElementById('mt-prev-${key}').style.background=this.value">
      <div class="mt-preview" id="mt-prev-${key}" style="background:${cfg.color}"></div>
      <input type="text" class="mt-label-inp" value="${cfg.label}"
        oninput="mtWorking['${key}'].label=this.value" placeholder="Label for ${key}">`;
    list.appendChild(row);
  });
}
function saveMT() {
  typeConfig = clone(mtWorking);
  locations.forEach(loc => {
    const m = markerMap[loc.id];
    if (m) { m.setIcon(buildIcon(loc.type,loc.icon||'circle',coordOffsets[loc.id]||0)); m.setPopupContent(popupHTML(loc)); }
  });
  refreshLayerButtons(); refreshLegend(); persist(); closeMT();
  showToast('Marker types updated ✓');
}

// ─── Pin Labels ───────────────────────────────────────────────────────────────
// Offset pushes tooltip tip past the icon edge (iconAnchor is often center; +18px clears a 24px icon)
const LABEL_OFFSET = {bottom:[0,18], top:[0,-18], right:[18,0], left:[-18,0]};
function attachPinLabel(loc, m, dir='bottom') {
  const text = loc.label || loc.name;
  m.bindTooltip(text, { permanent:true, direction:dir, className:'map-label', interactive:false,
    pane:'pinLabelPane', offset: LABEL_OFFSET[dir]||[0,18] });
}

function togglePinLabels() {
  pinLabelsOn = !pinLabelsOn;
  const btn = document.getElementById('pinlabels-btn');
  btn.classList.toggle('active', !pinLabelsOn);
  btn.textContent = pinLabelsOn ? '📍 Pin Labels' : '📍 Labels Off';
  refreshAllPinLabels(); persist();
}

function refreshAllPinLabels() {
  locations.forEach(loc => {
    const m = markerMap[loc.id]; if (!m) return;
    m.unbindTooltip();
    if (loc.labelOn && pinLabelsOn && isVisible(loc) && map.hasLayer(m))
      attachPinLabel(loc, m, loc._labelDir||'bottom');
  });
  scheduleResolveOverlaps();
}

function scheduleResolveOverlaps() {
  clearTimeout(labelResTimer);
  labelResTimer = setTimeout(resolveLabelOverlaps, 160);
}

function estimateLabelRect(px, dir, text) {
  const w = Math.max(48, text.length * 6.5) + 14, h = 20, GAP = 15;
  let x, y;
  switch(dir) {
    case 'bottom': x=px.x-w/2; y=px.y+GAP; break;
    case 'top':    x=px.x-w/2; y=px.y-GAP-h; break;
    case 'right':  x=px.x+GAP; y=px.y-h/2; break;
    case 'left':   x=px.x-GAP-w; y=px.y-h/2; break;
    default:       x=px.x-w/2; y=px.y+GAP;
  }
  return {x, y, w, h};
}

function rectsOverlapPx(a, b, pad=3) {
  return !(a.x+a.w+pad < b.x || b.x+b.w+pad < a.x || a.y+a.h+pad < b.y || b.y+b.h+pad < a.y);
}

function resolveLabelOverlaps() {
  if (!map) return;
  placedLabelRects = [];
  const DIRS = ['bottom','top','right','left'];
  const toPlace = locations
    .filter(loc => loc.labelOn && pinLabelsOn && isVisible(loc) && markerMap[loc.id] && map.hasLayer(markerMap[loc.id]))
    .map(loc => ({ loc, m: markerMap[loc.id], px: map.latLngToContainerPoint([loc.lat, loc.lng]) }));

  const pinRects = toPlace.map(({px}) => ({x:px.x-13, y:px.y-13, w:26, h:26}));

  toPlace.forEach(({loc, m, px}, idx) => {
    const text = loc.label || loc.name;
    let bestDir = 'bottom', minScore = Infinity;
    for (const dir of DIRS) {
      const rect = estimateLabelRect(px, dir, text);
      let score = 0;
      for (const pr of placedLabelRects)    { if (rectsOverlapPx(rect, pr))            score += 10; }
      for (let i=0; i<pinRects.length; i++) { if (i!==idx && rectsOverlapPx(rect, pinRects[i], 2)) score += 3; }
      if (score < minScore) { minScore = score; bestDir = dir; }
      if (score === 0) break;
    }
    placedLabelRects.push(estimateLabelRect(px, bestDir, text));
    const tt = m.getTooltip();
    if (!tt || tt.options.direction !== bestDir) {
      loc._labelDir = bestDir;
      m.unbindTooltip();
      m.bindTooltip(text, { permanent:true, direction:bestDir, className:'map-label', interactive:false,
        pane:'pinLabelPane', offset: LABEL_OFFSET[bestDir]||[0,18] });
    }
  });
}

// ─── Export / Import / Reload ─────────────────────────────────────────────────
function exportSettings() {
  dlJSON('nice-cxone-map-settings.json', {
    _version: 3,
    _exported: new Date().toISOString(),
    _note: 'NiCE CXone Map — full settings. Edit and Import to apply changes.',
    locations, platforms, typeConfig,
    theme: isDark ? 'dark' : 'light',
    labels: labelsOn,
    pinLabels: pinLabelsOn,
  });
}

function importSettings() { document.getElementById('import-file').click(); }

function handleImportFile(e) {
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=evt=>{
    try {
      const d=JSON.parse(evt.target.result);
      if(!d.locations||!d.platforms) throw new Error('Missing locations or platforms');
      locations=d.locations; platforms=d.platforms;
      if(d.typeConfig) typeConfig=d.typeConfig;
      if(d.theme!==undefined){ isDark=d.theme==='dark'; document.body.className=isDark?'dark':'light'; document.getElementById('theme-btn').textContent=isDark?'🌙 Dark':'☀️ Light'; }
      if(d.labels!==undefined){ labelsOn=d.labels; document.getElementById('labels-btn').textContent=labelsOn?'🗺️ Map Labels':'🗺️ No Map Labels'; document.getElementById('labels-btn').classList.toggle('active',!labelsOn); }
      if(d.pinLabels!==undefined){ pinLabelsOn=d.pinLabels; const pb=document.getElementById('pinlabels-btn'); pb.classList.toggle('active',!pinLabelsOn); pb.textContent=pinLabelsOn?'📍 Pin Labels':'📍 Labels Off'; }
      persist(); renderAll(); refreshLayerButtons(); refreshLegend(); applyTiles();
      showToast('Settings imported ✓');
    } catch(err){ alert('Import failed: '+err.message); }
    e.target.value='';
  };
  reader.readAsText(file);
}

function reloadFromSource() {
  if (!srcLocs && !srcPlats) { alert('No source data was loaded (check config.json and your data files).'); return; }
  if (!confirm('Reload all data from source files? Your local changes will be overwritten.')) return;
  if (srcLocs)  { locations=srcLocs;  localStorage.setItem('nice_locs',  JSON.stringify(locations)); }
  if (srcPlats) { platforms=srcPlats; localStorage.setItem('nice_plats', JSON.stringify(platforms)); }
  renderAll(); showToast('Reloaded from source ✓');
}

function dlJSON(filename, data) {
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

// ─── Persist to localStorage ──────────────────────────────────────────────────
function persist() {
  try {
    localStorage.setItem('nice_locs',       JSON.stringify(locations));
    localStorage.setItem('nice_plats',      JSON.stringify(platforms));
    localStorage.setItem('nice_typecfg',    JSON.stringify(typeConfig));
    localStorage.setItem('nice_theme',      isDark?'dark':'light');
    localStorage.setItem('nice_labels',     JSON.stringify(labelsOn));
    localStorage.setItem('nice_pinlabels',  JSON.stringify(pinLabelsOn));
  } catch {}
}

// ─── Event wiring ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal')     .addEventListener('click', e=>{if(e.target===document.getElementById('modal'))      closeModal()});
  document.getElementById('pm-overlay').addEventListener('click', e=>{if(e.target===document.getElementById('pm-overlay')) closePM()});
  document.getElementById('pf-overlay').addEventListener('click', e=>{if(e.target===document.getElementById('pf-overlay')) closePFModal()});
  document.getElementById('mt-overlay').addEventListener('click', e=>{if(e.target===document.getElementById('mt-overlay')) closeMT()});
  document.getElementById('m-name').addEventListener('input', ()=>{
    const lbl=document.getElementById('m-label');
    if(!lbl.value) lbl.placeholder=document.getElementById('m-name').value||'Defaults to display name';
  });
  document.getElementById('m-name')    .addEventListener('keydown', e=>{if(e.key==='Enter') geocode()});
  document.getElementById('pm-new-name').addEventListener('keydown', e=>{if(e.key==='Enter') addPlatform()});
  document.getElementById('sp-search') .addEventListener('input', renderTable);
  document.addEventListener('keydown', e=>{if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undoDelete()}});
  boot();
});
