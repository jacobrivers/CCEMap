let map, baseLayer, countries=[], boundaries=null, thematicLayer=null, selectedIso=null;
let theme=localStorage.getItem('e164_theme')||'dark';
let mapSource=localStorage.getItem('e164_mapsource')||'carto';
let displayMode=localStorage.getItem('e164_displaymode')||'codes';
let noWrapMode=localStorage.getItem('e164_nowrap')==='1',centerPickMode=false;
let homeCenter=JSON.parse(localStorage.getItem('e164_homecenter')||'null')||[15,0];
let homeZoom=Math.min(19,Math.max(1,Number(localStorage.getItem('e164_homezoom'))||2));

const COLORS={'1':'#1597c7','2':'#27ae60','3':'#ba68c8','4':'#e64a45','5':'#bfd82f','6':'#e663b5','7':'#d98b4e','8':'#16b6b2','9':'#f2b705'};
const ZONES=[['1',50,-112],['2',4,16],['3',53,5],['4',61,18],['5',-23,-61],['6',-26,130],['7',55,80],['8',31,128],['9',23,69]];

function zone(country){return (country?.code||'').replace('+','')[0]||''}
function normalize(value){return (value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()}
function distance(a,b){
  if(!a.length)return b.length;if(!b.length)return a.length;
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old}}
  return row[b.length];
}
function fuzzyMatch(country,query){
  if(!query)return true;
  const fields=[country.name,country.code,country.region,country.subregion,country.iso2].map(normalize);
  if(fields.some(field=>field.includes(query)))return true;
  return distance(normalize(country.name),query)<=Math.max(2,Math.floor(query.length*.16));
}

async function boot(){
  if(theme==='light')document.body.classList.add('light');
  map=L.map('map',{center:homeCenter,zoom:homeZoom,minZoom:1,worldCopyJump:true,attributionControl:false});
  map.on('click',event=>{if(centerPickMode)finishCenterPicker(event.latlng)});
  map.on('resize',updateWorldWindow);
  map.createPane('countries');map.getPane('countries').style.zIndex=420;
  map.createPane('codes');map.getPane('codes').style.zIndex=650;
  [countries,boundaries]=await Promise.all([fetch('data/e164-countries.json').then(r=>r.json()),fetch('data/world-countries.geojson').then(r=>r.json())]);
  document.getElementById('map-source').value=mapSource;
  document.getElementById('display-mode').value=displayMode;
  [...new Set(countries.map(c=>c.region))].sort().forEach(region=>document.getElementById('region').add(new Option(region,region)));
  applyBaseLayer();renderThematicMap();renderResults();updateThemeButton();updateNoWrapButton();updateDisplayDescription();
  document.getElementById('loading').classList.add('hidden');
}

function applyBaseLayer(){
  if(baseLayer)map.removeLayer(baseLayer);
  const light=document.body.classList.contains('light');
  const bounds=noWrapMode?[[-90,homeCenter[1]-180],[90,homeCenter[1]+180]]:undefined;
  if(mapSource==='satellite')baseLayer=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:18,noWrap:false,bounds});
  else if(mapSource==='osm')baseLayer=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,noWrap:false,bounds});
  else baseLayer=L.tileLayer(light?'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png':'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',{maxZoom:19,noWrap:false,bounds});
  baseLayer.addTo(map);baseLayer.bringToBack();updateWorldWindow();
}

function displayLng(lng){return noWrapMode?lng+360*Math.round((homeCenter[1]-lng)/360):lng}
function displayLatLng(lat,lng){return[lat,displayLng(lng)]}
function canonicalLng(lng){return((lng+180)%360+360)%360-180}
function singleWorldMinZoom(){return Math.max(1,Math.ceil(Math.log2(Math.max(256,map.getSize().x)/256)))}
function updateWorldWindow(){
  if(!map)return;
  map.setMinZoom(noWrapMode?singleWorldMinZoom():1);
  map.setMaxBounds(noWrapMode?[[-90,homeCenter[1]-180],[90,homeCenter[1]+180]]:null);
  if(noWrapMode&&map.getZoom()<map.getMinZoom())map.setZoom(map.getMinZoom(),{animate:false});
}
function updateNoWrapButton(){const b=document.getElementById('nowrap-button');b.textContent=noWrapMode?'🌐 No Wrap':'🌍 Wrap';b.classList.toggle('active',noWrapMode)}
function toggleNoWrap(){noWrapMode=!noWrapMode;localStorage.setItem('e164_nowrap',noWrapMode?'1':'0');applyBaseLayer();renderThematicMap();map.setView(displayLatLng(homeCenter[0],homeCenter[1]),homeZoom);updateNoWrapButton()}
function saveCenter(latlng){homeCenter=[latlng.lat,canonicalLng(latlng.lng)];homeZoom=map.getZoom();localStorage.setItem('e164_homecenter',JSON.stringify(homeCenter));localStorage.setItem('e164_homezoom',String(homeZoom));applyBaseLayer();renderThematicMap();map.setView(displayLatLng(homeCenter[0],homeCenter[1]),homeZoom)}
function startCenterPicker(){centerPickMode=true;document.body.classList.add('pick-center');document.getElementById('center-hint').hidden=false;document.getElementById('center-button').classList.add('active')}
function finishCenterPicker(latlng){centerPickMode=false;document.body.classList.remove('pick-center');document.getElementById('center-hint').hidden=true;document.getElementById('center-button').classList.remove('active');saveCenter(latlng)}
function resetCenter(){homeCenter=[15,0];homeZoom=2;localStorage.removeItem('e164_homecenter');localStorage.removeItem('e164_homezoom');applyBaseLayer();renderThematicMap();map.setView(homeCenter,homeZoom)}

function codeIcon(country){
  const selected=country.iso2===selectedIso;
  return L.divIcon({className:'code-label-shell',html:`<div class="code-label${selected?' selected':''}">${selected?country.code:country.code.slice(1)}</div>`,iconSize:selected?[72,43]:[34,18],iconAnchor:selected?[36,21]:[17,9]});
}
function callingCodeBoundaries(){
  // Natural Earth groups French Guiana into France's FRA multipolygon. Split the
  // South American polygon so its fill follows its own +594 E.164 assignment.
  const split={...boundaries,features:boundaries.features.flatMap(feature=>{
    if(feature.id!=='FRA'||feature.geometry?.type!=='MultiPolygon')return[feature];
    const france=[],guiana=[];
    feature.geometry.coordinates.forEach(polygon=>{
      const isFrenchGuiana=polygon[0].some(point=>point[0]<-40);
      (isFrenchGuiana?guiana:france).push(polygon);
    });
    return[
      {...feature,geometry:{...feature.geometry,coordinates:france}},
      {...feature,id:'GUF',properties:{...feature.properties,name:'French Guiana'},geometry:{...feature.geometry,coordinates:guiana}}
    ];
  })};
  if(!noWrapMode)return split;
  const shift=coords=>Array.isArray(coords)&&typeof coords[0]==='number'?[displayLng(coords[0]),...coords.slice(1)]:coords.map(shift);
  return {...split,features:split.features.map(feature=>({...feature,geometry:{...feature.geometry,coordinates:shift(feature.geometry.coordinates)}}))};
}
function renderThematicMap(){
  if(thematicLayer)map.removeLayer(thematicLayer);
  thematicLayer=L.layerGroup().addTo(map);
  const showCountryCodes=displayMode!=='regions';
  const showZoneLabels=displayMode==='regions';
  const showRegionColors=displayMode!=='uniform';
  const byIso3=Object.fromEntries(countries.map(c=>[c.iso3,c]));
  L.geoJSON(callingCodeBoundaries(),{pane:'countries',style:feature=>{const c=byIso3[feature.id],selected=c?.iso2===selectedIso;return{color:selected?'#fff':'rgba(255,255,255,.75)',weight:selected?3:.65,fillColor:showRegionColors?(COLORS[zone(c)]||'#94a3b8'):'#64748b',fillOpacity:c ? (selected ? .98 : .86) : .13}},onEachFeature:(feature,layer)=>{const c=byIso3[feature.id];if(!c)return;layer.bindTooltip(`<strong>${c.flag} ${c.name}</strong><br>${c.code} · ${c.region}${c.subregion?' / '+c.subregion:''}`,{sticky:true});layer.on('click',()=>selectCountry(c.iso2))}}).addTo(thematicLayer);
  if(showCountryCodes)countries.forEach(c=>{const marker=L.marker(displayLatLng(c.lat,c.lng),{pane:'codes',icon:codeIcon(c),keyboard:true});marker.bindTooltip(`<strong>${c.flag} ${c.name}</strong><br>${c.code} · ${c.region}${c.subregion?' / '+c.subregion:''}`,{direction:'top'});marker.on('click',()=>selectCountry(c.iso2));marker.addTo(thematicLayer)});
  if(showZoneLabels)ZONES.forEach(([digit,lat,lng])=>L.marker(displayLatLng(lat,lng),{pane:'codes',interactive:false,icon:L.divIcon({className:'zone-label-shell',html:`<div class="zone-label" style="color:${COLORS[digit]}">+${digit}</div>`,iconSize:[68,48],iconAnchor:[34,24]})}).addTo(thematicLayer));
}

function updateDisplayDescription(){
  const descriptions={codes:'Regional colors show numbering zones; large zone labels are hidden so country codes remain clear.',regions:'Regional colors and large +1 through +9 labels show the global E.164 numbering zones.',uniform:'Countries use one neutral color so the individual calling codes are the focus.'};
  document.getElementById('display-description').textContent=`Country calling assignments follow ITU-T E.164. ${descriptions[displayMode]}`;
}
function setDisplayMode(mode){displayMode=mode;localStorage.setItem('e164_displaymode',mode);renderThematicMap();updateDisplayDescription()}

function filteredCountries(){const q=normalize(document.getElementById('search').value),region=document.getElementById('region').value;return countries.filter(c=>(!region||c.region===region)&&fuzzyMatch(c,q))}
function renderResults(){
  const rows=filteredCountries(),results=document.getElementById('results');
  document.getElementById('count').textContent=`${rows.length} ${rows.length===1?'match':'countries & territories'}`;
  results.innerHTML=rows.length?rows.map(c=>`<button class="country-row${c.iso2===selectedIso?' selected':''}" data-iso="${c.iso2}" role="listitem"><span class="flag">${c.flag}</span><span class="country-info"><strong>${c.name}</strong><small>${c.region} · ${c.subregion}</small></span><span class="code">${c.code}</span></button>`).join(''):'<div class="empty">No exact match.<br>Try a country name, calling code such as +44, or a world region.</div>';
  results.querySelectorAll('.country-row').forEach(row=>row.addEventListener('click',()=>selectCountry(row.dataset.iso)));
}
function selectCountry(iso){const c=countries.find(x=>x.iso2===iso);if(!c)return;selectedIso=iso;renderThematicMap();renderResults();map.flyTo(displayLatLng(c.lat,c.lng),Math.max(map.getZoom(),5),{duration:1});setTimeout(()=>document.querySelector('.country-row.selected')?.scrollIntoView({block:'nearest'}),50)}
function showWorld(){selectedIso=null;renderThematicMap();renderResults();map.flyTo(displayLatLng(homeCenter[0],homeCenter[1]),homeZoom,{duration:.8})}
function toggleTheme(){document.body.classList.toggle('light');theme=document.body.classList.contains('light')?'light':'dark';localStorage.setItem('e164_theme',theme);updateThemeButton();if(mapSource==='carto')applyBaseLayer()}
function updateThemeButton(){document.getElementById('theme-button').textContent=document.body.classList.contains('light')?'☀️ Light':'🌙 Dark'}

document.getElementById('search').addEventListener('input',renderResults);
document.getElementById('region').addEventListener('change',renderResults);
document.getElementById('clear-button').addEventListener('click',()=>{document.getElementById('search').value='';document.getElementById('region').value='';renderResults()});
document.getElementById('world-button').addEventListener('click',showWorld);
document.getElementById('theme-button').addEventListener('click',toggleTheme);
document.getElementById('nowrap-button').addEventListener('click',toggleNoWrap);
document.getElementById('center-button').addEventListener('click',startCenterPicker);
document.getElementById('reset-center-button').addEventListener('click',resetCenter);
document.getElementById('display-mode').addEventListener('change',event=>setDisplayMode(event.target.value));
document.getElementById('map-source').addEventListener('change',event=>{mapSource=event.target.value;localStorage.setItem('e164_mapsource',mapSource);applyBaseLayer()});
boot().catch(error=>{console.error(error);document.getElementById('loading').textContent='The E.164 map could not be loaded.'});
