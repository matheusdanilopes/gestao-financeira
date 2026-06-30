-- Adiciona suporte a sublistas (hierarquia auto-referencial) na tabela listas_compras
-- Rodar no Supabase SQL Editor antes de testar a feature

ALTER TABLE listas_compras
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES listas_compras(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_listas_compras_parent ON listas_compras(parent_id);
