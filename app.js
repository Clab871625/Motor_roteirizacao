/* App: liga uploads -> parsers -> motor -> mapa+lista */
let DADOS=null, POS=null, ESC=null, TERC=null, RESULT=null;

// descompacta dados embutidos
(function initDados(){
  try{ DADOS=window.EMBED_DATA; }
  catch(e){ console.error(e); }
})();

// data padrão = hoje
document.getElementById('dataAlvo').value=new Date().toISOString().slice(0,10);

function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.style.display='block'; setTimeout(()=>t.style.display='none',4000); }
function readFile(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsArrayBuffer(file); }); }
async function lerWorkbook(file){ const buf=await readFile(file); return XLSX.read(buf,{type:'array',cellStyles:true}); }

// uploads
setupUpload('filePos','stPos','dropPos', async (f)=>{ const wb=await lerWorkbook(f); POS=window.Parsers.parsePOS(wb); return `${POS.length} clientes`; });
setupUpload('fileEsc','stEsc','dropEsc', async (f)=>{ const wb=await lerWorkbook(f); ESC=window.Parsers.parseEscala(wb,false); return `${ESC.frota.length} placas · ${ESC.fora.length} fora`; });
setupUpload('fileTerc','stTerc','dropTerc', async (f)=>{ const wb=await lerWorkbook(f); TERC=window.Parsers.parseEscala(wb,true); return `${TERC.frota.length} terceiros`; });

function setupUpload(inputId, stId, dropId, handler){
  document.getElementById(inputId).addEventListener('change', async e=>{
    const f=e.target.files[0]; if(!f) return;
    document.getElementById(stId).textContent="...";
    try{
      const msg=await handler(f);
      document.getElementById(stId).textContent=msg;
      document.getElementById(dropId).classList.add('ok');
    }catch(err){ document.getElementById(stId).textContent="erro"; toast("Erro no arquivo: "+err.message); }
    checkReady();
  });
}
function checkReady(){ document.getElementById('btnRun').disabled = !(POS && POS.length); }

// roteirizar
document.getElementById('btnRun').addEventListener('click', ()=>{
  if (!POS || !DADOS) return;
  const data=document.getElementById('dataAlvo').value;
  const escala = ESC ? { proprios:ESC.frota, terceiros:(TERC?TERC.frota:[]) } : null;
  try{
    RESULT=window.MotorEspelho.roteirizar(DADOS, POS, escala, data);
    document.getElementById('empty').style.display='none';
    document.getElementById('map').style.display='block';
    document.getElementById('kpis').style.display='grid';
    document.getElementById('flt').style.display='flex';
    requestAnimationFrame(()=>render(RESULT));
  }catch(e){ toast("Erro ao roteirizar: "+e.message); console.error(e); }
});

/* ---------- render mapa (Leaflet) + lista ---------- */
let LMAP=null, LLAYERS=[];
function cor(i){ const h=(i*137.508)%360; return `hsl(${h},70%,50%)`; }
function render(res){
  const rotas=res.rotas;
  if (!rotas.length){ toast("Nenhuma rota gerada (verifique o POS)."); return; }

  // kpis
  const totCli=rotas.reduce((s,r)=>s+r.clientes.length,0);
  const totPeso=rotas.reduce((s,r)=>s+r.peso,0);
  const cnt=p=>rotas.filter(r=>(r.porte||"").startsWith(p)).length;
  document.getElementById('kRotas').textContent=rotas.length;
  document.getElementById('kCli').textContent=totCli;
  document.getElementById('kPeso').textContent=(totPeso/1000).toFixed(1)+"t";
  document.getElementById('kVuc').textContent=cnt("VUC");
  document.getElementById('k34').textContent=cnt("3/4");
  document.getElementById('kFic').textContent=rotas.filter(r=>(r.placa||"").startsWith("SUZ")).length;

  rotas.forEach((r,i)=>r._cor=cor(i));

  // Leaflet: cria mapa 1x, reusa depois
  if (!LMAP){
    LMAP = L.map('map', {preferCanvas:true, zoomControl:true}).setView([CD_PT().lat, CD_PT().lng], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:19, attribution:'© OpenStreetMap'
    }).addTo(LMAP);
  }
  setTimeout(()=>LMAP.invalidateSize(),0);

  // limpa layers anteriores
  LLAYERS.forEach(l=>LMAP.removeLayer(l)); LLAYERS=[];

  // barreiras físicas (rodovias) — motor evita cruzar
  (window.MotorEspelho.BARREIRAS||[]).forEach(barr=>{
    const line = L.polyline(barr.pts, {color:'#ff3b30', weight:3, opacity:0.35, dashArray:'8,6'})
      .bindTooltip('🚧 '+barr.nome+' (barreira)', {sticky:true}).addTo(LMAP);
    LLAYERS.push(line);
  });
  // CD
  const cdMarker = L.circleMarker([CD_PT().lat, CD_PT().lng],
    {radius:9, color:'#fff', fillColor:'#10b981', fillOpacity:1, weight:2})
    .bindPopup('<b>CD Suzano</b>').addTo(LMAP);
  LLAYERS.push(cdMarker);

  const grupos={};
  const bounds = L.latLngBounds();
  bounds.extend([CD_PT().lat, CD_PT().lng]);

  rotas.forEach(r=>{
    const cor=r._cor;
    const cpts=r.clientes.filter(c=>c.lat!=null && c.lng!=null);
    const layers=[];
    // polyline CD -> sequência -> CD
    const latlngs = [[CD_PT().lat, CD_PT().lng], ...cpts.map(c=>[c.lat,c.lng]), [CD_PT().lat, CD_PT().lng]];
    const line = L.polyline(latlngs, {color:cor, weight:3, opacity:0.7}).addTo(LMAP);
    layers.push(line); LLAYERS.push(line);
    // marcador numerado por cliente
    cpts.forEach((c,i)=>{
      bounds.extend([c.lat, c.lng]);
      const icon = L.divIcon({
        className:'rota-label',
        html:`<div style="background:${cor};color:#fff;font:700 10px system-ui;padding:2px 5px;border-radius:9px;border:2px solid #fff;box-shadow:0 1px 3px #0006;min-width:16px;text-align:center">${i+1}</div>`,
        iconSize:[22,18], iconAnchor:[11,9]
      });
      const m = L.marker([c.lat, c.lng], {icon});
      m.bindPopup(`<b>${i+1}. ${(c.razao||'?').slice(0,50)}</b><br>
        cód ${c.cod} · ${Math.round(c.peso||0)}kg<br>
        ${c.tipo||''}<br>${c.bairro||''} · ${c.cidade||''}<br>
        <i>Rota ${r.id} · ${r.setor} · ${r.placa||r.porte}</i>`);
      m.addTo(LMAP);
      layers.push(m); LLAYERS.push(m);
    });
    grupos[r.id]={onda:r.onda, fic:(r.placa||'').startsWith('SUZ'), layers, cor};
  });

  if (bounds.isValid()) LMAP.fitBounds(bounds, {padding:[30,30]});

  // lista
  const lst=document.getElementById('lst'); lst.innerHTML='';
  rotas.forEach(r=>{
    const fic=(r.placa||'').startsWith('SUZ');
    const warn = r.tempo_h>10 ? ' <span class="warn">⚠︎'+r.tempo_h+'h</span>' : '';
    const div=document.createElement('div'); div.className='rota'; div.dataset.id=r.id; div.dataset.onda=r.onda; div.dataset.fic=fic?1:0;
    div.innerHTML=`<div class="dot" style="background:${r._cor}"></div><div class="ri">
      <div class="t">Rota ${r.id} · ${r.setor} <span class="badge b-${r.onda}">${r.onda[0]}</span></div>
      <div class="m">${r.clientes.length} cli · ${r.peso}kg · ${r.tempo_h}h${warn} · <span class="${fic?'fic':''}">${r.placa||r.porte}</span></div></div>`;
    div.addEventListener('click',()=>{
      document.querySelectorAll('.rota').forEach(x=>x.classList.remove('sel')); div.classList.add('sel');
      // destaca só a rota clicada: as outras ficam com opacidade baixa
      Object.entries(grupos).forEach(([id,g])=>{
        const foco = +id===r.id;
        g.layers.forEach(l=>{
          if (l.setStyle) l.setStyle({opacity: foco?0.9:0.15, fillOpacity: foco?1:0.2});
          if (l._icon) l._icon.style.opacity = foco?1:0.25;
        });
      });
      // centraliza no cluster da rota
      if (LMAP){
        const b = L.latLngBounds();
        r.clientes.filter(c=>c.lat!=null).forEach(c=>b.extend([c.lat,c.lng]));
        b.extend([CD_PT().lat, CD_PT().lng]);
        if (b.isValid()) LMAP.fitBounds(b, {padding:[40,40]});
      }
      mostraDetalhe(r);
    });
    lst.appendChild(div);
  });
  window._grupos=grupos;
}

function mostraDetalhe(r){
  const d=document.getElementById('detalhe');
  const linhas=r.clientes.map((c,i)=>`<li>${i+1}. <b>${(c.razao||'?').slice(0,30)}</b> — ${Math.round(c.peso||0)}kg <span style="color:var(--mut)">(${c.cod})</span></li>`).join("");
  d.innerHTML=`<b>Rota ${r.id} · ${r.setor}</b> — ${r.placa||r.porte}<br>
    <span style="color:var(--mut)">${r.clientes.length} clientes · ${r.peso}kg · ${r.tempo_h}h · onda ${r.onda}</span>
    <ol>${linhas}</ol>`;
  d.classList.add('show');
}

// filtros
document.getElementById('flt').addEventListener('click',e=>{
  if (e.target.tagName!=='BUTTON') return;
  document.querySelectorAll('#flt button').forEach(x=>x.classList.remove('on')); e.target.classList.add('on');
  const f=e.target.dataset.f;
  document.querySelectorAll('.rota').forEach(el=>{
    const fic=el.dataset.fic==='1';
    el.style.display = (f==='all'||(f==='fic'?fic:el.dataset.onda===f))?'':'none';
  });
  if (window._grupos && LMAP) Object.entries(window._grupos).forEach(([id,g])=>{
    const el=document.querySelector('.rota[data-id="'+id+'"]');
    const visivel = el && el.style.display!=='none';
    g.layers.forEach(l=>{
      if (visivel){
        if (!LMAP.hasLayer(l)) l.addTo(LMAP);
        if (l.setStyle) l.setStyle({opacity:0.7, fillOpacity:1});
        if (l._icon) l._icon.style.opacity=1;
      } else {
        if (LMAP.hasLayer(l)) LMAP.removeLayer(l);
      }
    });
  });
  document.getElementById('detalhe').classList.remove('show');
});

function CD_PT(){ return {lat:-23.575768,lng:-46.306107}; }


