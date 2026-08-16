-- Migra as linhas de planejamento do cartão principal para o prefixo [PRINCIPAL].
-- Execute no SQL Editor do Supabase: https://app.supabase.com
--
-- Antes, a fatura do cartão principal era identificada pelos nomes literais
-- "NuBank Matheus", "NuBank Jeniffer", "NuBank Jeniffer Conjunto" e "NuBank Conjunto",
-- hardcoded em vários arquivos. Agora ela usa o mesmo mecanismo de prefixo dos cartões
-- extras ([CARTAO1]/[CARTAO2]), e o responsável passa a ficar na coluna `responsavel`
-- em vez de embutido no nome.
--
-- O script é idempotente: rodar duas vezes não muda nada na segunda vez.

-- ── Confira antes de aplicar: estas são as linhas que serão renomeadas ──
--
-- SELECT id, mes_referencia, item, responsavel, valor_previsto
-- FROM planejamento
-- WHERE item ILIKE 'nubank %' AND item NOT LIKE '[PRINCIPAL]%'
-- ORDER BY mes_referencia DESC, item;

BEGIN;

-- 1. 'Conjunto' passa a ser um responsável válido no planejamento (já era em
--    transacoes_nubank — ver migration_responsavel_conjunto.sql). O DROP com
--    IF EXISTS cobre tanto a base que tem a constraint quanto a que não tem.
ALTER TABLE planejamento
  DROP CONSTRAINT IF EXISTS planejamento_responsavel_check;

ALTER TABLE planejamento
  ADD CONSTRAINT planejamento_responsavel_check
  CHECK (responsavel IN ('Matheus', 'Jeniffer', 'Conjunto'));

-- 2. Backfill do responsável ANTES do rename, enquanto o nome antigo ainda carrega
--    essa informação. "NuBank Conjunto" e "NuBank Jeniffer Conjunto" quitam a fatura
--    das compras lançadas com responsavel='Conjunto'.
--
--    ⚠️ ESTE É O ÚNICO PASSO QUE MUDA NÚMEROS NA TELA. Hoje o previsto de
--    "NuBank Jeniffer Conjunto" é somado ao bloco da Jeniffer no Dashboard; com
--    responsavel='Conjunto' ele passa para o bloco do Conjunto. O total da fatura
--    não muda — só a divisão entre os blocos.
--
--    Se preferir manter esse item sob a Jeniffer, troque o filtro por
--    `item ILIKE 'nubank conjunto'` (só o item que já era exclusivamente conjunto).
UPDATE planejamento
SET responsavel = 'Conjunto'
WHERE item ILIKE 'nubank %'
  AND item ILIKE '%conjunto%'
  AND responsavel IS DISTINCT FROM 'Conjunto';

-- 3. "NuBank Matheus" → "[PRINCIPAL] Matheus". O nome que sobra é apenas rótulo;
--    quem determina as transações somadas é a coluna `responsavel`.
UPDATE planejamento
SET item = '[PRINCIPAL] ' || btrim(substring(item from 7))
WHERE item ILIKE 'nubank %'
  AND item NOT LIKE '[PRINCIPAL]%'
  AND btrim(substring(item from 7)) <> '';

COMMIT;

-- ── Reversão, se necessário ──
--
-- UPDATE planejamento
-- SET item = 'NuBank ' || btrim(substring(item from 13))
-- WHERE item LIKE '[PRINCIPAL] %';
