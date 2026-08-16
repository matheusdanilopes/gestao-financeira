-- Marca as linhas "NuBank Conjunto" do planejamento com responsavel = 'Conjunto',
-- em TODOS os meses. Execute no SQL Editor do Supabase: https://app.supabase.com
--
-- Contexto: o responsável do cartão adicional vivia embutido no nome do item
-- ("NuBank Conjunto"), porque a coluna `responsavel` não aceitava 'Conjunto'.
-- Agora o Dashboard monta um bloco por despesa e usa a coluna para saber quais
-- transações somar, então a informação precisa sair do nome e ir para a coluna.
--
-- Idempotente: rodar duas vezes não muda nada na segunda vez.
-- Independente da migration_cartao_principal.sql — pode rodar antes ou depois,
-- porque casa tanto o nome antigo ("NuBank Conjunto") quanto o novo
-- ("[PRINCIPAL] Conjunto").

-- ─────────────────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO — rode antes, separado (só leitura)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. Linhas que SERÃO alteradas:
--
-- SELECT id, mes_referencia, item, responsavel, valor_previsto
-- FROM planejamento
-- WHERE item ~* '^(NuBank|\[PRINCIPAL\])\s+conjunto\s*$'
-- ORDER BY mes_referencia DESC;
--
-- 2. Constraints que hoje travam o valor de `responsavel` (é o que causa o erro
--    ao gravar 'Conjunto'):
--
-- SELECT conname, contype, pg_get_constraintdef(oid) AS definicao
-- FROM pg_constraint
-- WHERE conrelid = 'planejamento'::regclass
--   AND pg_get_constraintdef(oid) ILIKE '%responsavel%';

BEGIN;

-- 1. Libera 'Conjunto' na coluna. A tabela `planejamento` é anterior às migrações
--    deste repo e usa CHECK **e** FOREIGN KEY por coluna — ver migrations.sql
--    (:151-152), onde liberar `categoria` exigiu derrubar as duas. Derrubar só o
--    CHECK deixa a FK barrando o UPDATE abaixo, e a transação inteira faz rollback.
ALTER TABLE planejamento DROP CONSTRAINT IF EXISTS planejamento_responsavel_check;
ALTER TABLE planejamento DROP CONSTRAINT IF EXISTS planejamento_responsavel_fkey;

-- Rede de segurança: se as constraints tiverem outro nome nesta base, derruba
-- qualquer CHECK ou FK que mencione `responsavel`.
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

-- 2. O UPDATE. Exige o prefixo ("NuBank " ou "[PRINCIPAL] ") seguido de exatamente
--    "Conjunto", então:
--      • "NuBank Jeniffer Conjunto" NÃO é afetado (ver bloco opcional no fim);
--      • uma despesa comum chamada só "Conjunto" também não é;
--      • variações de caixa e espaço extra ("nubank  conjunto") são cobertas.
UPDATE planejamento
SET responsavel = 'Conjunto'
WHERE item ~* '^(NuBank|\[PRINCIPAL\])\s+conjunto\s*$'
  AND responsavel IS DISTINCT FROM 'Conjunto';

-- 3. Recria o CHECK com os três valores, se os dados estiverem no domínio.
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

-- ── Conferência depois: todas devem estar com responsavel = 'Conjunto' ──
--
-- SELECT mes_referencia, item, responsavel
-- FROM planejamento
-- WHERE item ~* '^(NuBank|\[PRINCIPAL\])\s+conjunto\s*$'
-- ORDER BY mes_referencia DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- OPCIONAL — "NuBank Jeniffer Conjunto"
-- ─────────────────────────────────────────────────────────────────────────────
-- Este item NÃO é alterado acima, de propósito: hoje o previsto dele soma no bloco
-- da Jeniffer, e movê-lo para Conjunto muda a divisão entre os blocos do Dashboard
-- (o total da fatura continua igual). Se quiser movê-lo também, rode:
--
-- UPDATE planejamento
-- SET responsavel = 'Conjunto'
-- WHERE item ILIKE '%conjunto'
--   AND responsavel IS DISTINCT FROM 'Conjunto';
