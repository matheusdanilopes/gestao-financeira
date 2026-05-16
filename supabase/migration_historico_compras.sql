-- Módulo: Histórico de Compras (lista de mercado)
CREATE TABLE IF NOT EXISTS historico_compras (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_hora   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valor_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  itens_count INT NOT NULL DEFAULT 0,
  itens       JSONB NOT NULL DEFAULT '[]',
  usuario     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE historico_compras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_historico_compras" ON historico_compras;
CREATE POLICY "allow_all_historico_compras" ON historico_compras
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_historico_compras_data    ON historico_compras(data_hora DESC);
CREATE INDEX IF NOT EXISTS idx_historico_compras_usuario ON historico_compras(usuario);
