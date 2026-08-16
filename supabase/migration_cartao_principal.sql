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

-- ─────────────────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO (rode antes, separado — só leitura)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. Quais linhas serão renomeadas:
--
-- SELECT id, mes_referencia, item, responsavel, valor_previsto
-- FROM planejamento
-- WHERE item ILIKE 'nubank %' AND item NOT LIKE '[PRINCIPAL]%'
-- ORDER BY mes_referencia DESC, item;
--
-- 2. Quais constraints hoje travam o valor de `responsavel` (é o que causa o
--    "erro de constraint" ao gravar Conjunto). Esperado: um CHECK e, possivelmente,
--    uma FOREIGN KEY para uma tabela de domínio que só tem Matheus e Jeniffer:
--
-- SELECT conname, contype, pg_get_constraintdef(oid) AS definicao
-- FROM pg_constraint
-- WHERE conrelid = 'planejamento'::regclass
--   AND pg_get_constraintdef(oid) ILIKE '%responsavel%';

BEGIN;

-- 1. Libera o valor 'Conjunto' na coluna `responsavel`.
--
--    A tabela `planejamento` é anterior às migrações deste repo e usa DUAS
--    constraints por coluna. Em migrations.sql (:151-152), para liberar `categoria`
--    foi preciso derrubar o CHECK **e** a FOREIGN KEY:
--
--      ALTER TABLE planejamento DROP CONSTRAINT IF EXISTS planejamento_categoria_check;
--      ALTER TABLE planejamento DROP CONSTRAINT IF EXISTS planejamento_categoria_fkey;
--
--    `responsavel` segue o mesmo padrão. Derrubar só o CHECK deixa a FK barrando o
--    UPDATE do passo 2 — e, como tudo está numa transação, a migração inteira faz
--    rollback sem deixar rastro. Era exatamente esse o erro.
ALTER TABLE planejamento DROP CONSTRAINT IF EXISTS planejamento_responsavel_check;
ALTER TABLE planejamento DROP CONSTRAINT IF EXISTS planejamento_responsavel_fkey;

-- Rede de segurança: se as constraints tiverem outro nome nesta base, derruba
-- qualquer uma que mencione `responsavel`, seja CHECK ou FK.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'planejamento'::regclass
      AND contype IN ('c', 'f')
      AND pg_get_constraintdef(oid) ILIKE '%responsavel%'
  LOOP
    EXECUTE format('ALTER TABLE planejamento DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Constraint removida: %', c.conname;
  END LOOP;
END $$;

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

-- 4. Recria o CHECK com os três valores — só se os dados já estiverem no domínio,
--    para a migração não falhar por causa de alguma linha antiga inesperada.
DO $$
DECLARE invalidos int;
BEGIN
  SELECT count(*) INTO invalidos
  FROM planejamento
  WHERE responsavel IS NOT NULL
    AND responsavel NOT IN ('Matheus', 'Jeniffer', 'Conjunto');

  IF invalidos = 0 THEN
    ALTER TABLE planejamento
      ADD CONSTRAINT planejamento_responsavel_check
      CHECK (responsavel IN ('Matheus', 'Jeniffer', 'Conjunto'));
  ELSE
    RAISE NOTICE 'CHECK não recriado: % linha(s) com responsavel fora do domínio', invalidos;
  END IF;
END $$;

COMMIT;

-- ── Conferência depois: deve retornar 0 ──
--
-- SELECT count(*) FROM planejamento WHERE item ILIKE 'nubank %';

-- ── Reversão do rename, se necessário ──
--    (não desfaz o passo 2 — o responsavel='Conjunto' permanece)
--
-- UPDATE planejamento
-- SET item = 'NuBank ' || btrim(substring(item from 13))
-- WHERE item LIKE '[PRINCIPAL] %';
