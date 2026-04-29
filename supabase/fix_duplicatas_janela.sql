-- ============================================================
-- CORREÇÃO DE DUPLICATAS POR DESLOCAMENTO DE DATA (±3 DIAS)
-- Para dados importados antes da lógica de reconciliação por janela.
-- Execute no SQL Editor do Supabase (https://app.supabase.com)
-- ============================================================
--
-- Contexto: o Nubank às vezes altera a data de processamento de uma
-- transação entre exportações diferentes de CSV. Antes da nova lógica
-- (que usa janela de ±3 dias), isso gerava duas linhas com o mesmo
-- descricao+valor mas datas divergindo 1 a 3 dias — cada uma com um
-- hash_linha distinto, passando pela deduplicação antiga sem ser barrada.
--
-- Este script identifica e remove esses registros extras, mantendo
-- sempre o registro mais informativo de cada par.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- ÍNDICE OPCIONAL (acelera as queries abaixo se a tabela for grande)
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_transacoes_dedup_janela
  ON transacoes_nubank (descricao, valor, data_compra);


-- ─────────────────────────────────────────────────────────────
-- PASSO 1: DIAGNÓSTICO — todos os pares com deslocamento de 1 a 3 dias
-- Revise antes de executar qualquer DELETE.
-- ─────────────────────────────────────────────────────────────
SELECT
  a.descricao,
  a.valor,
  a.data_compra                           AS data_antiga,
  b.data_compra                           AS data_nova,
  (b.data_compra - a.data_compra)::int    AS dias_diferenca,
  a.projeto_fatura                        AS fatura_a,
  b.projeto_fatura                        AS fatura_b,
  CASE WHEN a.projeto_fatura = b.projeto_fatura
       THEN 'mesma fatura' ELSE 'faturas diferentes' END AS situacao,
  a.categoria_origem                      AS origem_a,
  b.categoria_origem                      AS origem_b,
  a.categoria                             AS categoria_a,
  b.categoria                             AS categoria_b,
  a.id                                    AS id_a,
  b.id                                    AS id_b
FROM transacoes_nubank a
JOIN transacoes_nubank b
  ON  a.descricao   = b.descricao
  AND a.valor       = b.valor
  AND b.data_compra > a.data_compra
  AND (b.data_compra - a.data_compra) <= 3
  AND a.id < b.id
ORDER BY a.projeto_fatura DESC, a.descricao, a.data_compra;


-- ─────────────────────────────────────────────────────────────
-- PASSO 2: RESUMO — quantos pares e sua distribuição
-- ─────────────────────────────────────────────────────────────
SELECT
  COUNT(*)  AS total_pares,
  COUNT(*) FILTER (WHERE a.projeto_fatura = b.projeto_fatura)  AS mesma_fatura,
  COUNT(*) FILTER (WHERE a.projeto_fatura <> b.projeto_fatura) AS faturas_distintas
FROM transacoes_nubank a
JOIN transacoes_nubank b
  ON  a.descricao   = b.descricao
  AND a.valor       = b.valor
  AND b.data_compra > a.data_compra
  AND (b.data_compra - a.data_compra) <= 3
  AND a.id < b.id;


-- ─────────────────────────────────────────────────────────────
-- PASSO 3A: LIMPEZA CONSERVADORA — apenas pares na MESMA fatura
--
-- Um deslocamento de data dentro do mesmo ciclo de cobrança é quase
-- sempre sinal de que é a mesma compra reimportada com data diferente.
--
-- Critério de qual registro MANTER (por ordem de prioridade):
--   1. categoria_origem = 'MANUAL'  (editado pelo usuário — mais valioso)
--   2. categoria IS NOT NULL         (categorizado pela IA)
--   3. data_compra mais recente      (data corrigida pelo Nubank na última exportação)
--   4. id mais recente como desempate final
--
-- O registro que NÃO for mantido (inferior em todos os critérios) é excluído.
--
-- ATENÇÃO: revise o Passo 1 antes de executar este bloco.
-- ─────────────────────────────────────────────────────────────
WITH pares AS (
  SELECT
    a.id AS id_a,
    b.id AS id_b,
    -- Determina qual id excluir com base nos critérios de qualidade
    CASE
      WHEN a.categoria_origem = 'MANUAL' AND b.categoria_origem != 'MANUAL' THEN b.id
      WHEN b.categoria_origem = 'MANUAL' AND a.categoria_origem != 'MANUAL' THEN a.id
      WHEN a.categoria IS NOT NULL        AND b.categoria IS NULL            THEN b.id
      WHEN b.categoria IS NOT NULL        AND a.categoria IS NULL            THEN a.id
      ELSE a.id  -- empate: exclui a (data mais antiga), mantém b (data mais recente)
    END AS id_excluir
  FROM transacoes_nubank a
  JOIN transacoes_nubank b
    ON  a.descricao      = b.descricao
    AND a.valor          = b.valor
    AND b.data_compra    > a.data_compra
    AND (b.data_compra - a.data_compra) <= 3
    AND a.projeto_fatura = b.projeto_fatura   -- <<< conservador: mesma fatura
    AND a.id < b.id
)
DELETE FROM transacoes_nubank
WHERE id IN (SELECT id_excluir FROM pares);


-- ─────────────────────────────────────────────────────────────
-- PASSO 4: VERIFICAÇÃO PÓS-LIMPEZA (mesma fatura)
-- ─────────────────────────────────────────────────────────────
SELECT
  CASE
    WHEN COUNT(*) = 0
    THEN 'OK — nenhum par próximo na mesma fatura'
    ELSE 'ATENÇÃO — ' || COUNT(*) || ' par(es) ainda na mesma fatura'
  END AS resultado
FROM transacoes_nubank a
JOIN transacoes_nubank b
  ON  a.descricao      = b.descricao
  AND a.valor          = b.valor
  AND b.data_compra    > a.data_compra
  AND (b.data_compra - a.data_compra) <= 3
  AND a.projeto_fatura = b.projeto_fatura
  AND a.id < b.id;


-- ─────────────────────────────────────────────────────────────
-- PASSO 3B (AVANÇADO): LIMPEZA DE PARES EM FATURAS DIFERENTES
--
-- Ocorre quando a data da compra cruza o fechamento da fatura entre
-- dois CSVs exportados em momentos distintos (ex.: compra aparece
-- como 28/04 numa fatura e 01/05 noutra). Isso afeta os totais por
-- fatura, então revise com atenção.
--
-- Após executar este passo, os totais das faturas afetadas mudaram.
-- Reimporte o CSV correto (o mais recente) para cada fatura para
-- garantir que os valores estão atualizados.
--
-- ATENÇÃO: execute o Passo 3A primeiro e só depois este bloco.
-- ─────────────────────────────────────────────────────────────
WITH pares AS (
  SELECT
    a.id AS id_a,
    b.id AS id_b,
    CASE
      WHEN a.categoria_origem = 'MANUAL' AND b.categoria_origem != 'MANUAL' THEN b.id
      WHEN b.categoria_origem = 'MANUAL' AND a.categoria_origem != 'MANUAL' THEN a.id
      WHEN a.categoria IS NOT NULL        AND b.categoria IS NULL            THEN b.id
      WHEN b.categoria IS NOT NULL        AND a.categoria IS NULL            THEN a.id
      ELSE a.id  -- empate: exclui a (data mais antiga)
    END AS id_excluir
  FROM transacoes_nubank a
  JOIN transacoes_nubank b
    ON  a.descricao       = b.descricao
    AND a.valor           = b.valor
    AND b.data_compra     > a.data_compra
    AND (b.data_compra - a.data_compra) <= 3
    AND a.projeto_fatura  <> b.projeto_fatura  -- <<< faturas diferentes
    AND a.id < b.id
)
DELETE FROM transacoes_nubank
WHERE id IN (SELECT id_excluir FROM pares);


-- ─────────────────────────────────────────────────────────────
-- PASSO 5: VERIFICAÇÃO FINAL
-- ─────────────────────────────────────────────────────────────
SELECT
  CASE
    WHEN COUNT(*) = 0
    THEN 'OK — nenhum par próximo (±3 dias) restante'
    ELSE 'ATENÇÃO — ' || COUNT(*) || ' par(es) ainda detectado(s)'
  END AS resultado
FROM transacoes_nubank a
JOIN transacoes_nubank b
  ON  a.descricao   = b.descricao
  AND a.valor       = b.valor
  AND b.data_compra > a.data_compra
  AND (b.data_compra - a.data_compra) <= 3
  AND a.id < b.id;


-- ─────────────────────────────────────────────────────────────
-- PASSO 6 (OPCIONAL): RESETAR UMA FATURA E REIMPORTAR
-- Use se preferir apagar tudo de um mês e importar o CSV correto.
-- Substitua '2026-04-01' pelo primeiro dia da fatura desejada.
-- ─────────────────────────────────────────────────────────────
-- DELETE FROM transacoes_nubank
-- WHERE projeto_fatura = '2026-04-01';
