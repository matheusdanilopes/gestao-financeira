-- ============================================================
-- Analytics: indexes, view, and RPC function
-- Uses column "data" (compatible with instances without data_compra)
-- Execute in Supabase SQL Editor (once)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_transacoes_data
  ON transacoes_nubank(data);

CREATE INDEX IF NOT EXISTS idx_transacoes_data_cat_resp
  ON transacoes_nubank(data, categoria, responsavel);

-- ── View: v_analytics_mensal ─────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_analytics_mensal AS
SELECT
  date_trunc('month', data)::date         AS mes,
  COALESCE(categoria, 'Outros')           AS categoria,
  COALESCE(responsavel, 'Desconhecido')   AS responsavel,
  SUM(valor)                              AS total_gasto,
  COUNT(*)::int                           AS contagem
FROM transacoes_nubank
WHERE data IS NOT NULL
GROUP BY 1, 2, 3;

-- ── RPC: rpc_analytics_yoy ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION rpc_analytics_yoy(p_year_a INT, p_year_b INT)
RETURNS TABLE(mes_num INT, ano INT, total_gasto NUMERIC)
LANGUAGE sql
STABLE
AS $$
  SELECT
    EXTRACT(MONTH FROM data)::INT  AS mes_num,
    EXTRACT(YEAR  FROM data)::INT  AS ano,
    SUM(valor)                     AS total_gasto
  FROM transacoes_nubank
  WHERE
    data IS NOT NULL
    AND EXTRACT(YEAR FROM data) IN (p_year_a, p_year_b)
  GROUP BY 1, 2
  ORDER BY 2, 1
$$;
