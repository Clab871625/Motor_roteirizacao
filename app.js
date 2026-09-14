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
    render(RESULT);
  }catch(e){ toast("Erro ao roteirizar: "+e.message); console.error(e); }
});

/* ---------- render mapa + lista ---------- */
function cor(i){ const h=(i*137.508)%360; return `hsl(${h},60%,55%)`; }
function render(res){
  const rotas=res.rotas;
  document.getElementById('empty').style.display='none';
  document.getElementById('svgwrap').style.display='block';
  document.getElementById('kpis').style.display='grid';
  document.getElementById('flt').style.display='flex';

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

  // bounds
  const pts=rotas.flatMap(r=>r.clientes).filter(c=>c.lat!=null).concat([CD_PT()]);
  const minLat=Math.min(...pts.map(p=>p.lat)), maxLat=Math.max(...pts.map(p=>p.lat));
  const minLng=Math.min(...pts.map(p=>p.lng)), maxLng=Math.max(...pts.map(p=>p.lng));
  const W=document.getElementById('main').clientWidth, H=document.getElementById('main').clientHeight, pad=40;
  const xy=(lat,lng)=>({ x:pad+(lng-minLng)/(maxLng-minLng||1)*(W-2*pad), y:pad+(maxLat-lat)/(maxLat-minLat||1)*(H-2*pad) });

  const svg=document.getElementById('svg'); svg.setAttribute('viewBox',`0 0 ${W} ${H}`); svg.innerHTML='';
  const NS="http://www.w3.org/2000/svg";
  const el=(t,a)=>{ const e=document.createElementNS(NS,t); for(const k in a)e.setAttribute(k,a[k]); return e; };

  // setores de fundo
  (window.SETORES_BBOX||[]).forEach(s=>{
    const pp=s.map(([la,ln])=>{const p=xy(la,ln);return `${p.x.toFixed(0)},${p.y.toFixed(0)}`;}).join(" ");
    svg.appendChild(el('polygon',{points:pp,class:'setor-bg'}));
  });
  // CD
  const cd=xy(CD_PT().lat,CD_PT().lng);
  svg.appendChild(el('circle',{cx:cd.x,cy:cd.y,r:7,fill:'var(--dist)',stroke:'#fff','stroke-width':2}));

  const grupos={};
  const tip=document.getElementById('tip');
  rotas.forEach(r=>{
    const g=el('g',{'data-id':r.id,'data-onda':r.onda,'data-fic':(r.placa||'').startsWith('SUZ')?1:0});
    let d=`M${cd.x},${cd.y}`;
    const cpts=r.clientes.filter(c=>c.lat!=null).map(c=>({...c,...xy(c.lat,c.lng)}));
    cpts.forEach(p=>d+=` L${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    g.appendChild(el('path',{d,fill:'none',stroke:r._cor,'stroke-width':2,opacity:.7}));
    cpts.forEach((p,i)=>{
      const c=el('circle',{cx:p.x,cy:p.y,r:7,fill:r._cor,stroke:'#fff','stroke-width':1,class:'pt'});
      c.addEventListener('mouseover',()=>{ tip.style.display='block'; tip.innerHTML=`<b>${i+1}. ${(p.razao||'?').slice(0,32)}</b><br>cód ${p.cod} · ${Math.round(p.peso||0)}kg<br>${p.tipo||''}<br><i>Rota ${r.id} · ${r.setor} · ${r.placa||r.porte}</i>`; });
      c.addEventListener('mousemove',e=>{ const b=svg.getBoundingClientRect(); tip.style.left=(e.clientX-b.left+12)+'px'; tip.style.top=(e.clientY-b.top+12)+'px'; });
      c.addEventListener('mouseout',()=>tip.style.display='none');
      g.appendChild(c);
      const tx=el('text',{x:p.x,y:p.y+3,class:'seqn'}); tx.textContent=i+1; g.appendChild(tx);
    });
    grupos[r.id]=g; svg.appendChild(g);
  });

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
      Object.values(grupos).forEach(g=>g.style.opacity=.12); grupos[r.id].style.opacity=1;
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
  if (window._grupos) Object.entries(window._grupos).forEach(([id,g])=>{
    const el=document.querySelector('.rota[data-id="'+id+'"]');
    g.style.display = (el && el.style.display!=='none')?'':'none'; g.style.opacity=1;
  });
  document.getElementById('detalhe').classList.remove('show');
});

function CD_PT(){ return {lat:-23.575768,lng:-46.306107}; }


