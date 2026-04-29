-- ============================================================
-- DIAGNÓSTICO E CORREÇÃO DE DUPLICATAS — v2
-- Schema legado: coluna 'data' (não 'data_compra')
-- Execute no SQL Editor do Supabase (https://app.supabase.com)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- PASSO 1: VER GRUPOS DUPLICADOS
-- Mostra todas as transações com mesma data + descrição
-- normalizada + valor, independentemente de hash ou responsável.
-- Revise o resultado antes de rodar qualquer DELETE.
-- ─────────────────────────────────────────────────────────────
SELECT
  data,
  lower(trim(descricao))                          AS descricao_norm,
  valor,
  COUNT(*)                                        AS total,
  array_agg(id          ORDER BY id ASC)          AS ids,
  array_agg(hash_linha  ORDER BY id ASC)          AS hashes,
  array_agg(responsavel ORDER BY id ASC)          AS responsaveis,
  array_agg(categoria_origem ORDER BY id ASC)     AS origens,
  array_agg(categoria   ORDER BY id ASC)          AS categorias
FROM transacoes_nubank
GROUP BY data, lower(trim(descricao)), valor
HAVING COUNT(*) > 1
ORDER BY total DESC, data DESC;


-- ─────────────────────────────────────────────────────────────
-- PASSO 2: CONTAR REGISTROS A REMOVER
-- ─────────────────────────────────────────────────────────────
SELECT
  COUNT(*)       AS grupos_duplicados,
  SUM(total - 1) AS registros_a_remover
FROM (
  SELECT COUNT(*) AS total
  FROM transacoes_nubank
  GROUP BY data, lower(trim(descricao)), valor
  HAVING COUNT(*) > 1
) sub;


-- ─────────────────────────────────────────────────────────────
-- PASSO 3: REMOVER DUPLICATAS
-- Mantém o MELHOR registro por grupo lógico.
-- Prioridade:
--   1. categoria_origem = 'MANUAL' antes de 'IA' antes de NULL
--   2. Com categoria preenchida antes de sem categoria
--   3. Registro mais antigo pelo id (UUID ordenado)
--
-- ATENÇÃO: revise o Passo 1 antes de executar este bloco.
-- ─────────────────────────────────────────────────────────────
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY data, lower(trim(descricao)), valor
      ORDER BY
        CASE categoria_origem
          WHEN 'MANUAL' THEN 1
          WHEN 'IA'     THEN 2
          ELSE               3
        END,
        CASE WHEN categoria IS NOT NULL THEN 1 ELSE 2 END,
        id ASC
    ) AS rn
  FROM transacoes_nubank
)
DELETE FROM transacoes_nubank
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);


-- ─────────────────────────────────────────────────────────────
-- PASSO 4: VERIFICAÇÃO PÓS-LIMPEZA
-- ─────────────────────────────────────────────────────────────
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 'OK — nenhuma duplicata lógica restante'
    ELSE 'ATENÇÃO — ' || COUNT(*) || ' grupo(s) ainda com duplicata'
  END AS resultado
FROM (
  SELECT data, lower(trim(descricao)), valor
  FROM transacoes_nubank
  GROUP BY data, lower(trim(descricao)), valor
  HAVING COUNT(*) > 1
) sub;


-- ─────────────────────────────────────────────────────────────
-- PASSO 5: GARANTIR O UNIQUE CONSTRAINT DE hash_linha
-- O upsert com onConflict:'hash_linha' depende desse constraint.
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transacoes_nubank_hash_linha_unique'
      AND conrelid = 'transacoes_nubank'::regclass
  ) THEN
    ALTER TABLE transacoes_nubank
      ADD CONSTRAINT transacoes_nubank_hash_linha_unique UNIQUE (hash_linha);
    RAISE NOTICE 'Constraint transacoes_nubank_hash_linha_unique criado com sucesso.';
  ELSE
    RAISE NOTICE 'Constraint transacoes_nubank_hash_linha_unique já existe.';
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────
-- PASSO 6 (OPCIONAL): RESETAR UM MÊS ESPECÍFICO E REIMPORTAR
-- Substitua '2026-04-01' pelo primeiro dia do mês desejado.
-- ─────────────────────────────────────────────────────────────
-- DELETE FROM transacoes_nubank
-- WHERE projeto_fatura = '2026-04-01';
