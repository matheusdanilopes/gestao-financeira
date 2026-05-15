-- Módulo: Wishlist Familiar
CREATE TABLE IF NOT EXISTS wishlist_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome           TEXT NOT NULL,
  valor_estimado NUMERIC(10,2),
  prioridade     TEXT NOT NULL DEFAULT 'media'
                   CHECK (prioridade IN ('baixa','media','alta')),
  link_ref       TEXT,
  realizado      BOOLEAN NOT NULL DEFAULT FALSE,
  realizado_em   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_wishlist" ON wishlist_items;
CREATE POLICY "allow_all_wishlist" ON wishlist_items
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_wishlist_realizado  ON wishlist_items(realizado);
CREATE INDEX IF NOT EXISTS idx_wishlist_prioridade ON wishlist_items(prioridade);
CREATE INDEX IF NOT EXISTS idx_wishlist_created    ON wishlist_items(created_at DESC);

-- Módulo: Lista de Mercado (lista única compartilhada)
CREATE TABLE IF NOT EXISTS lista_mercado_itens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  quantidade  INT NOT NULL DEFAULT 1 CHECK (quantidade >= 1),
  preco_unit  NUMERIC(10,2),
  comprado    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE lista_mercado_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_lista_mercado" ON lista_mercado_itens;
CREATE POLICY "allow_all_lista_mercado" ON lista_mercado_itens
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_lista_mercado_comprado ON lista_mercado_itens(comprado);
CREATE INDEX IF NOT EXISTS idx_lista_mercado_created  ON lista_mercado_itens(created_at ASC);
