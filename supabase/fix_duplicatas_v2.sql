-- ============================================================
-- DIAGNÓSTICO E CORREÇÃO DE DUPLICATAS — v3
-- Schema legado: coluna 'data' (não 'data_compra')
-- created_at confirmado como timestamp without time zone
-- Execute no SQL Editor do Supabase (https://app.supabase.com)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- PASSO 1: VER GRUPOS DUPLICADOS (normalização máxima)
-- Usa regexp_replace para normalizar espaços internos também,
-- e round(valor,2) para absorver diferenças de precisão.
-- ─────────────────────────────────────────────────────────────
SELECT
  data,
  lower(trim(regexp_replace(descricao, '\s+', ' ', 'g'))) AS descricao_norm,
  round(valor::numeric, 2)                                AS valor_norm,
  COUNT(*)                                                AS total,
  array_agg(id          ORDER BY created_at ASC)         AS ids,
  array_agg(hash_linha  ORDER BY created_at ASC)         AS hashes,
  array_agg(responsavel ORDER BY created_at ASC)         AS responsaveis,
  array_agg(descricao   ORDER BY created_at ASC)         AS descricoes_raw,
  array_agg(categoria_origem ORDER BY created_at ASC)    AS origens,
  array_agg(categoria   ORDER BY created_at ASC)         AS categorias
FROM transacoes_nubank
GROUP BY data,
         lower(trim(regexp_replace(descricao, '\s+', ' ', 'g'))),
         round(valor::numeric, 2)
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
  GROUP BY data,
           lower(trim(regexp_replace(descricao, '\s+', ' ', 'g'))),
           round(valor::numeric, 2)
  HAVING COUNT(*) > 1
) sub;


-- ─────────────────────────────────────────────────────────────
-- PASSO 3: REMOVER DUPLICATAS
-- Mantém: MANUAL > IA > sem categoria; com categoria > sem; mais antigo.
-- ATENÇÃO: revise o Passo 1 antes de executar.
-- ─────────────────────────────────────────────────────────────
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY data,
                   lower(trim(regexp_replace(descricao, '\s+', ' ', 'g'))),
                   round(valor::numeric, 2)
      ORDER BY
        CASE categoria_origem
          WHEN 'MANUAL' THEN 1
          WHEN 'IA'     THEN 2
          ELSE               3
        END,
        CASE WHEN categoria IS NOT NULL THEN 1 ELSE 2 END,
        created_at ASC,
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
  SELECT data,
         lower(trim(regexp_replace(descricao, '\s+', ' ', 'g'))),
         round(valor::numeric, 2)
  FROM transacoes_nubank
  GROUP BY data,
           lower(trim(regexp_replace(descricao, '\s+', ' ', 'g'))),
           round(valor::numeric, 2)
  HAVING COUNT(*) > 1
) sub;


-- ─────────────────────────────────────────────────────────────
-- PASSO 5: REMOVER CONSTRAINT DUPLICADO DE hash_linha
-- O banco tem dois constraints UNIQUE em hash_linha.
-- Remove o redundante e mantém apenas um.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE transacoes_nubank
  DROP CONSTRAINT IF EXISTS transacoes_nubank_hash_linha_unique;


-- ─────────────────────────────────────────────────────────────
-- PASSO 6 (OPCIONAL): RESETAR UM MÊS ESPECÍFICO E REIMPORTAR
-- Substitua '2026-04-01' pelo primeiro dia do mês desejado.
-- ─────────────────────────────────────────────────────────────
-- DELETE FROM transacoes_nubank
-- WHERE projeto_fatura = '2026-04-01';
