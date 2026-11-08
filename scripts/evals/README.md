# Qualidade do Fin

Duas camadas, para usos diferentes:

| | `npm test` | `npm run evals` |
|---|---|---|
| O que testa | O código em volta da IA: loop, checagem de origem dos valores, operações, ferramentas, prompt | O comportamento do modelo de verdade, com os dados reais |
| Modelo | Gemini simulado (respostas roteirizadas) | `gemini-3.8-flash` (ou `GEMINI_MODEL_CHAT`) |
| Banco | Supabase em memória | Supabase real, **só leitura** (operações vão para memória) |
| Custo / tempo | grátis, ~2 s | chamadas pagas ao Gemini, ~2–4 min |
| Quando | a cada mudança (roda no CI) | antes de mudar prompt, modelo ou ferramentas, e periodicamente |

## Rodar as avaliações

```bash
vercel env pull .env.local          # GEMINI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
node --env-file=.env.local node_modules/.bin/tsx scripts/evals/rodar.ts
node --env-file=.env.local node_modules/.bin/tsx scripts/evals/rodar.ts --categoria lastro --repetir 3
GEMINI_MODEL_CHAT=gemini-2.5-flash node --env-file=.env.local node_modules/.bin/tsx scripts/evals/rodar.ts   # comparar modelos
```

Opções: `--so id1,id2`, `--categoria <lastro|recorte|analise|tempo|operacao|conversa|escopo|formato>`,
`--repetir N` (mede consistência — o modelo não é determinístico), `--minimo 0.9` (exit 1 abaixo disso).
O relatório detalhado fica em `scripts/evals/resultados/` (fora do git).

## Categorização das compras

```bash
node --env-file=.env.local node_modules/.bin/tsx scripts/evals/categorias.ts               # acerto + simulação dos "Outros"
node --env-file=.env.local node_modules/.bin/tsx scripts/evals/categorias.ts --so acerto --amostra 200
```

- **acerto**: re-categoriza compras que o casal rotulou à mão, sem a memória daquele estabelecimento
  (deixa-um-de-fora), e mede o acerto por fonte (parcela, memória, regra, IA) e quantas iriam para "Outros".
- **outros**: mostra para onde iriam as compras hoje em "Outros" (não manuais). Nada é gravado.

Os testes automáticos ficam em `lib/categorizacao/*.test.ts` (rodam no `npm test`).

## Ciclo de melhoria

1. Usuário marca 👎 numa resposta (e diz o que estava errado).
2. `npm run evals:negativos` gera rascunhos de cenário com a pergunta, o histórico e a resposta ruim.
3. Confira no banco qual seria a resposta certa, preencha `espera` e mova o caso para `casos.ts`.
4. Ajuste prompt/ferramentas até o caso passar sem quebrar os outros (`npm run evals`).

Cada resposta gravada tem em `messages.meta` o modelo, tokens, tempo, revisões automáticas e os
valores sem origem; em `messages.ferramentas`, cada consulta com argumentos **e resultado**.
