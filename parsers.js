/* CAP_POR_TIPO abaixo. */

/* ---------- capacidade de peso por TIPO de veículo (do histórico real) ----------
   A coluna de "peso" na escala é VALOR DA NOTA, não peso — por isso a capacidade
   vem do TIPO do veículo, não da planilha. */
const CAP_POR_TIPO = [
  { re:/SPRINTER/i,      cap:700,  porte:"VUC"  },
  { re:/DELIVERY/i,      cap:1000, porte:"VUC"  },
  { re:/712/i,           cap:1400, porte:"3/4"  },
  { re:/MENOR/i,         cap:1400, porte:"3/4"  },
  { re:/9150|TOCO/i,     cap:4000, porte:"TOCO" },
  { re:/8160|CARGO|11180|TRUCK/i, cap:5500, porte:"TRUCK" },
  { re:/3\/?4|3-4/i,     cap:1800, porte:"3/4"  },
  { re:/VUC/i,           cap:1000, porte:"VUC"  },
];
function capDoTipo(tipo){
  const t=String(tipo||"").toUpperCase();
  for (const m of CAP_POR_TIPO) if (m.re.test(t)) return m;
  return { cap:1800, porte:"3/4" }; // default conservador
}

/* Parsers de POS (romaneio) e Escala (com cor) — rodam no navegador via SheetJS.
   Requer XLSX (SheetJS) carregado. */

/* ---------- POS: lista de clientes do dia (ignora placas) ---------- */
function parsePOS(workbook){
  // aceita romaneio em qualquer aba; procura linhas "Entrega"
  const clientes=[];
  for (const sn of workbook.SheetNames){
    const ws=workbook.Sheets[sn];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:null});
    let modo=null;
    for (const row of rows){
      if (!row||!row.length) continue;
      const c0=String(row[0]||"").trim();
      if (c0==="Tipo"){ modo="par"; continue; }
      if (/^\d{2}\/\d{2}\/\d{4}/.test(c0)){ modo="rota"; continue; }
      if (modo==="par" && c0==="Entrega"){
        const cod=String(row[2]||"").trim().replace(/^0+/,"")||String(row[2]||"").trim();
        if (!cod) continue;
        clientes.push({
          cod, razao:row[3], tipo:String(row[4]||"").trim(),
          bairro:row[5], cidade:row[6], endereco:row[7],
          lat:num(row[8]), lng:num(row[9]),
          pedido:row[14], valor:num(row[15]), qtd:num(row[16]),
          peso:num(row[17]), cubagem:num(row[18]), obs:row[20]
        });
      }
    }
  }
  // dedup por cod somando peso
  const dd={};
  for (const c of clientes){
    if (!dd[c.cod]) dd[c.cod]={...c};
    else ["peso","qtd","valor","cubagem"].forEach(k=>{ if(c[k]&&dd[c.cod][k]!=null) dd[c.cod][k]+=c[k]; });
  }
  return Object.values(dd);
}

/* ---------- ESCALA: frota do dia com status por COR ---------- */
const HEX_VERMELHO="FFFF0000", HEX_VERDE="FF92D050";
function parseEscala(workbook, ehTerceiro){
  const sn=workbook.SheetNames[0];
  const ws=workbook.Sheets[sn];
  const ref=XLSX.utils.decode_range(ws['!ref']);
  const proprios=[], fora=[], fleetcom=[];
  // cabeçalho linha 2 (index 1); dados a partir da linha 3 (index 2)
  for (let R=2; R<=ref.e.r; R++){
    const cell=(C)=>ws[XLSX.utils.encode_cell({r:R,c:C})];
    const placaCell=cell(0);
    // tabela lateral Fleetcom (col 11,12,13 => L,M,N)
    const pl=cell(11), rl=cell(12), ol=cell(13);
    if (pl&&rl&&ol && !String(rl.v).startsWith("Veic")){
      fleetcom.push({placa:String(pl.v).trim(), rota:rl.v, os:ol.v});
    }
    if (!placaCell || !String(placaCell.v||"").trim()) continue;
    const placa=String(placaCell.v).trim();
    if (placa.toUpperCase().startsWith("VEIC")) continue;
    // cor da célula da placa
    const cor = corDaCelula(placaCell);
    const status = cor===HEX_VERMELHO ? "MANUTENCAO" : cor===HEX_VERDE ? "SEM_EQUIPE" : "DISPONIVEL";
    const reg={
      placa,
      rota: cell(1)?.v,
      tipo: String(cell(2)?.v||"").trim(),
      tag: String(cell(3)?.v||"").trim().toUpperCase(),
valor_nota: limpaPeso(cell(4)?.v),   // coluna 5 = VALOR da nota, não peso
      peso_max_kg: capDoTipo(cell(2)?.v).cap,   // capacidade vem do TIPO
      porte_tipo: capDoTipo(cell(2)?.v).porte,
      cidade_raw: cell(5)?.v,
      regioes: extraiRegioes(cell(5)?.v),
      regime: extraiRegime(cell(5)?.v),
      horario: String(cell(6)?.v||"").trim(),
      muda_regiao: String(cell(7)?.v||"").trim().toUpperCase()==="SIM",
      ponto_apoio: cell(8)?.v,
      obs: cell(9)?.v,
      flags: extraiFlags(cell(5)?.v, cell(9)?.v),
      status, terceiro: !!ehTerceiro
    };
    if (status==="DISPONIVEL") proprios.push(reg); else fora.push(reg);
  }
  return { frota:proprios, fora, fleetcom };
}
function corDaCelula(cell){
  try{
    const f=cell.s && cell.s.fgColor;
    if (f && f.rgb) return (f.rgb.length===6?"FF":"")+f.rgb.toUpperCase();
  }catch(e){}
  return null;
}
function limpaPeso(v){
  if (v==null) return null;
  let s=String(v).replace("R$","").replace(/\s/g,"").trim();
  s=s.replace(/\./g,"").replace(",",".");
  const n=parseFloat(s); return isNaN(n)?null:Math.round(n);
}
function extraiRegioes(t){
  if (!t) return [];
  const base=String(t).replace(/\([^)]*\)/g,"");
  return base.split(/[/,]/).map(x=>x.trim()).filter(x=>x.length>2);
}
function extraiRegime(t){
  if (!t) return "INDEF";
  const u=String(t).toUpperCase();
  const v=u.includes("VAREJO"), r=u.includes("REDE")||u.includes("ASSAI")||u.includes("ATACAD")||u.includes("SENDAS");
  if (v&&r) return "AMBOS"; if (r) return "REDE"; if (v) return "VAREJO"; return "INDEF";
}
function extraiFlags(cidade,obs){
  const t=((cidade||"")+" "+(obs||"")).toUpperCase(), f={};
  if (t.includes("NÃO COLOCAR VAREJO")||t.includes("SÓ REDE")||t.includes("SOMENTE REDE")) f.so_rede=true;
  if (t.includes("NÃO ALTERAR")||t.includes("NÃO COLOCAR OUTRA REGIÃO")||t.includes("NÃO TIRAR")) f.regiao_travada=true;
  if (t.includes("PRIORIDADE REDE")) f.prioridade_rede=true;
  if (t.includes("APOIO GRANDES REDES")) f.coringa=true;
  if (t.includes("PERTO DO CD")||t.includes("PRÓXIMO DO CD")) f.perto_cd=true;
  if (t.includes("RECOLHE")||t.includes("CESTO")) f.cesto=true;
  return f;
}
function num(v){
  if (v==null || v==="") return null;
  if (typeof v==="number") return v;         // SheetJS já deu o número certo
  let s=String(v).trim();
  const temVirg=s.includes(","), temPonto=s.includes(".");
  if (temVirg && temPonto) s=s.replace(/\./g,"").replace(",",".");  // BR: 1.234,56
  else if (temVirg)        s=s.replace(",",".");                     // BR: 1234,56
  // só ponto ou inteiro: decimal padrão, não mexe
  const n=parseFloat(s);
  return isNaN(n)?null:n;
}

window.Parsers = { parsePOS, parseEscala };
