-- Feature: Listas de Compras (N listas nomeadas independentes)

CREATE TABLE IF NOT EXISTS listas_compras (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       TEXT        NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','arquivada')),
  criado_por TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE listas_compras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_listas_compras" ON listas_compras;
CREATE POLICY "allow_all_listas_compras" ON listas_compras
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_listas_compras_status  ON listas_compras(status);
CREATE INDEX IF NOT EXISTS idx_listas_compras_created ON listas_compras(created_at DESC);

-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS listas_compras_itens (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lista_id       UUID        NOT NULL REFERENCES listas_compras(id) ON DELETE CASCADE,
  nome           TEXT        NOT NULL,
  quantidade     INT         NOT NULL DEFAULT 1 CHECK (quantidade >= 1),
  pessoa         TEXT,
  preco_previsto NUMERIC(10,2),
  preco_pago     NUMERIC(10,2),
  status         TEXT        NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','comprado')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data_compra    TIMESTAMPTZ
);

ALTER TABLE listas_compras_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_listas_compras_itens" ON listas_compras_itens;
CREATE POLICY "allow_all_listas_compras_itens" ON listas_compras_itens
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_lci_lista_id ON listas_compras_itens(lista_id);
CREATE INDEX IF NOT EXISTS idx_lci_status   ON listas_compras_itens(status);
CREATE INDEX IF NOT EXISTS idx_lci_created  ON listas_compras_itens(created_at ASC);
