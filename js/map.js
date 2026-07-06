/* ─── NiCE CXone Map — map.js ─────────────────────────────────────────────── */

// ─── State ────────────────────────────────────────────────────────────────────
let map, tileLayerBase, tileLayerRef;
let locations = [], platformData = {}, manifest = { platforms: [] };
let typeConfig = {}, platforms = [];
let customers = [], drawings = [];
let markerMap = {}, customerMarkerMap = {}, drawingLayers = [];
let layerOn = {}, platformFilter = new Set(), pfTemp = new Set();
let coordOffsets = {}, overlapTimer;
let editingId = null, editingCustomerId = null;
let deletedLoc = null, deletedCustomer = null;
let sortKey = 'name', sortAsc = true, searchTerm = '';
let legendView = 'table', openDdId = null;
let selIconVal = 'circle', selCustIconVal = 'circle';
let labelsOn = true, pinLabelsOn = true;
let pinLabels = {};
let noWrapMode = false;
let drawMode = null, drawingsVisible = true;
let drawingInProgress = { points: [] };
let modalPickerMap = null, modalPickerMarker = null;
let pmWorking = [], selectedCustomerColor = '#10b981';
let toastTimer;

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_REGIONS = ['North America','EMEA','APAC','LATAM','MEA'];
const CUSTOMER_COLORS = ['#10b981','#2B8EFF','#f97316','#e879f9','#F59E0B','#ef4444','#8B5CF6','#06b6d4','#84cc16','#f43f5e'];
const SHAPE_SYM = { circle:'⬤', pin:'📍', star:'★', square:'■', diamond:'◆', mixed:'∷' };
const US_STATES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming','District of Columbia'];
const US_VARIANTS = ['usa','us','united states','united states of america'];
const GEO_CC = {'united states':['us'],'usa':['us'],'u.s.a.':['us'],'u.s.':['us'],'united kingdom':['gb'],'uk':['gb'],'australia':['au'],'canada':['ca'],'germany':['de'],'france':['fr'],'netherlands':['nl'],'singapore':['sg'],'japan':['jp'],'india':['in'],'brazil':['br'],'mexico':['mx'],'south africa':['za'],'uae':['ae'],'united arab emirates':['ae'],'new zealand':['nz'],'ireland':['ie'],'israel':['il'],'saudi arabia':['sa'],'spain':['es'],'italy':['it'],'sweden':['se'],'norway':['no'],'denmark':['dk'],'finland':['fi'],'switzerland':['ch'],'austria':['at'],'belgium':['be'],'poland':['pl'],'portugal':['pt'],'czech republic':['cz'],'hungary':['hu'],'romania':['ro'],'greece':['gr'],'turkey':['tr'],'china':['cn'],'south korea':['kr'],'taiwan':['tw'],'hong kong':['hk'],'indonesia':['id'],'malaysia':['my'],'thailand':['th'],'philippines':['ph'],'vietnam':['vn'],'pakistan':['pk'],'bangladesh':['bd'],'egypt':['eg'],'nigeria':['ng'],'kenya':['ke'],'ghana':['gh'],'ethiopia':['et'],'argentina':['ar'],'colombia':['co'],'chile':['cl'],'peru':['pe']};

// ─── Utilities ────────────────────────────────────────────────────────────────
function slugify(name) { return (name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function unslugify(slug) { return slug.split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' '); }
function isUSA(v) { return US_VARIANTS.includes((v||'').trim().toLowerCase()); }
function tryParse(s,fb){ try{return JSON.parse(s)||fb}catch{return fb} }
function dlJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
async function fetchJSON(url) {
  try { const r = await fetch(url+'?v='+Date.now()); if(!r.ok) return null; return await r.json(); } catch { return null; }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  setLoadMsg('Loading manifest…');
  const netManifest = await fetchJSON('data/manifest.json');
  const lsManifest = tryParse(localStorage.getItem('nice_manifest'), null);
  manifest = lsManifest || netManifest || { platforms: [] };

  setLoadMsg('Loading marker types…');
  const netTypes = await fetchJSON('data/marker-types.json');
  // Always seed from file first so we always have valid defaults
  if (Array.isArray(netTypes)) {
    netTypes.forEach(t => { typeConfig[t.key] = { color: t.color, label: t.label }; });
  }
  // Then overlay localStorage (handles both array and object formats)
  const lsTypes = tryParse(localStorage.getItem('nice_typecfg'), null);
  if (lsTypes) {
    if (Array.isArray(lsTypes)) {
      // Old format: [{key, color, label}, ...]
      lsTypes.forEach(t => { if(t && t.key) typeConfig[t.key] = { color: t.color||'#2B8EFF', label: t.label||t.key }; });
    } else if (typeof lsTypes === 'object') {
      // New format: {key: {color, label}}
      Object.entries(lsTypes).forEach(([k,v]) => { if(k && v && v.color) typeConfig[k] = v; });
    }
  }

  setLoadMsg('Loading platform data…');
  let fromLocalStorage = false;
  for (const slug of manifest.platforms) {
    const lsData = tryParse(localStorage.getItem('nice_pd_'+slug), null);
    if (lsData) { platformData[slug] = lsData; fromLocalStorage = true; }
    else {
      const netData = await fetchJSON('data/'+slug+'.json');
      platformData[slug] = Array.isArray(netData) ? netData : [];
    }
  }
  locations = Object.values(platformData).flat();

  setLoadMsg('Loading customers & drawings…');
  const lsCust = tryParse(localStorage.getItem('nice_customers'), null);
  const netCust = await fetchJSON('data/customers.json');
  customers = lsCust || (Array.isArray(netCust) ? netCust : []);

  const lsDraw = tryParse(localStorage.getItem('nice_drawings'), null);
  const netDraw = await fetchJSON('data/drawings.json');
  drawings = lsDraw || (Array.isArray(netDraw) ? netDraw : []);

  platforms = manifest.platforms.map(slug => {
    const entries = platformData[slug] || [];
    const name = entries.length ? entries[0].platform : unslugify(slug);
    return { slug, name };
  });
  manifest.platforms.forEach(s => { layerOn[s] = true; });

  labelsOn = localStorage.getItem('nice_labels') !== '0';
  pinLabelsOn = localStorage.getItem('nice_pinlabels') !== '0';
  if (localStorage.getItem('nice_theme') === 'light') document.body.classList.add('light');

  setLoadMsg('Rendering map…');
  initMap();
  renderLayerButtons();
  buildCoordOffsets();
  locations.forEach(addMarker);
  customers.forEach(addCustomerMarker);
  renderDrawings();
  updateCounts();
  renderTable();
  renderCustomerPanel();
  syncGpinBtn();
  updateThemeBtn();
  updateNoWrapBtn();
  document.getElementById('dlbl-map').textContent = labelsOn ? '✓' : '';
  document.getElementById('dlbl-pin').textContent = pinLabelsOn ? '✓' : '';

  const badge = document.getElementById('source-badge');
  if (badge) badge.textContent = fromLocalStorage ? 'Local' : 'GitHub';

  setTimeout(() => document.getElementById('loading-overlay')?.classList.add('hidden'), 400);
}

function setLoadMsg(msg) { const el=document.getElementById('loading-msg'); if(el) el.textContent=msg; }

// ─── Map Init ─────────────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { center:[20,0], zoom:3, worldCopyJump:true, zoomControl:true, attributionControl:false });
  map.createPane('pinLabelPane');
  map.getPane('pinLabelPane').style.zIndex = 700;
  applyTiles();
  map.on('contextmenu', e => {
    const modal = document.getElementById('modal');
    if (modal && modal.classList.contains('open')) {
      document.getElementById('m-lat').value = e.latlng.lat.toFixed(4);
      document.getElementById('m-lng').value = e.latlng.lng.toFixed(4);
      const st = document.getElementById('geo-st');
      st.textContent = `📍 ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`;
      st.className = 'geo-st ok';
    }
  });
  map.on('click', e => { if (openDdId) closeDD(openDdId); onMapClick(e); });
  map.on('dblclick', onMapDblClick);
  // Inject popup button style
  const s = document.createElement('style');
  s.textContent = '.pu-btn{background:var(--ctrl);border:1px solid var(--border);border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px;color:var(--fg)}.pu-btn:hover{background:var(--ctrl-hover)}';
  document.head.appendChild(s);
}

function applyTiles() {
  if (tileLayerBase) { try { map.removeLayer(tileLayerBase); } catch{} }
  if (tileLayerRef)  { try { map.removeLayer(tileLayerRef);  } catch{} }
  const dark = !document.body.classList.contains('light');
  const opts = { noWrap: noWrapMode, maxZoom:19, minZoom:1 };
  if (dark) {
    tileLayerBase = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', opts).addTo(map);
    if (labelsOn) tileLayerRef = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {...opts, pane:'overlayPane', zIndex:500}).addTo(map);
  } else {
    tileLayerBase = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', opts).addTo(map);
    if (labelsOn) tileLayerRef = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {...opts, pane:'overlayPane', zIndex:500}).addTo(map);
  }
  map.setMaxBounds(noWrapMode ? [[-90,-180],[90,180]] : null);
}

// ─── No-wrap ──────────────────────────────────────────────────────────────────
function toggleNoWrap() {
  noWrapMode = !noWrapMode;
  applyTiles();
  updateNoWrapBtn();
  showToast(noWrapMode ? '🌐 Single world view' : '🌍 Seamless wrap');
}
function updateNoWrapBtn() {
  const btn = document.getElementById('nowrap-btn');
  if (btn) { btn.classList.toggle('active', noWrapMode); btn.textContent = noWrapMode ? '🌐 No Wrap' : '🌍 Wrap'; }
}

// ─── Theme ────────────────────────────────────────────────────────────────────
function toggleTheme() {
  document.body.classList.toggle('light');
  updateThemeBtn(); applyTiles(); persist();
}
function updateThemeBtn() {
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = document.body.classList.contains('light') ? '☀️ Light' : '🌙 Dark';
}

// ─── Labels ───────────────────────────────────────────────────────────────────
function toggleLabels() { labelsOn = !labelsOn; applyTiles(); persist(); document.getElementById('dlbl-map').textContent = labelsOn?'✓':''; }
function togglePinLabels() { pinLabelsOn = !pinLabelsOn; refreshAllPinLabels(); persist(); document.getElementById('dlbl-pin').textContent = pinLabelsOn?'✓':''; }

// ─── Icons & Markers ──────────────────────────────────────────────────────────
function buildIcon(type, shape, offsetIdx=0) {
  const cfg = typeConfig[type] || {}; const color = cfg.color||'#2B8EFF'; const o = offsetIdx*5;
  const S = {
    circle:  `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,.6);box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    pin:     `<div style="font-size:18px;line-height:1;color:${color}">📍</div>`,
    star:    `<div style="font-size:16px;line-height:1;color:${color}">★</div>`,
    square:  `<div style="width:13px;height:13px;background:${color};border:2px solid rgba(255,255,255,.6);box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    diamond: `<div style="width:12px;height:12px;background:${color};border:2px solid rgba(255,255,255,.6);transform:rotate(45deg);box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
  };
  return L.divIcon({ html: S[shape]||S.circle, className:'', iconSize:[14,14], iconAnchor:[7+o,7] });
}

function addMarker(loc) {
  if (!loc.lat||!loc.lng) return;
  const m = L.marker([loc.lat,loc.lng],{icon:buildIcon(loc.type,loc.icon||'circle',coordOffsets[loc.id]||0)});
  m.bindPopup(popupHTML(loc),{maxWidth:280});
  m.addTo(map);
  if (!isVisible(loc)) map.removeLayer(m);
  if (loc.labelOn && pinLabelsOn && isVisible(loc)) attachPinLabel(loc,m);
  markerMap[loc.id] = m;
}

function popupHTML(loc) {
  const cfg = typeConfig[loc.type]||{};
  return `<div style="min-width:190px;font-size:12px;line-height:1.6">
    <strong style="font-size:14px">${loc.name}</strong><br>
    <span style="color:#64748b">${[loc.city,loc.state,loc.country].filter(Boolean).join(', ')}</span><br>
    <span style="color:#64748b">Region: ${loc.region||'—'}</span><br>
    <div style="display:flex;align-items:center;gap:5px;margin:4px 0">
      <span style="width:8px;height:8px;border-radius:50%;background:${cfg.color||'#888'};display:inline-block;flex-shrink:0"></span>
      <span>${loc.platform||'—'}</span>
    </div>
    <div style="margin-top:8px;display:flex;gap:6px">
      <button class="pu-btn" onclick="openModal('${loc.id}')">✏️ Edit</button>
      <button class="pu-btn" onclick="cloneLocation('${loc.id}')">📋 Clone</button>
      <button class="pu-btn" onclick="removeLoc('${loc.id}')">🗑 Remove</button>
    </div>
  </div>`;
}

// ─── Customer Markers ─────────────────────────────────────────────────────────
function buildCustomerIcon(cust) {
  const color = cust.color||'#10b981'; const i = (cust.company||cust.name||'?')[0].toUpperCase();
  const html = `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,.8);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.4)">${i}</div>`;
  return L.divIcon({ html, className:'', iconSize:[22,22], iconAnchor:[11,11] });
}
function addCustomerMarker(cust) {
  if (!cust.lat||!cust.lng) return;
  const m = L.marker([cust.lat,cust.lng],{icon:buildCustomerIcon(cust)});
  m.bindPopup(customerPopupHTML(cust),{maxWidth:240}); m.addTo(map);
  customerMarkerMap[cust.id] = m;
}
function customerPopupHTML(cust) {
  return `<div style="min-width:170px;font-size:12px;line-height:1.6">
    <strong>${cust.company}</strong><br>
    <em style="color:#64748b">${cust.name}</em><br>
    <span style="color:#64748b">${[cust.city,cust.country].filter(Boolean).join(', ')}</span>
    ${cust.notes?`<p style="margin-top:4px;color:#64748b;font-size:11px">${cust.notes}</p>`:''}
    <div style="margin-top:8px;display:flex;gap:6px">
      <button class="pu-btn" onclick="openCustomerModal('${cust.id}')">✏️ Edit</button>
      <button class="pu-btn" onclick="removeCustomer('${cust.id}')">🗑 Remove</button>
    </div>
  </div>`;
}

// ─── Co-location Offsets ──────────────────────────────────────────────────────
function buildCoordOffsets() {
  const g={};
  locations.forEach(l=>{ const k=`${l.lat},${l.lng}`; if(!g[k]) g[k]=[]; g[k].push(l.id); });
  coordOffsets={};
  Object.values(g).forEach(ids=>ids.forEach((id,i)=>coordOffsets[id]=i));
}
function scheduleResolveOverlaps() { clearTimeout(overlapTimer); overlapTimer=setTimeout(resolveOverlaps,300); }
function resolveOverlaps() {
  buildCoordOffsets();
  locations.forEach(l=>{ const m=markerMap[l.id]; if(m) m.setIcon(buildIcon(l.type,l.icon||'circle',coordOffsets[l.id]||0)); });
}

// ─── Visibility ───────────────────────────────────────────────────────────────
function isVisible(loc) {
  if (layerOn[slugify(loc.platform)] === false) return false;
  if (platformFilter.size === 0) return true;
  return platformFilter.has(loc.platform);
}
function applyAllVisibility() {
  locations.forEach(loc=>{ const m=markerMap[loc.id]; if(!m) return; isVisible(loc)?map.addLayer(m):map.removeLayer(m); });
  updateCounts(); scheduleResolveOverlaps();
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function updateCounts() {
  const vis = locations.filter(isVisible);
  manifest.platforms.forEach(slug=>{ const el=document.getElementById('cnt-'+slug); if(el) el.textContent=locations.filter(l=>slugify(l.platform)===slug).length; });
  const allEl=document.getElementById('cnt-all'); if(allEl) allEl.textContent=locations.length;
  const tot=document.getElementById('stat-total'); if(tot) tot.textContent=vis.length;
  const regEl=document.getElementById('stat-regions'); if(regEl) regEl.textContent=new Set(vis.map(l=>l.region).filter(Boolean)).size;
  const vpEl=document.getElementById('stat-voicepops'); if(vpEl) vpEl.textContent=vis.filter(l=>['voicepop','sovvoice','fedrampvoice'].includes(l.type)).length;
  const custEl=document.getElementById('stat-customers'); if(custEl) custEl.textContent=customers.length;
  const spCount=document.getElementById('sp-count'); if(spCount) spCount.textContent=vis.length+' total';
  const lpCount=document.getElementById('lp-count'); if(lpCount) lpCount.textContent=customers.length;
}

// ─── Layer Buttons ────────────────────────────────────────────────────────────
function renderLayerButtons() {
  const cont = document.getElementById('layer-btns-dynamic'); if(!cont) return;
  cont.innerHTML = '';
  manifest.platforms.forEach(slug=>{
    const plat = platforms.find(p=>p.slug===slug);
    const name = plat ? plat.name : unslugify(slug);
    const typesHere = locations.filter(l=>slugify(l.platform)===slug).map(l=>l.type);
    // Most frequent type drives the button color
    const modeType = typesHere.length ? [...typesHere].sort((a,b)=>typesHere.filter(t=>t===b).length-typesHere.filter(t=>t===a).length)[0] : '';
    const color = (typeConfig[modeType]||{}).color||'#2B8EFF';
    const btn = document.createElement('button');
    btn.className='layer-btn active'; btn.dataset.layer=slug;
    btn.style.color=color; btn.style.borderColor=color;
    // Clickable dot opens color picker; button text toggles layer
    btn.innerHTML=`<span class="layer-color-dot" data-type="${modeType}" data-slug="${slug}" style="background:${color}" title="Click dot to change color" onclick="event.stopPropagation();pickLayerColor('${slug}','${modeType}',this)"></span>${name} <span class="cnt" id="cnt-${slug}">—</span>`;
    btn.onclick=()=>toggleLayer(slug);
    cont.appendChild(btn);
  });
}

function pickLayerColor(slug, type, dotEl) {
  if (!type) { showToast('No marker type assigned to this platform yet'); return; }
  const input = document.createElement('input');
  input.type = 'color';
  input.value = (typeConfig[type]||{}).color || '#2B8EFF';
  input.style.cssText = 'position:fixed;top:-100px;left:-100px;opacity:0;width:0;height:0';
  document.body.appendChild(input);
  input.addEventListener('input', () => {
    const c = input.value;
    if (!typeConfig[type]) typeConfig[type] = { color: c, label: type };
    else typeConfig[type].color = c;
    dotEl.style.background = c;
    const btn = dotEl.closest('.layer-btn');
    if (btn) { btn.style.color = c; btn.style.borderColor = c; }
    // Refresh all markers of this type live
    locations.filter(l=>l.type===type).forEach(l=>{ const m=markerMap[l.id]; if(m) m.setIcon(buildIcon(l.type,l.icon||'circle',coordOffsets[l.id]||0)); });
  });
  input.addEventListener('change', () => { persist(); document.body.removeChild(input); showToast('Color updated ✓'); });
  input.addEventListener('blur', () => { try{document.body.removeChild(input);}catch{} });
  input.click();
}
function toggleLayer(slug) {
  if (slug==='all') {
    const on=Object.values(layerOn).some(v=>v===false);
    manifest.platforms.forEach(s=>{layerOn[s]=on; setAct(s,on);}); setAct('all',on);
  } else {
    layerOn[slug]=layerOn[slug]===false?true:false;
    setAct(slug,layerOn[slug]!==false);
    setAct('all',manifest.platforms.every(s=>layerOn[s]!==false));
  }
  applyAllVisibility();
}
function setAct(slug,on) { const b=document.querySelector(`.layer-btn[data-layer="${slug}"]`); if(b) b.classList.toggle('active',on); }

// ─── Platform Filter ──────────────────────────────────────────────────────────
function openPFModal() { pfTemp=new Set(platformFilter); buildPFGrid(); updatePFCount(); document.getElementById('pf-overlay').classList.add('open'); }
function closePFModal() { document.getElementById('pf-overlay').classList.remove('open'); }
function buildPFGrid() {
  const g=document.getElementById('pf-modal-grid'); if(!g) return;
  const names=[...new Set(locations.map(l=>l.platform).filter(Boolean))].sort();
  g.innerHTML=names.map(n=>`<div class="pf-item${pfTemp.has(n)?' sel':''}" onclick="pfToggle('${n}',this)">${n}</div>`).join('');
}
function pfToggle(name,el) { pfTemp.has(name)?pfTemp.delete(name):pfTemp.add(name); el.classList.toggle('sel'); updatePFCount(); }
function pfSelectAll() { const names=[...new Set(locations.map(l=>l.platform).filter(Boolean))]; names.forEach(n=>pfTemp.add(n)); buildPFGrid(); updatePFCount(); }
function pfClearAll() { pfTemp.clear(); buildPFGrid(); updatePFCount(); }
function updatePFCount() { const el=document.getElementById('pf-match-count'); if(el) el.textContent=pfTemp.size?`${pfTemp.size} selected`:'All showing'; }
function applyPFModal() {
  platformFilter=new Set(pfTemp);
  const badge=document.getElementById('pf-badge');
  if(badge){ badge.style.display=platformFilter.size?'inline':'none'; if(platformFilter.size) badge.textContent=platformFilter.size; }
  document.getElementById('pf-btn').classList.toggle('active',platformFilter.size>0);
  applyAllVisibility(); closePFModal();
}

// ─── Dropdowns ────────────────────────────────────────────────────────────────
function toggleDD(id,e) {
  e&&e.stopPropagation();
  if(openDdId&&openDdId!==id) closeDD(openDdId);
  const wrap=document.getElementById(id); if(!wrap) return;
  const isOpen=wrap.classList.contains('open');
  if(isOpen){closeDD(id);return;}
  const btn=wrap.querySelector('.dd-btn'); const rect=btn.getBoundingClientRect();
  const menu=wrap.querySelector('.dd-menu');
  menu.style.top=(rect.bottom+4)+'px'; menu.style.left=rect.left+'px';
  wrap.classList.add('open');
  requestAnimationFrame(()=>{ const mr=menu.getBoundingClientRect(); if(mr.right>window.innerWidth-8) menu.style.left=(rect.right-mr.width)+'px'; });
  openDdId=id;
}
function closeDD(id) { const w=document.getElementById(id); if(w) w.classList.remove('open'); if(openDdId===id) openDdId=null; }
document.addEventListener('click',()=>{ if(openDdId) closeDD(openDdId); });

// ─── Pin Labels ───────────────────────────────────────────────────────────────
function attachPinLabel(loc,marker) {
  try{marker.unbindTooltip();}catch{}
  const text=loc.label||loc.name; if(!text) return;
  marker.bindTooltip(text,{permanent:true,direction:'top',offset:[0,-8],className:'pin-label',pane:'pinLabelPane',sticky:false});
  pinLabels[loc.id]=true;
}
function refreshAllPinLabels() {
  locations.forEach(loc=>{
    const m=markerMap[loc.id]; if(!m) return;
    try{m.unbindTooltip();}catch{}
    if(loc.labelOn&&pinLabelsOn&&isVisible(loc)) attachPinLabel(loc,m);
  });
}

// ─── Drawing System ───────────────────────────────────────────────────────────
function setDrawMode(mode) {
  drawMode=mode; drawingInProgress={points:[]};
  document.querySelectorAll('.dm-btn[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===(mode||'')));
  ['map-draw-line','map-draw-curve','map-draw-text'].forEach(c=>document.body.classList.remove(c));
  if(mode) document.body.classList.add('map-draw-'+mode);
  const drawBtn=document.getElementById('draw-mode-btn'); if(drawBtn) drawBtn.classList.toggle('active',!!mode);
  const hint=document.getElementById('draw-hint');
  if(hint){
    const msgs={line:'Click to add points → double-click to finish line',curve:'Click start → click end (curve auto-calculated)',text:'Click anywhere to place a text label'};
    hint.textContent=msgs[mode]||''; hint.style.display=mode?'block':'none';
  }
}

function onMapClick(e) {
  if(!drawMode) return;
  if(document.getElementById('modal')?.classList.contains('open')) return;
  const {lat,lng}=e.latlng;
  if(drawMode==='text'){
    const text=prompt('Label text:'); if(!text) return;
    const color=prompt('Text color (e.g. #ffffff):','#ffffff')||'#ffffff';
    drawings.push({id:'d_'+Date.now(),type:'text',lat,lng,text,color,fontSize:13});
    renderDrawings(); persist(); return;
  }
  if(drawMode==='line'||drawMode==='curve'){
    drawingInProgress.points.push([lat,lng]);
    if(drawMode==='curve'&&drawingInProgress.points.length===2){
      finishDrawing(); return;
    }
  }
}

function onMapDblClick(e) {
  if(drawMode==='line'&&drawingInProgress.points.length>=2){
    L.DomEvent.stop(e);
    finishDrawing();
  }
}

function finishDrawing() {
  if(drawingInProgress.points.length<2) return;
  const color=prompt('Line color (e.g. #2B8EFF):','#2B8EFF')||'#2B8EFF';
  const label=prompt('Line label (optional):')||'';
  const d={id:'d_'+Date.now(),type:'line',points:[...drawingInProgress.points],color,weight:2,opacity:0.85,label,curved:drawMode==='curve',curvature:0.3,arrow:true};
  drawings.push(d); renderDrawings(); persist(); drawingInProgress={points:[]};
}

function computeArcPoints(p1,p2,curvature=0.3,steps=24) {
  const mx=(p1[0]+p2[0])/2,my=(p1[1]+p2[1])/2;
  const dx=p2[1]-p1[1],dy=p2[0]-p1[0];
  const len=Math.sqrt(dx*dx+dy*dy)||1;
  const cx=mx+curvature*(-dy/len)*len,cy=my+curvature*(dx/len)*len;
  const pts=[];
  for(let i=0;i<=steps;i++){const t=i/steps;pts.push([(1-t)*(1-t)*p1[0]+2*(1-t)*t*cx+t*t*p2[0],(1-t)*(1-t)*p1[1]+2*(1-t)*t*cy+t*t*p2[1]]);}
  return pts;
}

function renderDrawings() {
  drawingLayers.forEach(({layer})=>{ try{map.removeLayer(layer);}catch{} });
  drawingLayers=[];
  drawings.forEach(d=>{
    if(d.type==='line'){
      const pts=d.curved&&d.points.length===2?computeArcPoints(d.points[0],d.points[1],d.curvature||0.3):d.points;
      const layer=L.polyline(pts,{color:d.color||'#2B8EFF',weight:d.weight||2,opacity:d.opacity||0.85,interactive:true});
      layer.on('click',e=>{
        L.DomEvent.stop(e);
        if(confirm('Remove this line?')){removeDrawing(d.id);}
      });
      if(drawingsVisible) layer.addTo(map); drawingLayers.push({id:d.id,layer});
      if(d.label&&pts.length){
        const mid=pts[Math.floor(pts.length/2)];
        const tl=L.marker(mid,{icon:L.divIcon({html:`<div class="draw-text-inner" style="color:${d.color||'#fff'}">${d.label}</div>`,className:'draw-text-marker',iconAnchor:[0,0]}),interactive:false});
        if(drawingsVisible) tl.addTo(map); drawingLayers.push({id:d.id+'_lbl',layer:tl});
      }
      if(d.arrow&&pts.length>=2){
        const last=pts[pts.length-1]; const prev=pts[pts.length-2];
        const angle=Math.atan2(last[0]-prev[0],last[1]-prev[1])*(180/Math.PI);
        const al=L.marker(last,{icon:L.divIcon({html:`<div style="transform:rotate(${angle}deg);color:${d.color||'#2B8EFF'};font-size:14px;line-height:1">▶</div>`,className:'',iconAnchor:[7,7]}),interactive:false});
        if(drawingsVisible) al.addTo(map); drawingLayers.push({id:d.id+'_arr',layer:al});
      }
    } else if(d.type==='text'){
      const layer=L.marker([d.lat,d.lng],{icon:L.divIcon({html:`<div class="draw-text-inner" style="color:${d.color||'#fff'};font-size:${d.fontSize||13}px">${d.text}</div>`,className:'draw-text-marker',iconAnchor:[0,10]}),interactive:true});
      layer.on('click',e=>{L.DomEvent.stop(e);if(confirm('Remove this label?')){removeDrawing(d.id);}});
      if(drawingsVisible) layer.addTo(map); drawingLayers.push({id:d.id,layer});
    }
  });
}

function toggleDrawings() {
  drawingsVisible=!drawingsVisible;
  drawingLayers.forEach(({layer})=>{ drawingsVisible?map.addLayer(layer):map.removeLayer(layer); });
  const btn=document.getElementById('dm-toggle'); if(btn) btn.classList.toggle('active',drawingsVisible);
}

function clearAllDrawings() { if(!confirm('Clear all drawings?')) return; drawings=[]; renderDrawings(); persist(); showToast('Drawings cleared'); }

function removeDrawing(id) {
  drawings=drawings.filter(d=>d.id!==id); renderDrawings(); persist();
}

// ─── Export Image / PDF ───────────────────────────────────────────────────────
async function exportAsImage() {
  if(!window.html2canvas){showToast('html2canvas not loaded');return;}
  showToast('Capturing map…');
  try {
    const bg=document.body.classList.contains('light')?'#f0f4f8':'#0f1117';
    const canvas=await html2canvas(document.getElementById('map'),{useCORS:true,allowTaint:true,backgroundColor:bg});
    const a=document.createElement('a'); a.download='nice-cxone-map.png'; a.href=canvas.toDataURL('image/png'); a.click();
    showToast('Image exported ✓');
  } catch(e){showToast('Export failed: '+e.message);}
}
async function exportAsPDF() {
  if(!window.html2canvas||!window.jspdf){showToast('Libraries not loaded');return;}
  showToast('Generating PDF…');
  try {
    const bg=document.body.classList.contains('light')?'#f0f4f8':'#0f1117';
    const canvas=await html2canvas(document.getElementById('map'),{useCORS:true,allowTaint:true,backgroundColor:bg});
    const {jsPDF}=window.jspdf; const w=canvas.width,h=canvas.height;
    const pdf=new jsPDF({orientation:w>h?'landscape':'portrait',unit:'px',format:[w,h]});
    pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,w,h);
    pdf.save('nice-cxone-map.pdf');
    showToast('PDF exported ✓');
  } catch(e){showToast('PDF failed: '+e.message);}
}

// ─── Export Data Files ────────────────────────────────────────────────────────
function exportAllFiles() {
  let delay=0;
  manifest.platforms.forEach(slug=>{
    const data=locations.filter(l=>slugify(l.platform)===slug);
    setTimeout(()=>dlJSON(slug+'.json',data),delay); delay+=300;
  });
  setTimeout(()=>dlJSON('marker-types.json',Object.entries(typeConfig).map(([key,cfg])=>({key,...cfg}))),delay); delay+=300;
  setTimeout(()=>dlJSON('customers.json',customers),delay); delay+=300;
  setTimeout(()=>dlJSON('drawings.json',drawings),delay); delay+=300;
  setTimeout(()=>dlJSON('manifest.json',manifest),delay);
  showToast(`Exporting ${manifest.platforms.length+4} files…`);
}

// ─── Import ───────────────────────────────────────────────────────────────────
function importFiles() { document.getElementById('import-file').click(); }
function handleImportFile(event) {
  const files=Array.from(event.target.files); let loaded=0;
  files.forEach(file=>{
    const reader=new FileReader();
    reader.onload=e=>{
      try {
        const data=JSON.parse(e.target.result); const name=file.name.replace('.json','');
        if(name==='marker-types'){
          typeConfig={};
          (Array.isArray(data)?data:[]).forEach(t=>{typeConfig[t.key]={color:t.color,label:t.label};});
          renderLayerButtons(); locations.forEach(l=>{const m=markerMap[l.id];if(m) m.setIcon(buildIcon(l.type,l.icon||'circle',coordOffsets[l.id]||0));});
        } else if(name==='customers'){
          customers=Array.isArray(data)?data:[];
          Object.values(customerMarkerMap).forEach(m=>map.removeLayer(m)); customerMarkerMap={};
          customers.forEach(addCustomerMarker); renderCustomerPanel();
        } else if(name==='drawings'){
          drawings=Array.isArray(data)?data:[]; renderDrawings();
        } else if(name==='manifest'){
          manifest=data; layerOn={}; manifest.platforms.forEach(s=>{layerOn[s]=true;}); renderLayerButtons();
        } else {
          const slug=name;
          if(!manifest.platforms.includes(slug)){ manifest.platforms.push(slug); layerOn[slug]=true; }
          platformData[slug]=Array.isArray(data)?data:[];
          locations.filter(l=>slugify(l.platform)===slug).forEach(l=>{if(markerMap[l.id]){map.removeLayer(markerMap[l.id]);delete markerMap[l.id];}});
          locations=locations.filter(l=>slugify(l.platform)!==slug);
          locations=[...locations,...platformData[slug]];
          const pname=platformData[slug][0]?.platform||unslugify(slug);
          if(!platforms.find(p=>p.slug===slug)) platforms.push({slug,name:pname});
          buildCoordOffsets();
          platformData[slug].forEach(addMarker);
          renderLayerButtons(); renderTable();
        }
        loaded++;
        if(loaded===files.length){persist();updateCounts();showToast(`Imported ${loaded} file${loaded>1?'s':''}`);}
      } catch(err){showToast('Error parsing: '+file.name);}
    };
    reader.readAsText(file);
  });
  event.target.value='';
}

// ─── Persist ──────────────────────────────────────────────────────────────────
function persist() {
  localStorage.setItem('nice_manifest',JSON.stringify(manifest));
  localStorage.setItem('nice_typecfg',JSON.stringify(typeConfig));
  localStorage.setItem('nice_customers',JSON.stringify(customers));
  localStorage.setItem('nice_drawings',JSON.stringify(drawings));
  manifest.platforms.forEach(slug=>{
    const data=locations.filter(l=>slugify(l.platform)===slug);
    localStorage.setItem('nice_pd_'+slug,JSON.stringify(data));
  });
  localStorage.setItem('nice_theme',document.body.classList.contains('light')?'light':'dark');
  localStorage.setItem('nice_labels',labelsOn?'1':'0');
  localStorage.setItem('nice_pinlabels',pinLabelsOn?'1':'0');
  document.getElementById('source-badge').textContent='Local';
}

function reloadFromSource() {
  if(!confirm('Clear local edits and reload data from GitHub?')) return;
  Object.keys(localStorage).filter(k=>k.startsWith('nice_')).forEach(k=>localStorage.removeItem(k));
  location.reload();
}

// ─── Side Panel ───────────────────────────────────────────────────────────────
function togglePanel() {
  const p=document.getElementById('side-panel'); p.classList.toggle('hidden');
  const btn=document.getElementById('list-btn'); if(btn) btn.classList.toggle('active',!p.classList.contains('hidden'));
}
function setLegendView(v) {
  legendView=v;
  document.querySelectorAll('.sp-tab').forEach(t=>t.classList.toggle('active',t.dataset.view===v));
  document.getElementById('sp-table-wrap').style.display=v==='table'?'':'none';
  document.getElementById('leg-view').style.display=v!=='table'?'':'none';
  renderTable();
}
function sortBy(k) {
  sortAsc=sortKey===k?!sortAsc:true; sortKey=k;
  ['name','region','country'].forEach(x=>{const th=document.getElementById('th-'+x);if(th) th.textContent=x.charAt(0).toUpperCase()+x.slice(1)+(x===k?(sortAsc?' ↑':' ↓'):' ↕');});
  renderTable();
}

function renderTable() {
  if(legendView==='table') renderTableView();
  else if(legendView==='bytype') renderByTypeView();
  else renderByPlatformView();
}

function renderTableView() {
  const tbody=document.getElementById('sp-tbody'); if(!tbody) return;
  const q=searchTerm.toLowerCase();
  let rows=locations.filter(l=>!q||[l.name,l.city,l.state,l.country,l.region,l.platform].some(v=>(v||'').toLowerCase().includes(q)));
  rows.sort((a,b)=>{ const va=(a[sortKey]||'').toLowerCase(),vb=(b[sortKey]||'').toLowerCase(); return sortAsc?va.localeCompare(vb):vb.localeCompare(va); });
  tbody.innerHTML=rows.map(l=>{
    const cfg=typeConfig[l.type]||{};
    return `<tr onclick="flyTo('${l.id}')">
      <td><span style="display:flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${cfg.color||'#888'};flex-shrink:0"></span>${l.name}</span></td>
      <td>${l.region||'—'}</td>
      <td>${[l.city,l.country].filter(Boolean).join(', ')||'—'}</td>
      <td style="font-size:10px">${l.platform||'—'}</td>
      <td style="text-align:center;white-space:nowrap">
        <button class="act-btn edit" title="Edit" onclick="event.stopPropagation();openModal('${l.id}')">✏️</button>
        <button class="act-btn" title="Clone" onclick="event.stopPropagation();cloneLocation('${l.id}')">📋</button>
        <button class="act-btn del" title="Remove" onclick="event.stopPropagation();removeLoc('${l.id}')">🗑</button>
      </td>
    </tr>`;
  }).join('');
}

function renderByTypeView() {
  const lv=document.getElementById('leg-view'); if(!lv) return;
  const groups={};
  locations.filter(isVisible).forEach(l=>{ if(!groups[l.type]) groups[l.type]=[]; groups[l.type].push(l); });
  lv.innerHTML=Object.entries(groups).map(([type,locs])=>{
    const cfg=typeConfig[type]||{};
    return `<div class="leg-section">
      <div class="leg-section-title" style="color:${cfg.color||'#888'}">${cfg.label||type} (${locs.length})</div>
      ${locs.map(l=>`<div class="leg-item" onclick="flyTo('${l.id}')"><span class="leg-dot" style="background:${cfg.color||'#888'}"></span>${l.name}<span style="color:var(--muted);font-size:10px;margin-left:auto">${l.country||''}</span></div>`).join('')}
    </div>`;
  }).join('');
}

function renderByPlatformView() {
  const lv=document.getElementById('leg-view'); if(!lv) return;
  const groups={};
  locations.filter(isVisible).forEach(l=>{ if(!groups[l.platform]) groups[l.platform]=[]; groups[l.platform].push(l); });
  lv.innerHTML=Object.entries(groups).sort(([a],[b])=>a.localeCompare(b)).map(([plat,locs])=>`
    <div class="leg-section">
      <div class="leg-section-title">${plat} (${locs.length})</div>
      ${locs.map(l=>{ const cfg=typeConfig[l.type]||{}; return `<div class="leg-item" onclick="flyTo('${l.id}')"><span class="leg-dot" style="background:${cfg.color||'#888'}"></span>${l.name}<span style="color:var(--muted);font-size:10px;margin-left:auto">${l.country||''}</span></div>`; }).join('')}
    </div>`).join('');
}

function flyTo(id) { const l=locations.find(x=>x.id===id);if(!l) return;map.flyTo([l.lat,l.lng],Math.max(map.getZoom(),5),{duration:1.2});setTimeout(()=>markerMap[id]?.openPopup(),1400); }

// ─── Left Panel (Customers) ───────────────────────────────────────────────────
function toggleLeftPanel() {
  const p=document.getElementById('left-panel'); p.classList.toggle('hidden');
  const btn=document.getElementById('cust-panel-btn'); if(btn) btn.classList.toggle('active',!p.classList.contains('hidden'));
}
function renderCustomerPanel() {
  const list=document.getElementById('lp-list'); if(!list) return;
  const q=(document.getElementById('lp-search-inp')?.value||'').toLowerCase();
  const groups={};
  customers.forEach(c=>{
    if(q&&![c.company,c.name,c.city,c.country].some(v=>(v||'').toLowerCase().includes(q))) return;
    const co=c.company||'Other'; if(!groups[co]) groups[co]=[]; groups[co].push(c);
  });
  list.innerHTML='';
  if(!Object.keys(groups).length){
    list.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted);font-size:11px">No customer sites yet.<br>Click ＋ Add Customer to begin.</div>';
    return;
  }
  Object.entries(groups).sort(([a],[b])=>a.localeCompare(b)).forEach(([company,sites])=>{
    const grp=document.createElement('div'); grp.className='cust-group open';
    grp.innerHTML=`<div class="cust-group-header" onclick="this.parentElement.classList.toggle('open')"><span class="cust-group-arrow">▶</span><span>${company}</span><span style="margin-left:auto;font-size:10px;color:var(--muted)">${sites.length}</span></div>
    <div class="cust-sites">${sites.map(c=>`<div class="cust-site-row" onclick="flyToCustomer('${c.id}')"><span class="cust-dot" style="background:${c.color||'#10b981'}"></span><span class="cust-site-name">${c.name}</span><span style="color:var(--muted);font-size:10px">${c.city||''}</span><div class="cust-site-actions"><button class="cust-act-btn" onclick="event.stopPropagation();openCustomerModal('${c.id}')" title="Edit">✏️</button><button class="cust-act-btn" onclick="event.stopPropagation();removeCustomer('${c.id}')" title="Remove">🗑</button></div></div>`).join('')}</div>`;
    list.appendChild(grp);
  });
}
function flyToCustomer(id) { const c=customers.find(x=>x.id===id);if(!c||!c.lat) return;map.flyTo([c.lat,c.lng],Math.max(map.getZoom(),6),{duration:1.2});setTimeout(()=>customerMarkerMap[id]?.openPopup(),1400); }

// ─── Customer Modal ───────────────────────────────────────────────────────────
function openCustomerModal(id) {
  editingCustomerId=id; const cust=id?customers.find(c=>c.id===id):null;
  document.getElementById('cm-title').innerHTML=cust?'✏️ Edit <span class="p">Customer Site</span>':'＋ Add <span class="p">Customer Site</span>';
  document.getElementById('cm-save-btn').textContent=cust?'Save Changes':'Add Site';
  document.getElementById('cm-company').value=cust?.company||'';
  document.getElementById('cm-name').value=cust?.name||'';
  document.getElementById('cm-city').value=cust?.city||'';
  document.getElementById('cm-country').value=cust?.country||'';
  document.getElementById('cm-lat').value=cust?.lat||'';
  document.getElementById('cm-lng').value=cust?.lng||'';
  document.getElementById('cm-notes').value=cust?.notes||'';
  selectedCustomerColor=cust?.color||'#10b981';
  buildCustomerColorPicker(); selCustIcon(cust?.icon||'circle');
  document.getElementById('cm-overlay').classList.add('open');
}
function closeCustomerModal() { document.getElementById('cm-overlay').classList.remove('open'); editingCustomerId=null; }
function buildCustomerColorPicker() {
  const cont=document.getElementById('cm-color-swatches'); if(!cont) return;
  cont.innerHTML=CUSTOMER_COLORS.map(c=>`<div class="color-swatch${c===selectedCustomerColor?' sel':''}" style="background:${c}" onclick="selectCustColor('${c}')"></div>`).join('');
  const cc=document.getElementById('cm-color-custom'); if(cc) cc.value=selectedCustomerColor;
}
function selectCustColor(color){selectedCustomerColor=color;buildCustomerColorPicker();}
function selCustIcon(shape){selCustIconVal=shape;document.querySelectorAll('#cm-icon-picker .iopt').forEach(el=>el.classList.toggle('sel',el.dataset.icon===shape));}
function saveCustomerModal() {
  const company=document.getElementById('cm-company').value.trim();
  const name=document.getElementById('cm-name').value.trim();
  const lat=parseFloat(document.getElementById('cm-lat').value);
  const lng=parseFloat(document.getElementById('cm-lng').value);
  if(!company){alert('Enter company name.');return;}
  if(!name){alert('Enter site name.');return;}
  if(isNaN(lat)||isNaN(lng)){alert('Coordinates required. Use Look up or right-click the map.');return;}
  const data={company,name,city:document.getElementById('cm-city').value.trim(),country:document.getElementById('cm-country').value.trim(),lat,lng,color:selectedCustomerColor,icon:selCustIconVal,notes:document.getElementById('cm-notes').value.trim()};
  if(editingCustomerId){
    const idx=customers.findIndex(c=>c.id===editingCustomerId);
    if(idx>-1){customers[idx]={...customers[idx],...data};const m=customerMarkerMap[editingCustomerId];if(m){m.setLatLng([lat,lng]);m.setIcon(buildCustomerIcon(customers[idx]));m.setPopupContent(customerPopupHTML(customers[idx]));}}
  } else {
    const cust={id:'cust_'+Date.now(),...data}; customers.push(cust); addCustomerMarker(cust);
    map.flyTo([lat,lng],Math.max(map.getZoom(),5),{duration:1.2});
  }
  persist();renderCustomerPanel();updateCounts();closeCustomerModal();showToast('Customer site saved');
}
function removeCustomer(id) {
  const c=customers.find(x=>x.id===id); if(!c) return;
  deletedCustomer=c; customers=customers.filter(x=>x.id!==id);
  const m=customerMarkerMap[id]; if(m) map.removeLayer(m); delete customerMarkerMap[id];
  persist();renderCustomerPanel();updateCounts();showToast(`"${c.name}" removed`,true);
}
function undoCustomerDelete(){if(!deletedCustomer) return;customers.push(deletedCustomer);addCustomerMarker(deletedCustomer);persist();renderCustomerPanel();updateCounts();deletedCustomer=null;}

// ─── Location Modal ───────────────────────────────────────────────────────────
function buildRegionSelect(current) {
  const sel=document.getElementById('m-region');if(!sel) return;
  const all=[...new Set([...DEFAULT_REGIONS,...locations.map(l=>l.region).filter(Boolean)])].sort();
  sel.innerHTML='<option value="">— Select —</option>'+all.map(r=>`<option value="${r}"${r===current?' selected':''}>${r}</option>`).join('')+'<option value="__new__">＋ Add new region…</option>';
  const ni=document.getElementById('m-region-new');if(ni){ni.style.display='none';ni.value='';}
}
function onRegionChange(){const sel=document.getElementById('m-region');const ni=document.getElementById('m-region-new');if(!sel||!ni) return;sel.value==='__new__'?(ni.style.display='block',ni.focus()):ni.style.display='none';}
function buildTypeSelect(selected){const sel=document.getElementById('m-type');if(!sel) return;sel.innerHTML=Object.entries(typeConfig).map(([key,cfg])=>`<option value="${key}"${key===selected?' selected':''}>${cfg.label}</option>`).join('');}
function checkUSState(){const v=document.getElementById('m-country')?.value;const show=isUSA(v);document.getElementById('state-row').style.display=show?'':'none';if(show){const sel=document.getElementById('m-state');if(sel.options.length<=1) US_STATES.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;sel.appendChild(o);});}}
function selIcon(shape){selIconVal=shape;document.querySelectorAll('#m-icon-picker .iopt').forEach(el=>el.classList.toggle('sel',el.dataset.icon===shape));}
function clearCoords(){if(!editingId){document.getElementById('m-lat').value='';document.getElementById('m-lng').value='';document.getElementById('geo-st').textContent='';document.getElementById('geo-st').className='geo-st';}}

function openModal(id){
  editingId=id; const loc=id?locations.find(l=>l.id===id):null;
  document.getElementById('modal-title').innerHTML=loc?'✏️ Edit <span class="p">Location</span>':'＋ Add <span class="p">Location</span>';
  document.getElementById('modal-save-btn').textContent=loc?'Save Changes':'Add to Map';
  document.getElementById('m-name').value=loc?.name||'';
  document.getElementById('m-city').value=loc?.city||'';
  document.getElementById('m-country').value=loc?.country||'';
  buildRegionSelect(loc?.region||'');
  document.getElementById('m-lat').value=loc?.lat||'';
  document.getElementById('m-lng').value=loc?.lng||'';
  document.getElementById('m-label').value=loc?.label||'';
  document.getElementById('m-label-on').checked=loc?.labelOn||false;
  const mPlat=document.getElementById('m-plat');
  mPlat.innerHTML='<option value="">— Select platform —</option>'+platforms.map(p=>`<option value="${p.name}">${p.name}</option>`).join('');
  mPlat.value=loc?.platform||'';
  buildTypeSelect(loc?.type||Object.keys(typeConfig)[0]||'appstack');
  selIcon(loc?.icon||'circle');
  checkUSState(); if(loc?.state) setTimeout(()=>{document.getElementById('m-state').value=loc.state;},30);
  document.getElementById('geo-st').textContent='or right-click the map to set coordinates';
  document.getElementById('geo-st').className='geo-st';
  document.getElementById('modal-map-wrap').style.display='none';
  if(modalPickerMarker&&modalPickerMap){try{modalPickerMap.removeLayer(modalPickerMarker);}catch{}modalPickerMarker=null;}
  document.getElementById('modal').classList.add('open');
}
function closeModal(){document.getElementById('modal').classList.remove('open');document.getElementById('modal-map-wrap').style.display='none';editingId=null;}

function saveModal(){
  const name=document.getElementById('m-name').value.trim();
  const lat=parseFloat(document.getElementById('m-lat').value);
  const lng=parseFloat(document.getElementById('m-lng').value);
  if(!name){alert('Enter a location name.');return;}
  if(isNaN(lat)||isNaN(lng)){alert('Coordinates required.');return;}
  const country=document.getElementById('m-country').value.trim();
  const rs=document.getElementById('m-region');const rn=document.getElementById('m-region-new');
  const region=rs.value==='__new__'?(rn?.value.trim()||''):rs.value;
  const data={name,city:document.getElementById('m-city').value.trim(),state:isUSA(country)?document.getElementById('m-state').value:'',country,region,platform:document.getElementById('m-plat').value,type:document.getElementById('m-type').value,icon:selIconVal,lat,lng,label:document.getElementById('m-label').value.trim(),labelOn:document.getElementById('m-label-on').checked};
  if(editingId){
    const idx=locations.findIndex(l=>l.id===editingId);
    if(idx>-1){locations[idx]={...locations[idx],...data};const loc=locations[idx];const m=markerMap[editingId];buildCoordOffsets();if(m){m.setLatLng([loc.lat,loc.lng]);m.setIcon(buildIcon(loc.type,loc.icon,coordOffsets[editingId]||0));m.setPopupContent(popupHTML(loc));isVisible(loc)?map.addLayer(m):map.removeLayer(m);}refreshAllPinLabels();}
  } else {
    const loc={id:'c_'+Date.now(),...data};locations.push(loc);buildCoordOffsets();addMarker(loc);
    map.flyTo([lat,lng],Math.max(map.getZoom(),5),{duration:1.2});setTimeout(()=>markerMap[loc.id]?.openPopup(),1400);
  }
  persist();updateCounts();renderTable();syncGpinBtn();closeModal();showToast(editingId?'Location updated':'Location added');
}

function cloneLocation(id){
  const src=locations.find(l=>l.id===id);if(!src) return;
  openModal(null);
  document.getElementById('m-name').value='Copy of '+src.name;
  document.getElementById('m-city').value=src.city||'';
  document.getElementById('m-country').value=src.country||'';
  buildRegionSelect(src.region||'');
  document.getElementById('m-lat').value=src.lat||'';
  document.getElementById('m-lng').value=src.lng||'';
  document.getElementById('m-label').value=src.label||'';
  document.getElementById('m-label-on').checked=src.labelOn||false;
  const mPlat=document.getElementById('m-plat');if(mPlat) mPlat.value=src.platform||'';
  buildTypeSelect(src.type||'appstack');selIcon(src.icon||'circle');
  checkUSState();if(src.state) setTimeout(()=>{document.getElementById('m-state').value=src.state;},50);
  const st=document.getElementById('geo-st');if(src.lat&&src.lng){st.textContent=`📍 ${src.lat}, ${src.lng} — cloned from ${src.name}`;st.className='geo-st ok';}
}

// ─── Geocode ──────────────────────────────────────────────────────────────────
async function geocode(){
  const name=document.getElementById('m-name').value.trim();
  const city=document.getElementById('m-city').value.trim();
  const country=document.getElementById('m-country').value.trim();
  const query=[city||name,country].filter(Boolean).join(', ');
  if(!query){alert('Enter a name or city to look up.');return;}
  const st=document.getElementById('geo-st');st.textContent='Searching…';st.className='geo-st';
  const cc=(GEO_CC[country.toLowerCase()]||[]).join(',');
  const url=`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}&accept-language=en${cc?'&countrycodes='+cc:''}`;
  try{
    const r=await fetch(url,{headers:{'Accept-Language':'en'}});
    const data=await r.json();
    if(!data.length){
      if(cc){const r2=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}&accept-language=en`,{headers:{'Accept-Language':'en'}});const d2=await r2.json();if(!d2.length){openMapPicker();st.textContent='Not found — pick on map';st.className='geo-st err';return;}data.push(d2[0]);}
      else{openMapPicker();st.textContent='Not found — pick on map';st.className='geo-st err';return;}
    }
    const best=data[0];
    document.getElementById('m-lat').value=parseFloat(best.lat).toFixed(4);
    document.getElementById('m-lng').value=parseFloat(best.lon).toFixed(4);
    st.textContent=`📍 ${parseFloat(best.lat).toFixed(4)}, ${parseFloat(best.lon).toFixed(4)} — ${best.display_name.split(',').slice(0,2).join(',')}`;
    st.className='geo-st ok';
  } catch(e){st.textContent='Lookup failed';st.className='geo-st err';}
}

// ─── Modal Map Picker ─────────────────────────────────────────────────────────
function toggleMapPicker(){const w=document.getElementById('modal-map-wrap');const vis=w.style.display==='none'||!w.style.display;w.style.display=vis?'block':'none';if(vis) openMapPicker();}
function openMapPicker(){
  const w=document.getElementById('modal-map-wrap');w.style.display='block';
  if(!modalPickerMap){modalPickerMap=L.map('modal-map-pick',{center:[20,0],zoom:2,attributionControl:false,zoomControl:true});L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',{maxZoom:18}).addTo(modalPickerMap);}
  setTimeout(()=>{modalPickerMap.invalidateSize();},100);
  modalPickerMap.off('click');
  modalPickerMap.on('click',e=>{
    const {lat,lng}=e.latlng;
    document.getElementById('m-lat').value=lat.toFixed(4);
    document.getElementById('m-lng').value=lng.toFixed(4);
    const st=document.getElementById('geo-st');st.textContent=`📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}`;st.className='geo-st ok';
    if(modalPickerMarker){modalPickerMap.removeLayer(modalPickerMarker);}
    modalPickerMarker=L.circleMarker([lat,lng],{radius:6,color:'#2B8EFF',fillColor:'#2B8EFF',fillOpacity:1}).addTo(modalPickerMap);
  });
}

// ─── Remove / Undo ────────────────────────────────────────────────────────────
function removeLoc(id){
  const loc=locations.find(l=>l.id===id);if(!loc) return;
  deletedLoc=loc;locations=locations.filter(l=>l.id!==id);
  const m=markerMap[id];if(m) map.removeLayer(m);delete markerMap[id];
  map.closePopup();buildCoordOffsets();resolveOverlaps();
  persist();updateCounts();renderTable();showToast(`"${loc.name}" removed`,true);
}
function undoDelete(){
  if(deletedLoc){locations.push(deletedLoc);buildCoordOffsets();addMarker(deletedLoc);persist();updateCounts();renderTable();deletedLoc=null;}
  if(deletedCustomer) undoCustomerDelete();
  showToast('Restored ✓');
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg,showUndo=false){
  const t=document.getElementById('toast');
  document.getElementById('toast-msg').textContent=msg;
  document.getElementById('toast-undo').style.display=showUndo?'inline':'none';
  t.classList.add('show');
  const bar=document.getElementById('toast-bar');
  bar.style.transition='none';bar.style.width='100%';
  requestAnimationFrame(()=>{bar.style.transition='width 3s linear';bar.style.width='0%';});
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3200);
}

// ─── Global Pin Shape ─────────────────────────────────────────────────────────
function syncGpinBtn(){
  const shapes=[...new Set(locations.map(l=>l.icon||'circle'))];
  const active=shapes.length===1?shapes[0]:'mixed';
  const sym=document.getElementById('pins-dd-sym');if(sym) sym.textContent=SHAPE_SYM[active]||'⬤';
  Object.keys(SHAPE_SYM).forEach(s=>{const el=document.getElementById('dc-'+s);if(el) el.textContent=s===active?'✓':'';});
}
function setAllIcons(shape){
  if(shape==='mixed') return;
  locations.forEach(loc=>{loc.icon=shape;const m=markerMap[loc.id];if(m) m.setIcon(buildIcon(loc.type,shape,coordOffsets[loc.id]||0));});
  persist();renderTable();syncGpinBtn();
}

// ─── Platform Manager ─────────────────────────────────────────────────────────
function openPlatformMgr(){pmWorking=platforms.map(p=>({...p}));renderPMList();document.getElementById('pm-overlay').classList.add('open');}
function closePM(){document.getElementById('pm-overlay').classList.remove('open');}
function renderPMList(){
  const list=document.getElementById('pm-list');if(!list) return;
  list.innerHTML=pmWorking.map((p,i)=>`<div class="pm-row"><input value="${p.name}" onchange="pmWorking[${i}].name=this.value" placeholder="Platform name"/><button class="pm-del-btn" onclick="pmDelete(${i})">🗑</button></div>`).join('');
}
function pmDelete(i){
  const p=pmWorking[i];
  if(locations.some(l=>l.platform===p.name)){alert(`Cannot remove "${p.name}" — it has ${locations.filter(l=>l.platform===p.name).length} locations. Remove locations first.`);return;}
  pmWorking.splice(i,1);renderPMList();
}
function addPlatform(){
  const inp=document.getElementById('pm-new-name');const name=inp.value.trim();if(!name) return;
  const slug=slugify(name);
  if(pmWorking.find(p=>p.slug===slug)){alert('Platform already exists.');return;}
  pmWorking.push({slug,name});inp.value='';renderPMList();
}
function savePlatforms(){
  platforms=pmWorking.map(p=>({...p}));
  // Add new platforms to manifest
  platforms.forEach(p=>{ if(!manifest.platforms.includes(p.slug)){manifest.platforms.push(p.slug);layerOn[p.slug]=true;platformData[p.slug]=[];} });
  // Remove platforms no longer in list (only if no locations)
  const newSlugs=new Set(platforms.map(p=>p.slug));
  manifest.platforms=manifest.platforms.filter(s=>newSlugs.has(s));
  persist();renderLayerButtons();closePM();showToast('Platforms saved');
}

// ─── Marker Type Manager ──────────────────────────────────────────────────────
function openMT(){renderMTList();document.getElementById('mt-overlay').classList.add('open');}
function closeMT(){document.getElementById('mt-overlay').classList.remove('open');}
function renderMTList(){
  const cont=document.getElementById('mt-list');if(!cont) return;
  cont.innerHTML=Object.entries(typeConfig).map(([key,cfg])=>`
    <div class="mt-row">
      <input type="color" class="mt-color" value="${cfg.color}" onchange="typeConfig['${key}'].color=this.value;updateMTMarkers()"/>
      <span class="mt-key">${key}</span>
      <input class="mt-label" value="${cfg.label}" onchange="typeConfig['${key}'].label=this.value"/>
      <button class="mt-del" onclick="mtDelete('${key}')" title="Delete">🗑</button>
    </div>`).join('');
}
function mtDelete(key){
  if(locations.some(l=>l.type===key)){alert(`Type "${key}" is in use.`);return;}
  delete typeConfig[key];renderMTList();
}
function addMTRow(){
  const key=prompt('New type key (lowercase, no spaces):'); if(!key) return;
  const slug=slugify(key).replace(/-/g,'');
  if(typeConfig[slug]){alert('Key already exists.');return;}
  typeConfig[slug]={color:'#888888',label:key};renderMTList();
}
function saveMT(){updateMTMarkers();persist();renderLayerButtons();closeMT();showToast('Marker types saved');}
function updateMTMarkers(){locations.forEach(l=>{const m=markerMap[l.id];if(m) m.setIcon(buildIcon(l.type,l.icon||'circle',coordOffsets[l.id]||0));});}

// ─── Search ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  const spSearch=document.getElementById('sp-search');
  if(spSearch) spSearch.addEventListener('input',e=>{searchTerm=e.target.value;renderTable();});
  const lpSearch=document.getElementById('lp-search-inp');
  if(lpSearch) lpSearch.addEventListener('input',()=>renderCustomerPanel());
  boot();
});
