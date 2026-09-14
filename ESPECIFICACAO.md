# ESPECIFICAÇÃO — Motor-Espelho de Roteirização | PANCO CD Suzano

> **Este documento é a fonte de verdade do projeto.** Qualquer pessoa (ou IA, como o
> Claude Code) que for evoluir este código deve ler este arquivo primeiro. Ele contém
> TODAS as regras de negócio definidas com o Cleyton (analista de transporte da PANCO,
> CD Suzano), extraídas de dezenas de conversas de validação. Não invente regras que não
> estejam aqui; se algo não estiver especificado, pergunte ao Cleyton.

---

## 1. O QUE É O PROJETO

Um **motor-espelho** de roteirização que automatiza o trabalho manual de 2-3 horas/dia do
analista. Em vez de otimizar do zero, o motor **parte do desenho das rotas do mesmo dia
da semana anterior** (o "molde"/"espelho") e o atualiza para os pedidos reais do dia.

**Filosofia central:** copiar o raciocínio que o analista já aplica na mão — não
reinventar. O equilíbrio entre equipes, a divisão de setores, os agrupamentos: tudo isso
já está embutido no histórico, porque foi um humano que desenhou semana após semana. O
motor **reproduz esse padrão**, não recalcula do zero.

### Arquitetura de execução (decidida)
- **Modo C (client-side):** todo o motor roda em **JavaScript no navegador**. Sem backend,
  sem servidor rodando. Os dados fixos (molde + cadastros) vão embutidos no build.
- **Deploy:** link separado na **Vercel** (o Cleyton já usa Vercel para outro projeto).
- **Lincros NÃO é substituído** — ele fica na execução (mapa, app do motorista, tracking).
  O motor entra ANTES: gera a rota, o Cleyton "laça" no Lincros com as duas telas lado a
  lado (plataforma numa, Lincros na outra). No futuro, integração via API
  (`POST /embarque/roteirizado/criarSync`) — fora de escopo por ora.

### Fluxo do usuário (o que a plataforma faz)
1. Cleyton sobe pedidos no Lincros como sempre, joga tudo em placa(s) fictícia(s) só para
   exportar, e **exporta o CSV/XLSX de pedidos (POS)**.
2. Na plataforma: **anexa o POS** (a plataforma ignora as placas, usa só a lista de clientes).
3. **Anexa a escala própria do dia** (.xlsx com cor — ver §4).
4. Opcionalmente **anexa a escala de terceiros** (.xlsx).
5. Aperta **Roteirizar**.
6. Vê o resultado no **mapa + lista**: cada rota com placa → clientes → sequência.
7. Laça no Lincros ao lado, na ordem que a plataforma indicou.

---

## 2. AS 3 ONDAS (ordem de execução — como o analista faz)

O motor monta as rotas nesta ordem exata:

1. **ONDA 1 — VAREJO** (primeiro): desenha as rotas base por proximidade. É a espinha dorsal.
2. **ONDA 2 — PARTICULARIDADES**: encaixa nas rotas de varejo já desenhadas. Algumas são
   particularidade por restrição de veículo e por isso saem no varejo.
3. **ONDA 3 — REDE** (por último): as pesadas e lentas (~110 min de atendimento cada).

---

## 3. REGRAS DE NEGÓCIO (todas confirmadas pelo Cleyton)

### 3.1 Identificação de tipo de cliente
- **REDE** = tipo do cadastro contém "REDE" **OU** razão social contém palavra-chave de
  rede (dupla fonte).
- **Mapa de nomes na razão social:**
  - `SENDAS` = bandeira **Assaí**
  - `WMS SUPERMERCADOS` = bandeira **Atacadão**
  - `CIA BRASILEIRA` / `COMPANHIA BRASILEIRA` = **"Companhia"**
- **DISTRIBUIDOR** (tipo no POS) → tratamento especial (ver 3.7).
- **PARTICULARIDADES** = tipo do cadastro.
- Resto = **VAREJO**.

### 3.2 Divisão de setor em rotas (o coração do espelho)
- O número de rotas de cada setor vem do **DESENHO DO HISTÓRICO**: quantas rotas aquele
  setor teve, e quantos clientes cada, no **mesmo dia da semana das 4 semanas anteriores**.
- **NÃO dividir por jornada de 10h.** O equilíbrio entre equipes já está no histórico.
  Jornada 10h e capacidade viram só **ALERTA (🟠)**, nunca corte automático.
- O nº de rotas do histórico é o **TETO TOTAL do setor** (rede + varejo + particularidade
  juntos), não um orçamento só de varejo. As ondas dividem esse teto total. Só estoura se o
  peso realmente obrigar (excedente vira terceiro).
- Agrupar por **região/setor (Nome Rota)**, NÃO por "Número da Rota". O número (1,3,4…) é
  controle interno do CD, sem relação com a lógica — **desconsiderar**.
- Clientes agrupados dentro do setor por **proximidade geográfica** (clusters).

### 3.3 Janela de molde (deslizante)
- Para roteirizar o dia D (ex.: uma quarta), usar as **4 ocorrências anteriores do mesmo
  dia da semana** (as 4 quartas antes de D). NUNCA usar o próprio dia D (na vida real não
  se tem o gabarito do próprio dia).
- Cliente é "fixo" de um setor se aparece em **≥2 das 4 semanas**. Abaixo disso é esporádico.
- Cliente novo (não está em nenhum molde): encaixa na rota do **setor geograficamente mais
  próximo** (nunca fica sem alocação, nunca vira lista separada).

### 3.4 Regras de REDE (Onda 3)
- **Rede "pequena"** = pedido **≤ 150 kg**.
- **Máx 4 redes no mesmo veículo**, e os 4 só se **2 forem pequenas (≤150kg)** — porque
  rede segura o caminhão ~110 min; exemplo real que cabe: 800kg + 350kg + 110kg + 50kg.
- **SENDAS+SENDAS ou WMS+WMS**: não juntar no mesmo veículo, **salvo se um estiver do lado
  do outro** (proximidade ≤ 0,5 km).
- **SENDAS+WMS**: evitar (arriscado de dar tempo). Caso conhecido: Mogi.
- **Companhia (CIA BRASILEIRA)**: pode sair na rota do VAREJO, estourando até **+9 clientes
  de varejo (ideal até +7)** — "fecha a carga".

### 3.5 Capacidade e porte de veículo
- **Peso manda** (não valor da nota — o valor pode entrar depois como refinamento). O peso
  da placa vem do cadastro/histórico. Capacidades oficiais:
  - VUC-21 → 1.000 kg · VUC-Terceiro → 600 kg · VUC-IVECO-Baú → 700 kg
  - 3/4-28 → 1.800 kg · 3/4-Menor → 1.400 kg · 3/4-712/Terceiro → 1.200 kg
  - Toco-Terceiro → 4.000 kg · Truck-Terceiro → 5.500 kg · Distribuidora → 3.000 kg
  - *(Peso registrado já é o proxy de volume: pão enche volume antes do peso.)*
- **VUC é o porte PREFERIDO** (menor circula melhor, faz mais entregas). Só sobe pra 3/4
  quando o peso da rota passa do VUC (~1000kg), OU por padrão de área/expertise da equipe
  (ex.: placa final 2417 é 3/4 fixo numa área difícil de São Miguel). **Exceções de área o
  motor detecta pelo histórico**, sem lista manual.
- **Capacidade é sobre o VEÍCULO, não sobre o cliente.** Qualquer parada/pedido (rede ou
  varejo) que passe da maior placa própria (~1800kg) vai em **terceiro TOCO (≤4000kg) ou
  TRUCK (≤5500kg)**, normalmente sozinho (o peso já enche). Varejo raramente atinge isso.

### 3.6 Ocupação mínima e balanceamento
- **Ocupação mínima = 40% do peso da placa** (vale VUC e 3/4): VUC → mín 400kg; 3/4 →
  mín 720kg. Rota abaixo disso é improdutiva → o motor **funde com a vizinha** do mesmo
  setor/onda, ou **puxa clientes de perto** (varejo comum ou rede pequena) para bater ocupação.
- **BALANCEAMENTO DE CARGA (regra nº 1, acima da jornada):** deixar o dia de trabalho das
  placas o mais parecido possível — MAS **só entre rotas VIZINHAS** (centros geográficos
  próximos, ~≤5km, mesma sub-região).
  - **NÃO comparar rota que vai longe da base com rota que fica perto** — a de longe é longa
    por natureza, não por desequilíbrio. Rota isolada da ponta não tem par e fica como está.
  - **Caminhão não invade a área do outro**: move só clientes de **FRONTEIRA** entre vizinhas.
  - **Métrica do equilíbrio** entre vizinhas = **peso + quantidade de clientes** (o tempo
    acompanha, pois entre vizinhas a distância se cancela).
  - **Margem aceitável ≈ 1h** de diferença.
  - Padrão geral: mais peso = menos clientes / menos peso = mais clientes.

### 3.7 Regras nominais e especiais
- **DISTRIBUIDOR** (tipo no POS): sempre vai FIXO na placa **FFW9E44 (9E44)**, independente
  de capacidade. Fora do fluxo normal.
- Regras do campo **Observação** (texto livre, motor interpreta):
  - Teto de porte ("só VUC", "não 3/4", "não truck")
  - "Última entrega" → força fim da sequência
  - "Demorado" → agrupa com Rede, não Varejo
  - "Só com Rede" → Rede only
  - "Não recebe terceiro" → exclui veículos terceiros
  - Janela em texto ("recebe até 10h") → usa a mais restritiva entre texto e cadastro

### 3.8 Sequência das paradas (dentro de cada rota)
1. **Janela de horário do cliente** (hard — sempre primeiro; rede tem janela apertada,
   grandes Sendas fecham ~11h, Davo ~10h → rede primeiro).
2. **Mais pesado primeiro** (abre o corredor do baú conforme entrega).
- *(Nota: "pedido grande primeiro" para ergonomia de descarga é ajuste fino MANUAL do
  analista — fora do motor.)*

---

## 4. A ESCALA (disponibilidade de frota) — leitura por COR

A escala própria chega em **Excel** (e-mail "disponibilidade panco"). O status de cada
placa é codificado pela **COR da linha** — por isso tem que entrar como **.xlsx** (CSV
perde a cor).

### Cores (hex confirmados no Excel real)
| Hex | Cor | Status | Ação |
|---|---|---|---|
| `FFFF0000` | Vermelho | Manutenção | ❌ FORA da frota |
| `FF92D050` | Verde | Sem equipe | ❌ FORA da frota |
| `FFD9E1F2` | Azul claro | (zebra do Excel) | ✅ Disponível |
| (sem cor) / branco | — | Disponível | ✅ Disponível |
| `FF808080` | Cinza | só cabeçalho | (ignora) |

**Regra:** só vermelho e verde tiram da frota. Azul claro é só listra zebrada, NÃO é status.
**Placa vermelha nunca entra, sem exceção** (se quebrou, aciona terceiro).

### Validação cruzada
As placas vermelhas batem com a tabela lateral **Fleetcom** (colunas 12-14: placa, rota,
nº OS). Verdes (sem equipe) não geram OS — só a cor sinaliza. O parser deve conferir
cor × Fleetcom e alertar se divergirem.

### Estrutura da planilha
- Cabeçalho na **linha 2**. Dados da linha 3 em diante.
- Colunas: PLACA(1), ROTA(2), TIPO VEÍCULO(3), TAG?(4), PESO MÁX KG(5), CIDADE/REGIÃO(6),
  HORÁRIO INÍCIO(7), MUDAR REGIÃO(8), PONTO APOIO(9), OBS(10).
- Tabela lateral Fleetcom: PLACA(12), ROTA(13), nº OS(14).
- **PESO MÁX (col 5)** às vezes vem com "R$" por erro de digitação — limpar: remover "R$",
  ponto de milhar, trocar vírgula por ponto.
- **MUDAR REGIÃO** (SIM/NÃO) = principal grau de liberdade do balanceamento.

### Extração de regras do texto (coluna CIDADE/OBS)
Detectar flags: `so_rede` ("não colocar varejo"/"somente rede"), `regiao_travada` ("não
alterar região"/"não tirar"), `prioridade_rede`, `coringa` ("apoio grandes redes"),
`perto_cd` ("próximo do CD"), `cesto` ("recolhe"/"cesto"), `sem_tag_restricao`.

---

## 5. HIERARQUIA DE ALOCAÇÃO DE FROTA (ordem obrigatória)

Para cada rota que o motor monta:
1. **1º — Placa PRÓPRIA da escala** (região/porte/peso compatíveis). Usar toda a frota
   própria primeiro (custo fixo já pago).
2. **2º — Placa TERCEIRA da escala** — só **quando acabar caminhão próprio**.
3. **3º — Placa FICTÍCIA (SUZ-0001, SUZ-0002…)** — último recurso, só se nem o terceiro da
   escala resolver. Sinaliza "faltou caminhão, precisa arrumar terceiro a mais".

---

## 6. FONTES DE DADOS

### Dados embutidos no build (fixos, atualizados de vez em quando)
- **Molde** (`dados/molde.json`): ocorrências históricas destiladas dos romaneios. Cada
  ocorrência = {data, dia-da-semana, setor/nome-rota, veículo, [clientes]}. Cobre ~6 meses
  (mar-ago 2026), 8.022 rotas Suzano, 3.501 clientes distintos. **Janeiro-fevereiro
  descartado** (período muito longo). Filtrado só CD Suzano.
- **Cadastro de clientes** (`dados/cadastros.json`): código → {lat, lng, tipo, janela
  início/fim, nome}. 100% com coordenada.
- **Cadastro de veículos**: capacidades oficiais por tipo (§3.5).

### Dados subidos pelo usuário (todo dia)
- **POS** (.xlsx/CSV): lista de clientes do dia. **Placas ignoradas** (100%). Formato
  romaneio: linha de rota começa com data DD/MM/YYYY HH:MM:SS; sub-cabeçalho começa com
  "Tipo"; parada começa com "Entrega". Campos de parada: Tipo(0), Sequência(1),
  CódCliente(2), Razão(3), TipoCliente(4), Bairro(5), Cidade(6), Endereço(7), Lat(8),
  Lng(9), … Pedido(14), Valor(15), QtdItens(16), Peso(17), Cubagem(18), … Obs(20).
  Deduplica por código somando peso. Ignora linhas "Refeicao"/"Coleta".
- **Escala própria** (.xlsx com cor) — §4. Obrigatória.
- **Escala terceiros** (.xlsx) — opcional.

### Parsing — quirks importantes
- Peso em formato BR: `30.000,00` → remover ponto, vírgula vira ponto → `30000`.
- CSVs têm BOM (`\ufeff`) e aspas — limpar headers.
- Endereços têm quebras internas — usar `csv.reader` no arquivo, não `splitlines()`.
- Coordenadas em formato BR (`-23,545708`) — vírgula é decimal.

### Calibração de distância (para estimativas)
- Distância rodoviária ≈ **2.0×** a distância em linha reta na área de Suzano (calibrado
  contra tempos reais: rotas reais têm ~6,2h em média, máx ~13h).
- Velocidade média urbana ≈ **32 km/h**.
- Tempo de atendimento: **Rede ~110 min, Particularidades ~40 min, Varejo ~16 min**.
- *(Produção: plugar OSRM/Google Distance Matrix para distância real de rua.)*

---

## 7. ESTADO DE VALIDAÇÃO (o que já foi testado)

- **PoC 27/08 (quinta):** 56 placas exatas do dia real, 65,5% clientes no veículo correto,
  ~96% cobertura com molde de 4 semanas. Cobertura regional estável; identidade de placa
  gira (por isso placa é sugestão, região é âncora).
- **Teste 26/08 (quarta):** 314 pedidos → 53-55 rotas. Motor com 3 ondas, balanceamento por
  vizinhança, ocupação 40%, hierarquia de frota. Aprovado visualmente no mapa pelo Cleyton
  ("ficou bom"). **A escala real NÃO foi usada nesse teste** (faltavam terceiros) — só o
  cérebro (agrupar/dividir/balancear) foi validado. Casar com placa real é o próximo passo.

---

## 8. FORA DE ESCOPO (decidido)

- Previsão de demanda / dimensionamento de terceiros pela prévia de vendas.
- "Pedido grande primeiro" (ergonomia de descarga) — ajuste fino manual.
- Substituir o Lincros.
- Valor da nota como limite (só peso por ora).

---

## 9. META FUTURA

- POC em Suzano → **19 CDs PANCO**, arquitetura "núcleo + perfil" (um codebase, 19 configs
  por base). Cada CD é uma config diferente do mesmo motor.
- Integração via API Lincros (`POST /embarque/roteirizado/criarSync`) para injetar a rota
  pronta sem laçar à mão. Schema completo em memória (`lincros-api-injecao-rota`).

---

## 10. CONTEXTO POLÍTICO (importante para o rumo)

- Lincros ofereceu o produto de IA deles (LAISA IA) como piloto pra PANCO (09/09/2026).
  Competição com este motor. Enquadrar internamente como "POC de conferência automatizada
  pra reduzir retrabalho" — não falar em "substituir Lincros/LAISA".
- Coordenador de logística sabe do projeto e apoia.
- Contato com Lincros vai pelo gestor do Cleyton — ele não fala direto com a Lincros.
