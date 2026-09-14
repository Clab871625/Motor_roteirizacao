/* ============================================================================
   MOTOR-ESPELHO DE ROTEIRIZAÇÃO — PANCO CD SUZANO
   Toda a lógica roda no navegador. Ver ESPECIFICACAO.md para as regras.
   ============================================================================ */

const CD = { lat: -23.575768, lng: -46.306107 };
const CFG = {
  DIST_FACTOR: 2.0,        // reta -> estrada (Suzano)
  VEL_KMH: 32,             // velocidade média urbana
  REDE_PEQ_KG: 150,        // rede "pequena"
  LADO_A_LADO_KM: 0.5,     // Sendas+Sendas só se < isso
  COMP_TETO: 9, COMP_IDEAL: 7,
  VUC: 1000, TRESQ: 1800, TOCO: 4000, TRUCK: 5500,
  OCUP_MIN: 0.40,          // ocupação mínima do veículo
  MARGEM_H: 1.0,           // diferença máx de tempo entre vizinhas
  VIZINHA_KM: 5.0,         // raio pra considerar rotas vizinhas
  MOLDE_SEMANAS: 4,        // janela deslizante
  FREQ_FIXO: 2,            // cliente fixo = aparece em >=2 das 4 semanas
  DISTRIB_PLACA: "FFW9E44",
  TEMPO: { REDE: 110, PARTICULAR: 40, VAREJO: 16 },
  MAX_CLI_VAREJO: 17,      // teto de entregas por rota varejo (regra do CD)
  MAX_CLI_PART: 12,        // teto de entregas por rota de particularidade
  PREFERE_2_VUC: true,     // dividir 1 rota que caberia num 3/4 em 2 VUCs
  ALIVIO_VAREJO: 15,       // acima disso, tenta empurrar cliente pra rota rede vizinha
  MAX_KM_ROTA: 90,         // deslocamento máx por rota (estrada, ida+volta CD)
  DIF_CLI_BAL: 3,          // diferença mínima de clientes entre vizinhas pra rebalancear
  DIF_PESO_BAL: 400,       // diferença mínima de peso (kg) pra considerar rota "pesada"
};
const DIAS = ["segunda","terca","quarta","quinta","sexta","sabado","domingo"];

/* ---------- utilidades geográficas ---------- */
function hav(a, b) {
  const R = 6371, rad = Math.PI/180;
  const la1=a.lat*rad, lo1=a.lng*rad, la2=b.lat*rad, lo2=b.lng*rad;
  const d = Math.sin((la2-la1)/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin((lo2-lo1)/2)**2;
  return 2*R*Math.asin(Math.sqrt(d));
}
function centro(cls) {
  const pts = cls.filter(c=>c.lat!=null);
  if (!pts.length) return CD;
  return { lat: pts.reduce((s,c)=>s+c.lat,0)/pts.length,
           lng: pts.reduce((s,c)=>s+c.lng,0)/pts.length };
}
const peso = c => c.peso || 0;

/* ---------- classificação de cliente ---------- */
function ehComp(n){ n=(n||"").toUpperCase(); return n.includes("CIA BRASILEIRA")||n.includes("COMPANHIA BRASILEIRA"); }
function bandeira(n){ n=(n||"").toUpperCase(); return { sendas:n.includes("SENDAS"), wms:n.includes("WMS") }; }
function classifica(c){
  const t=(c.tipo||"").toUpperCase(), n=(c.razao||"").toUpperCase();
  if (t.includes("DISTRIBUIDOR")) return "DISTRIBUIDOR";
  if (t.includes("REDE")||n.includes("SENDAS")||n.includes("WMS")||ehComp(n)) return "REDE";
  if (t.includes("PARTICULAR")) return "PARTICULAR";
  return "VAREJO";
}
function tempoCat(cat){ return CFG.TEMPO[cat] || 16; }

/* ---------- tempo estimado de uma rota ---------- */
function tempoRota(cls){
  if (!cls.length) return 0;
  const atend = cls.reduce((s,c)=>s+tempoCat(classifica(c)),0);
  const pts = cls.filter(c=>c.lat!=null);
  let desloc=0, cur=CD, rest=pts.slice();
  while (rest.length){
    let k=0,best=1e9;
    for (let i=0;i<rest.length;i++){const d=hav(cur,rest[i]); if(d<best){best=d;k=i;}}
    desloc += best*CFG.DIST_FACTOR; cur=rest[k]; rest.splice(k,1);
  }
  desloc += hav(cur,CD)*CFG.DIST_FACTOR;
  return atend + (desloc/CFG.VEL_KMH)*60; // minutos
}

/* ---------- porte pelo peso ---------- */
function porteDe(pw){
  if (pw<=CFG.VUC) return "VUC";
  if (pw<=CFG.TRESQ) return "3/4";
  if (pw<=CFG.TOCO) return "TOCO-terc";
  return "TRUCK-terc";
}

/* ---------- divisão geográfica (k-means simples equilibrado) ---------- */
function divide(cls, k){
  if (k<=1 || cls.length<=1) return cls.length ? [cls] : [];
  const pts = cls.map(c=> c.lat!=null ? {lat:c.lat,lng:c.lng} : null);
  const idx = pts.map((p,i)=>p?i:-1).filter(i=>i>=0);
  if (idx.length < k) k = Math.max(1, idx.length);
  if (k<=1) return [cls];
  let seeds = [];
  for (let i=0;i<k;i++) seeds.push(pts[idx[Math.floor(i*idx.length/k)]]);
  let groups;
  for (let it=0; it<15; it++){
    groups = Array.from({length:k},()=>[]);
    for (const i of idx){
      let kb=0,best=1e9;
      for (let j=0;j<k;j++){const d=hav(pts[i],seeds[j]); if(d<best){best=d;kb=j;}}
      groups[kb].push(i);
    }
    for (let j=0;j<k;j++){
      if (groups[j].length){
        seeds[j]={ lat:groups[j].reduce((s,i)=>s+pts[i].lat,0)/groups[j].length,
                   lng:groups[j].reduce((s,i)=>s+pts[i].lng,0)/groups[j].length };
      }
    }
  }
  let out = groups.filter(g=>g.length).map(g=>g.map(i=>cls[i]));
  const semc = cls.filter((c,i)=>!pts[i]);
  if (semc.length && out.length) out[0].push(...semc);
  return out;
}

/* ---------- carga (peso + qtd) para balanceamento ---------- */
function cargaScore(cls){ return cls.reduce((s,c)=>s+peso(c),0)/1000 + cls.length*0.15; }

/* ---------- balanceamento SÓ entre vizinhas (peso+qtd) ---------- */
function balanceiaVizinhas(grupos, capKg, ondaRede){
  if (grupos.length<2) return grupos;
  for (let iter=0; iter<150; iter++){
    let melhor=null;
    for (let i=0;i<grupos.length;i++){
      for (let j=0;j<grupos.length;j++){
        if (i===j || !grupos[i].length || !grupos[j].length) continue;
        if (hav(centro(grupos[i]),centro(grupos[j])) > CFG.VIZINHA_KM) continue;
        const dif = cargaScore(grupos[i]) - cargaScore(grupos[j]);
        if (dif>0 && (!melhor || dif>melhor.dif)) melhor={i,j,dif};
      }
    }
    if (!melhor || melhor.dif<=0.4) break;
    const cheia=grupos[melhor.i], vazia=grupos[melhor.j];
    if (cheia.length<=1) break;
    const cv=centro(vazia);
    const cand=cheia.filter(c=>c.lat!=null).sort((a,b)=>hav(a,cv)-hav(b,cv));
    let moved=false;
    for (const c of cand){
      if (ondaRede){
        if (vazia.length>=4) continue;
        const bN=bandeira(c.razao); let ok=true;
        for (const x of vazia){
          const bX=bandeira(x.razao);
          if ((bN.sendas&&bX.sendas)||(bN.wms&&bX.wms)||(bN.sendas&&bX.wms)||(bN.wms&&bX.sendas)){
            const d = (c.lat!=null&&x.lat!=null) ? hav(c,x) : 99;
            if (d>CFG.LADO_A_LADO_KM){ ok=false; break; }
          }
        }
        if (!ok) continue;
      }
      if (vazia.reduce((s,x)=>s+peso(x),0)+peso(c) <= capKg){
        cheia.splice(cheia.indexOf(c),1); vazia.push(c); moved=true; break;
      }
    }
    if (!moved) break;
  }
  return grupos;
}

/* ---------- deslocamento total de uma rota (km, ida + entregas + volta) ---------- */
function desloc(cls){
  const pts=cls.filter(c=>c.lat!=null);
  if (!pts.length) return 0;
  let d=0, cur=CD, rest=pts.slice();
  while (rest.length){
    let k=0,best=1e9;
    for (let i=0;i<rest.length;i++){const dd=hav(cur,rest[i]); if(dd<best){best=dd;k=i;}}
    d+=best; cur=rest[k]; rest.splice(k,1);
  }
  d+=hav(cur,CD);
  return d*CFG.DIST_FACTOR;
}

/* ---------- A) ALÍVIO varejo -> rede do mesmo setor ---------- */
function aliviaVarejoEmRede(rotas){
  for (let iter=0; iter<20; iter++){
    let moveu=false;
    const setores=[...new Set(rotas.map(r=>r.setor))];
    for (const s of setores){
      const vs=rotas.filter(r=>r.setor===s && r.onda==="VAREJO" && r.clientes.length>CFG.ALIVIO_VAREJO);
      const rs=rotas.filter(r=>r.setor===s && r.onda==="REDE" && !r.placa);
      if (!vs.length || !rs.length) continue;
      for (const v of vs){
        // ordena clientes varejo por proximidade média aos centros das rotas rede
        const cds=rs.map(r=>({r,c:centro(r.clientes),pw:r.clientes.reduce((a,c)=>a+peso(c),0)}));
        const cand=v.clientes.filter(c=>c.lat!=null).map(c=>{
          let best=1e9,alvo=null;
          for (const x of cds){
            const pesoNovo=x.pw+peso(c);
            if (pesoNovo>CFG.TRESQ) continue;
            const d=hav(c,x.c);
            if (d<best){ best=d; alvo=x; }
          }
          return {c,alvo,d:best};
        }).filter(x=>x.alvo).sort((a,b)=>a.d-b.d);
        if (cand.length){
          const {c,alvo}=cand[0];
          alvo.r.clientes.push(c);
          v.clientes.splice(v.clientes.indexOf(c),1);
          moveu=true;
          break;
        }
      }
      if (moveu) break;
    }
    if (!moveu) break;
  }
}

/* ---------- B) BALANCEAMENTO peso × entregas entre vizinhas do mesmo setor ---------- */
function posBalanceamento(rotas){
  for (let iter=0; iter<40; iter++){
    let moveu=false;
    const setores=[...new Set(rotas.map(r=>r.setor))];
    for (const s of setores){
      const grp=rotas.filter(r=>r.setor===s && r.onda==="VAREJO");
      if (grp.length<2) continue;
      // pega o par mais desbalanceado (dif de entregas e peso)
      let par=null,melhor=0;
      for (let i=0;i<grp.length;i++) for (let j=0;j<grp.length;j++){
        if (i===j) continue;
        const pa=grp[i].clientes.reduce((a,c)=>a+peso(c),0);
        const pb=grp[j].clientes.reduce((a,c)=>a+peso(c),0);
        const na=grp[i].clientes.length, nb=grp[j].clientes.length;
        // regra: A "pesado + muitas entregas" doa cliente pra B "leve + poucas entregas"
        // (a rota mais pesada tem que ter MENOS entregas — equilíbrio real)
        if (pa-pb<CFG.DIF_PESO_BAL) continue;
        if (na-nb<CFG.DIF_CLI_BAL) continue;
        if (hav(centro(grp[i].clientes),centro(grp[j].clientes)) > CFG.VIZINHA_KM) continue;
        const score=(pa-pb)+(na-nb)*300;
        if (score>melhor){ melhor=score; par={a:grp[i],b:grp[j]}; }
      }
      if (!par) continue;
      // move o cliente da A mais próximo do centro de B, respeitando teto de peso
      const cb=centro(par.b.clientes);
      const cand=par.a.clientes.filter(c=>c.lat!=null).sort((x,y)=>hav(x,cb)-hav(y,cb));
      for (const c of cand){
        const novo=par.b.clientes.reduce((a,x)=>a+peso(x),0)+peso(c);
        if (novo>CFG.TRESQ) continue;
        if (par.b.clientes.length>=CFG.MAX_CLI_VAREJO) continue;
        par.a.clientes.splice(par.a.clientes.indexOf(c),1);
        par.b.clientes.push(c);
        moveu=true; break;
      }
      if (moveu) break;
    }
    if (!moveu) break;
  }
}

/* ---------- C) QUEBRA rotas muito longas (Itaqua/Aruja/Guarulhos) ---------- */
function quebraLongas(rotas){
  const out=[];
  for (const r of rotas){
    if (r.placa || r.clientes.length<=3){ out.push(r); continue; }
    const km=desloc(r.clientes);
    if (km<=CFG.MAX_KM_ROTA){ out.push(r); continue; }
    const sub=divide(r.clientes,2);
    const okDividir = sub.length===2
      && sub.every(g=>g.length>=1)
      && sub.every(g=>g.reduce((a,c)=>a+peso(c),0)<=CFG.TRESQ);
    if (!okDividir){ out.push(r); continue; }
    for (const g of sub) out.push({setor:r.setor,onda:r.onda,clientes:g});
  }
  return out;
}

/* ============================================================================
   MOTOR PRINCIPAL
   dados = { ocor:[{d,w,r,v,c:[cod...]}], cli:{cod:{lat,lng,t,ij,fj,n}} }
   pos   = [{cod,razao,tipo,lat,lng,peso,...}]  (clientes do dia)
   escala= { proprios:[...], terceiros:[...] } | null
   dataAlvo = "YYYY-MM-DD"
   ============================================================================ */
function roteirizar(dados, pos, escala, dataAlvo){
  const dow = DIAS[new Date(dataAlvo+"T12:00:00").getDay()===0?6:new Date(dataAlvo+"T12:00:00").getDay()-1];
  // janela: 4 datas anteriores do mesmo dow
  const datasDow = [...new Set(dados.ocor.filter(o=>o.w===dow && o.d<dataAlvo).map(o=>o.d))].sort();
  const janela = datasDow.slice(-CFG.MOLDE_SEMANAS);

  // molde: setor -> {cod:freq}; contagem de rotas/dia
  const rotaCli={}, tmp={};
  for (const o of dados.ocor){
    if (o.w===dow && janela.includes(o.d)){
      (rotaCli[o.r] = rotaCli[o.r]||{});
      for (const c of o.c) rotaCli[o.r][c]=(rotaCli[o.r][c]||0)+1;
      (tmp[o.r]=tmp[o.r]||{}); tmp[o.r][o.d]=(tmp[o.r][o.d]||0)+1;
    }
  }
  const nRotasSetor={};
  for (const s in tmp){ const v=Object.values(tmp[s]); nRotasSetor[s]=Math.max(1,Math.round(v.reduce((a,b)=>a+b,0)/v.length)); }

  // cliente -> setor fixo (freq>=2)
  const clienteSetor={};
  for (const s in rotaCli) for (const cod in rotaCli[s]){
    const f=rotaCli[s][cod];
    if (f>=CFG.FREQ_FIXO && (!clienteSetor[cod] || f>clienteSetor[cod].f)) clienteSetor[cod]={s,f};
  }
  // centro de setor (só simples, sem vírgula)
  const setorCentro={};
  for (const s in rotaCli){
    const pts=[];
    for (const cod in rotaCli[s]){ if (rotaCli[s][cod]>=CFG.FREQ_FIXO){ const cc=dados.cli[cod]; if(cc&&cc.lat) pts.push(cc); } }
    if (pts.length) setorCentro[s]={lat:pts.reduce((a,c)=>a+c.lat,0)/pts.length,lng:pts.reduce((a,c)=>a+c.lng,0)/pts.length};
  }
  const setoresSimples={};
  for (const s in setorCentro) if (!s.includes(",")) setoresSimples[s]=setorCentro[s];

  // atribui clientes do dia -> setor
  const porSetor={}, distrib=[];
  for (const c of pos){
    const cat=classifica(c);
    if (cat==="DISTRIBUIDOR"){ distrib.push(c); continue; }
    let s;
    if (clienteSetor[c.cod] && setoresSimples[clienteSetor[c.cod].s]) s=clienteSetor[c.cod].s;
    else if (c.lat!=null){
      let best=1e9;
      for (const k in setoresSimples){const d=hav(c,setoresSimples[k]); if(d<best){best=d;s=k;}}
    } else s="Suzano";
    (porSetor[s]=porSetor[s]||{VAREJO:[],PARTICULAR:[],REDE:[]})[cat].push(c);
  }

  let rotas=[], suz=0;
  const terc=()=>`SUZ-${String(++suz).padStart(4,"0")}`;

  // ONDA 1 — VAREJO
  for (const s in porSetor){
    const varejo=porSetor[s].VAREJO;
    if (!varejo.length) continue;
    // teto de clientes força um número mínimo de rotas (nunca menos que o molde)
    const kMolde = nRotasSetor[s]||1;
    const kPorCli = Math.ceil(varejo.length / CFG.MAX_CLI_VAREJO);
    const kPorPeso = Math.ceil(varejo.reduce((a,c)=>a+peso(c),0) / CFG.TRESQ);
    let k = Math.max(kMolde, kPorCli, kPorPeso);
    let grupos=divide(varejo, k);
    // quebra grupos que ainda estouram teto (peso OU clientes) OU preferem 2 VUCs a 1 3/4
    let fixed=[];
    for (let g of grupos){
      let precisaQuebra = ()=> {
        const pw = g.reduce((a,c)=>a+peso(c),0);
        if (pw>CFG.TRESQ) return true;
        if (g.length>CFG.MAX_CLI_VAREJO) return true;
        // prefere 2 VUCs a 1 3/4: se peso passa VUC mas cabe em 2 VUCs, divide
        if (CFG.PREFERE_2_VUC && pw>CFG.VUC && pw<=2*CFG.VUC && g.length>=2) return true;
        return false;
      };
      while (precisaQuebra() && g.length>1){
        const sub=divide(g,2); if (sub.length<2) break; fixed.push(sub[1]); g=sub[0];
      }
      fixed.push(g);
    }
    grupos=balanceiaVizinhas(fixed, CFG.TRESQ, false);
    for (const g of grupos) if (g.length) rotas.push({setor:s,onda:"VAREJO",clientes:g});
  }

  // ONDA 2 — PARTICULARIDADES
  for (const s in porSetor){
    const rv=rotas.filter(r=>r.setor===s && r.onda==="VAREJO");
    for (const p of porSetor[s].PARTICULAR){
      if (peso(p)>CFG.TRESQ){ rotas.push({setor:s,onda:"PARTICULAR",clientes:[p],placa:terc()}); continue; }
      // só encaixa na varejo se não estourar peso NEM o teto de entregas
      const cand=rv.filter(r=>
        r.clientes.reduce((a,c)=>a+peso(c),0)+peso(p)<=CFG.TRESQ
        && r.clientes.length < CFG.MAX_CLI_VAREJO
      );
      if (cand.length && p.lat!=null){
        cand.sort((a,b)=>hav(p,centro(a.clientes))-hav(p,centro(b.clientes)));
        cand[0].clientes.push(p);
      } else rotas.push({setor:s,onda:"PARTICULAR",clientes:[p]});
    }
  }

  // ONDA 3 — REDE
  for (const s in porSetor){
    const redes=porSetor[s].REDE;
    if (!redes.length) continue;
    // pesados > 3/4 -> terceiro sozinho
    for (const c of redes.filter(x=>peso(x)>CFG.TRESQ)) rotas.push({setor:s,onda:"REDE",clientes:[c],placa:terc()});
    let leves=redes.filter(x=>peso(x)<=CFG.TRESQ);
    const comp=leves.filter(x=>ehComp(x.razao));
    let grandes=leves.filter(x=>!ehComp(x.razao));
    const rv=rotas.filter(r=>r.setor===s && r.onda==="VAREJO");
    for (const cp of comp){
      const cand=rv.filter(r=>
        r.clientes.length<=CFG.COMP_TETO
        && r.clientes.length < CFG.MAX_CLI_VAREJO
        && r.clientes.reduce((a,c)=>a+peso(c),0)+peso(cp)<=CFG.TRESQ
      );
      if (cand.length && cp.lat!=null){ cand.sort((a,b)=>hav(cp,centro(a.clientes))-hav(cp,centro(b.clientes))); cand[0].clientes.push(cp); }
      else grandes.push(cp);
    }
    grandes.sort((a,b)=>peso(b)-peso(a));
    let grupos=[];
    for (const c of grandes){
      let posto=false;
      for (const g of grupos){
        if (g.length>=4) continue;
        if (g.reduce((a,x)=>a+peso(x),0)+peso(c)>CFG.TRESQ) continue;
        const bN=bandeira(c.razao); let ok=true;
        for (const x of g){
          const bX=bandeira(x.razao);
          if ((bN.sendas&&bX.sendas)||(bN.wms&&bX.wms)||(bN.sendas&&bX.wms)||(bN.wms&&bX.sendas)){
            const d=(c.lat!=null&&x.lat!=null)?hav(c,x):99; if(d>CFG.LADO_A_LADO_KM){ok=false;break;}
          }
        }
        if (!ok) continue;
        if (g.length===3 && (g.concat([c]).filter(x=>peso(x)<=CFG.REDE_PEQ_KG).length<2)) continue;
        g.push(c); posto=true; break;
      }
      if (!posto) grupos.push([c]);
    }
    grupos=balanceiaVizinhas(grupos, CFG.TRESQ, true);
    for (const g of grupos) if (g.length) rotas.push({setor:s,onda:"REDE",clientes:g});
  }

  // LIMPEZA — funde rotas < 40% ocupação com vizinha do mesmo setor/onda
  const capRota=r=>{ const pw=r.clientes.reduce((a,c)=>a+peso(c),0); return pw<=CFG.VUC?CFG.VUC:CFG.TRESQ; };
  const ocup=r=>r.clientes.reduce((a,c)=>a+peso(c),0)/capRota(r);
  let mudou=true;
  while (mudou){
    mudou=false;
    const setores=[...new Set(rotas.map(r=>r.setor))];
    for (const s of setores){
      for (const onda of ["VAREJO","REDE"]){
        const grp=rotas.filter(r=>r.setor===s&&r.onda===onda&&!r.placa);
        const magras=grp.filter(r=>ocup(r)<CFG.OCUP_MIN && grp.length>1);
        for (const m of magras){
          const outras=grp.filter(r=>r!==m);
          const cand=outras.filter(r=>r.clientes.reduce((a,c)=>a+peso(c),0)+m.clientes.reduce((a,c)=>a+peso(c),0)<=CFG.TRESQ);
          if (!cand.length) continue;
          cand.sort((a,b)=>hav(centro(m.clientes),centro(a.clientes))-hav(centro(m.clientes),centro(b.clientes)));
          cand[0].clientes.push(...m.clientes); rotas.splice(rotas.indexOf(m),1); mudou=true; break;
        }
        if (mudou) break;
      }
      if (mudou) break;
    }
  }

  // A) ALÍVIO: rota varejo estufada empurra cliente próximo pra rota REDE do mesmo setor
  aliviaVarejoEmRede(rotas);
  // B) BALANCEAMENTO peso × entregas entre rotas varejo vizinhas do mesmo setor
  posBalanceamento(rotas);
  // C) QUEBRA rotas com deslocamento gigante (proxy: barreiras Itaqua/Aruja/Guarulhos)
  rotas = quebraLongas(rotas);

  // DISTRIBUIDOR fixo
  if (distrib.length) rotas.push({setor:"DISTRIBUIDOR",onda:"DISTRIB",clientes:distrib,placa:CFG.DISTRIB_PLACA});

  // ATRIBUI PLACAS pela escala (própria -> terceiro escala -> fictícia)
  atribuiPlacas(rotas, escala);

  // finaliza: sequência, porte, métricas
  for (const r of rotas){
    r.clientes = sequencia(r.clientes);
    r.peso = Math.round(r.clientes.reduce((a,c)=>a+peso(c),0));
    r.tempo_h = Math.round(tempoRota(r.clientes)/60*10)/10;
    if (!r.porte) r.porte = porteDe(r.peso);
  }
  rotas = rotas.filter(r=>r.clientes.length);
  rotas.forEach((r,i)=>r.id=i+1);
  return { rotas, janela, dow, nRotasSetor, suz };
}

/* ---------- sequência: janela primeiro, depois pesado primeiro ---------- */
function sequencia(cls){
  // ordena por vizinho-mais-próximo a partir do CD, respeitando janela e peso como desempate
  const pts=cls.filter(c=>c.lat!=null);
  const sem=cls.filter(c=>c.lat==null);
  let out=[], cur=CD, rest=pts.slice();
  while (rest.length){
    // prioriza janela apertada; entre próximos, o mais pesado
    rest.sort((a,b)=>{
      const ja=janelaFim(a), jb=janelaFim(b);
      if (ja!==jb) return ja-jb;                 // janela mais cedo primeiro
      const da=hav(cur,a), db=hav(cur,b);
      if (Math.abs(da-db)>1.5) return da-db;     // senão, mais perto
      return peso(b)-peso(a);                    // empate: mais pesado
    });
    out.push(rest[0]); cur=rest[0]; rest.shift();
  }
  return out.concat(sem);
}
function janelaFim(c){
  const f=(c.fj||c.fim_janela||"");
  const m=/(\d{1,2}):?(\d{2})?/.exec(f);
  return m ? parseInt(m[1])*60+(parseInt(m[2])||0) : 9999;
}

/* ---------- atribuição de placas — OPÇÃO 2:
   distribui placas disponíveis por porte/capacidade nas rotas JÁ montadas.
   Ordem: PRÓPRIA (por capacidade) -> TERCEIRO da escala -> FICTÍCIA (só se acabar placa).
   Região casa só como DESEMPATE. Placa vermelha/verde nunca entra (já filtrada no parser). */
function atribuiPlacas(rotas, escala){
  if (!escala){ return; } // modo teste: fica só o porte
  // frota disponível (o parser já tirou manutenção/sem-equipe)
  let proprios = (escala.proprios||[]).map(v=>({...v, usado:false}));
  let terceiros = (escala.terceiros||[]).map(v=>({...v, usado:false}));

  // rotas que ainda não têm placa (distribuidor e pesados-terceiro já têm), pesadas primeiro
  const pendentes = rotas.filter(r=>!r.placa)
    .sort((a,b)=> b.clientes.reduce((s,c)=>s+peso(c),0) - a.clientes.reduce((s,c)=>s+peso(c),0));

  let suz = rotas.filter(r=>(r.placa||"").startsWith("SUZ")).length;

  for (const r of pendentes){
    const pw = r.clientes.reduce((s,c)=>s+peso(c),0);
    const setor = (r.setor||"").toUpperCase();
    // 1) PRÓPRIA: menor placa que aguenta o peso; região como desempate
    let v = pegaPlaca(proprios, pw, setor);
    if (v){ r.placa=v.placa; r.porte=v.tipo||porteDe(pw); v.usado=true; r.frota="propria"; continue; }
    // 2) TERCEIRO da escala (só quando acabou própria que sirva)
    v = pegaPlaca(terceiros, pw, setor);
    if (v){ r.placa=v.placa; r.porte=(v.tipo||porteDe(pw)); v.usado=true; r.frota="terceiro"; continue; }
    // 3) FICTÍCIA (último recurso)
    r.placa=`SUZ-${String(++suz).padStart(4,"0")}`; r.porte=porteDe(pw); r.frota="ficticia";
  }
}
/* pega a melhor placa livre que aguenta o peso.
   prioridade: (a) região casa  (b) menor capacidade que serve (não desperdiça caminhão grande) */
function pegaPlaca(frota, pw, setor){
  const servem = frota.filter(v=>!v.usado && (v.peso_max_kg==null || v.peso_max_kg>=pw));
  if (!servem.length) return null;
  const comRegiao = servem.filter(v=>(v.regioes||[]).some(rr=>{
    const R=rr.toUpperCase(); return setor.includes(R)||R.includes(setor);
  }));
  const pool = comRegiao.length ? comRegiao : servem;
  pool.sort((a,b)=>(a.peso_max_kg||99999)-(b.peso_max_kg||99999));
  return pool[0];
}

window.MotorEspelho = { roteirizar, CFG, classifica, hav, DIAS };
