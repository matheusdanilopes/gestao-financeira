-- V3: Shopping List API — extended fields, history, and per-item category/unit support

-- Extend lista_mercado_itens with new fields
ALTER TABLE lista_mercado_itens ADD COLUMN IF NOT EXISTS user_id         UUID;
ALTER TABLE lista_mercado_itens ADD COLUMN IF NOT EXISTS category        TEXT NOT NULL DEFAULT 'Outros';
ALTER TABLE lista_mercado_itens ADD COLUMN IF NOT EXISTS unit            TEXT NOT NULL DEFAULT 'unidade';
ALTER TABLE lista_mercado_itens ADD COLUMN IF NOT EXISTS estimated_price NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_lista_mercado_user_id  ON lista_mercado_itens(user_id);
CREATE INDEX IF NOT EXISTS idx_lista_mercado_category ON lista_mercado_itens(category);
CREATE INDEX IF NOT EXISTS idx_lista_mercado_nome     ON lista_mercado_itens(LOWER(nome));

-- History table: records every create/update/delete/check action
CREATE TABLE IF NOT EXISTS lista_mercado_historico (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    UUID,
  action     TEXT        NOT NULL,
  user_id    UUID,
  criado_por TEXT,
  item_nome  TEXT,
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE lista_mercado_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_lista_mercado_historico" ON lista_mercado_historico;
CREATE POLICY "allow_all_lista_mercado_historico" ON lista_mercado_historico
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_lista_historico_item_id  ON lista_mercado_historico(item_id);
CREATE INDEX IF NOT EXISTS idx_lista_historico_user_id  ON lista_mercado_historico(user_id);
CREATE INDEX IF NOT EXISTS idx_lista_historico_created  ON lista_mercado_historico(created_at DESC);
