-- ============================================================
-- Analytics: indexes, view, and RPC function
-- Execute in Supabase SQL Editor (once)
-- ============================================================

-- Required indexes for efficient range queries on data_compra
CREATE INDEX IF NOT EXISTS idx_transacoes_data_compra
  ON transacoes_nubank(data_compra);

CREATE INDEX IF NOT EXISTS idx_transacoes_data_compra_cat_resp
  ON transacoes_nubank(data_compra, categoria, responsavel);

-- ── View: v_analytics_mensal ─────────────────────────────────────────────────
-- Groups transactions by calendar month (data_compra), category and person.
-- Returns one row per (mes, categoria, responsavel) combination.
-- Queries filter by mes >= ? AND mes <= ? using the index above.
CREATE OR REPLACE VIEW v_analytics_mensal AS
SELECT
  date_trunc('month', data_compra)::date  AS mes,
  COALESCE(categoria, 'Outros')           AS categoria,
  COALESCE(responsavel, 'Desconhecido')   AS responsavel,
  SUM(valor)                              AS total_gasto,
  COUNT(*)::int                           AS contagem
FROM transacoes_nubank
WHERE data_compra IS NOT NULL
GROUP BY 1, 2, 3;

-- ── RPC: rpc_analytics_yoy ───────────────────────────────────────────────────
-- Year-over-Year comparison for two given years.
-- Returns month number (1-12) so the client can map to locale-safe labels.
-- Usage: SELECT * FROM rpc_analytics_yoy(2024, 2025)
CREATE OR REPLACE FUNCTION rpc_analytics_yoy(p_year_a INT, p_year_b INT)
RETURNS TABLE(mes_num INT, ano INT, total_gasto NUMERIC)
LANGUAGE sql
STABLE
AS $$
  SELECT
    EXTRACT(MONTH FROM data_compra)::INT  AS mes_num,
    EXTRACT(YEAR  FROM data_compra)::INT  AS ano,
    SUM(valor)                            AS total_gasto
  FROM transacoes_nubank
  WHERE
    data_compra IS NOT NULL
    AND EXTRACT(YEAR FROM data_compra) IN (p_year_a, p_year_b)
  GROUP BY 1, 2
  ORDER BY 2, 1
$$;
