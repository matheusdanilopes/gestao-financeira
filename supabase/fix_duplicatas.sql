-- ============================================================
-- DIAGNÓSTICO E CORREÇÃO DE TRANSAÇÕES DUPLICADAS
-- Roda no Supabase → SQL Editor
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- PASSO 1: VER OS PARES DUPLICADOS
-- Mesma data + valor + projeto_fatura, descrição normalizada
-- igual, mas responsável diferente.
-- Revise o resultado antes de rodar qualquer DELETE.
-- ─────────────────────────────────────────────────────────────
WITH normalizado AS (
  SELECT
    id,
    data_compra,
    descricao,
    valor,
    responsavel,
    projeto_fatura,
    lower(
      regexp_replace(
        regexp_replace(descricao, '\s*-\s*parcela\s+\d+/\d+.*', '', 'gi'),
        '\s*-?\s*jeniffer\s*', '', 'gi'
      )
    ) AS desc_norm
  FROM transacoes_nubank
)
SELECT
  a.id              AS id_a,
  a.responsavel     AS responsavel_a,
  a.descricao       AS descricao_a,
  b.id              AS id_b,
  b.responsavel     AS responsavel_b,
  b.descricao       AS descricao_b,
  a.valor,
  a.data_compra,
  a.projeto_fatura
FROM normalizado a
JOIN normalizado b
  ON  a.data_compra    = b.data_compra
  AND a.valor          = b.valor
  AND a.projeto_fatura = b.projeto_fatura
  AND a.desc_norm      = b.desc_norm
  AND a.responsavel   <> b.responsavel
  AND a.id < b.id
ORDER BY a.projeto_fatura DESC, a.valor DESC;


-- ─────────────────────────────────────────────────────────────
-- PASSO 2: CONTAR QUANTAS DUPLICATAS EXISTEM
-- ─────────────────────────────────────────────────────────────
WITH normalizado AS (
  SELECT
    id,
    data_compra, valor, responsavel, projeto_fatura,
    lower(
      regexp_replace(
        regexp_replace(descricao, '\s*-\s*parcela\s+\d+/\d+.*', '', 'gi'),
        '\s*-?\s*jeniffer\s*', '', 'gi'
      )
    ) AS desc_norm
  FROM transacoes_nubank
)
SELECT COUNT(*) AS total_pares_duplicados
FROM normalizado a
JOIN normalizado b
  ON  a.data_compra    = b.data_compra
  AND a.valor          = b.valor
  AND a.projeto_fatura = b.projeto_fatura
  AND a.desc_norm      = b.desc_norm
  AND a.responsavel   <> b.responsavel
  AND a.id < b.id;


-- ─────────────────────────────────────────────────────────────
-- PASSO 3: APAGAR DUPLICATAS
-- Mantém a linha com menor id (mais antiga / "original").
-- A linha com maior id (duplicata) é deletada.
--
-- ATENÇÃO: revise o Passo 1 antes de executar este bloco.
-- ─────────────────────────────────────────────────────────────
DELETE FROM transacoes_nubank
WHERE id IN (
  SELECT b.id
  FROM (
    SELECT id, data_compra, valor, projeto_fatura,
      lower(
        regexp_replace(
          regexp_replace(descricao, '\s*-\s*parcela\s+\d+/\d+.*', '', 'gi'),
          '\s*-?\s*jeniffer\s*', '', 'gi'
        )
      ) AS desc_norm
    FROM transacoes_nubank
  ) a
  JOIN (
    SELECT id, data_compra, valor, projeto_fatura, responsavel,
      lower(
        regexp_replace(
          regexp_replace(descricao, '\s*-\s*parcela\s+\d+/\d+.*', '', 'gi'),
          '\s*-?\s*jeniffer\s*', '', 'gi'
        )
      ) AS desc_norm
    FROM transacoes_nubank
  ) b
    ON  a.data_compra    = b.data_compra
    AND a.valor          = b.valor
    AND a.projeto_fatura = b.projeto_fatura
    AND a.desc_norm      = b.desc_norm
    AND a.id < b.id
);


-- ─────────────────────────────────────────────────────────────
-- PASSO 4 (OPCIONAL): RESETAR UM MÊS ESPECÍFICO MANUALMENTE
-- Use se quiser apagar tudo de uma fatura e reimportar o CSV.
-- Substitua '2026-04-01' pela data do primeiro dia do mês.
-- ─────────────────────────────────────────────────────────────
-- DELETE FROM transacoes_nubank
-- WHERE projeto_fatura = '2026-04-01';


-- ─────────────────────────────────────────────────────────────
-- SEÇÃO B: DUPLICATAS POR HASH DIVERGENTE (mesma transação,
-- hash_linha diferente por normalização de valor)
--
-- Causa: antes da correção do toFixed(2), importar via API JSON
-- com amount:150 (número) e via CSV com "150.00" (string) gerava
-- hash_linhas distintos para a mesma compra, criando duas linhas
-- com data_compra + descricao + valor idênticos.
--
-- Execute B1 para inspecionar, B2 para remover.
-- ─────────────────────────────────────────────────────────────

-- B1: relatório — transações com mesmo (data_compra, descricao, valor)
-- e mais de um hash_linha
SELECT
  data_compra,
  descricao,
  valor,
  COUNT(*)                    AS total,
  array_agg(hash_linha)       AS hashes,
  array_agg(categoria_origem) AS origens,
  array_agg(categoria)        AS categorias
FROM transacoes_nubank
GROUP BY data_compra, descricao, valor
HAVING COUNT(*) > 1
ORDER BY total DESC, data_compra DESC;


-- B2: remoção — mantém o melhor registro por grupo lógico
-- Prioridade: MANUAL > IA > sem categoria; desempate pelo hash DESC
WITH ranked AS (
  SELECT
    hash_linha,
    ROW_NUMBER() OVER (
      PARTITION BY data_compra, descricao, valor
      ORDER BY
        CASE categoria_origem
          WHEN 'MANUAL' THEN 1
          WHEN 'IA'     THEN 2
          ELSE               3
        END,
        CASE WHEN categoria IS NOT NULL THEN 1 ELSE 2 END,
        hash_linha DESC
    ) AS rn
  FROM transacoes_nubank
)
DELETE FROM transacoes_nubank
WHERE hash_linha IN (
  SELECT hash_linha FROM ranked WHERE rn > 1
);


-- B3: verificação — confirma que não restam duplicatas lógicas
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 'OK — nenhuma duplicata restante'
    ELSE 'ATENÇÃO — ' || COUNT(*) || ' grupo(s) ainda com duplicata'
  END AS resultado
FROM (
  SELECT data_compra, descricao, valor
  FROM transacoes_nubank
  GROUP BY data_compra, descricao, valor
  HAVING COUNT(*) > 1
) sub;
