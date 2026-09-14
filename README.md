# Motor-Espelho de Roteirização — PANCO CD Suzano

Plataforma web que automatiza a roteirização diária do CD Suzano, partindo do desenho das
rotas do mesmo dia da semana anterior (espelho) e atualizando para os pedidos reais do dia.
Roda **inteiramente no navegador** — sem servidor, sem banco.

> 📖 **Leia `ESPECIFICACAO.md` primeiro.** Ele contém todas as regras de negócio. É a fonte
> de verdade do projeto (inclusive para o Claude Code evoluir sem perder contexto).

## Como usar

1. Abra a plataforma (o link da Vercel, ou o `index.html` local).
2. Confirme a **data de entrega** (o motor usa as 4 semanas anteriores do mesmo dia).
3. Suba o **POS** (pedidos do dia — .xlsx/.csv exportado do Lincros; as placas são ignoradas).
4. Suba a **escala própria** do dia (.xlsx com cor — vermelho=manutenção, verde=sem equipe).
5. (Opcional) Suba a **escala de terceiros** (.xlsx).
6. Clique em **Roteirizar**.
7. Veja o resultado no mapa + lista. Clique numa rota para ver a sequência detalhada.
8. Laçe no Lincros ao lado, na ordem indicada.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Interface (uploads, mapa, lista) |
| `app.js` | Liga uploads → parsers → motor → tela |
| `motor.js` | O motor-espelho (3 ondas, balanceamento, hierarquia de frota) |
| `parsers.js` | Leitura do POS (romaneio) e da escala (com cor, capacidade por tipo) |
| `dados.js` | Molde histórico (4+ semanas) + cadastro de clientes + setores — embutido |
| `xlsx.full.min.js` | SheetJS (lê Excel no navegador) — embutido, sem CDN |
| `ESPECIFICACAO.md` | **Todas as regras de negócio** |

## Deploy na Vercel

O projeto é estático puro (HTML/JS). Não precisa build.

**Opção 1 — via GitHub (recomendado):** conecte este repositório na Vercel. A cada `git
push`, a Vercel publica automaticamente. Framework: **Other / None**. Sem build command.

**Opção 2 — arrastar a pasta** no painel da Vercel (deploy manual).

## Atualizar o molde (quando quiser que a plataforma "aprenda")

O molde em `dados.js` foi destilado dos romaneios de mar–ago/2026. Para atualizá-lo com
dados mais novos, rode o destilador (ver `ESPECIFICACAO.md` §6) sobre os romaneios recentes
e regenere `dados.js`. É manual, ~1×/semana, leva minutos.

## Estado atual

- ✅ Motor validado (PoC 65,5% placa correta, ~96% cobertura com 4 semanas).
- ✅ Plataforma funcional client-side testada de ponta a ponta.
- ⏳ Integração via API Lincros (injeção de rota pronta) — fase futura.
- ⏳ Distância real de rua (OSRM) — hoje usa estimativa calibrada.

## Notas técnicas

- A coluna de "peso" na escala é **valor da nota** — a capacidade vem do **tipo** do veículo
  (tabela em `parsers.js`, derivada do histórico real).
- Coordenadas e pesos do POS: o parser respeita formato BR e número nativo do Excel.
- Sem dependências externas em runtime (SheetJS embutido) — funciona offline.
