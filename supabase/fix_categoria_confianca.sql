-- ============================================================
-- FIX: Coluna 'categoria_confianca' ausente em transacoes_nubank
-- Execute no SQL Editor do Supabase: https://app.supabase.com
--
-- PROBLEMA: A coluna categoria_confianca (e categoria_origem) não
-- foram aplicadas ao banco, causando o erro:
--   "Could not find the 'categoria_confianca' column of
--    'transacoes_nubank' in the schema cache"
--
-- SOLUÇÃO: Adicionar as colunas de categorização via ALTER TABLE
--          com IF NOT EXISTS para ser idempotente.
-- ============================================================

ALTER TABLE transacoes_nubank
  ADD COLUMN IF NOT EXISTS categoria TEXT;

ALTER TABLE transacoes_nubank
  ADD COLUMN IF NOT EXISTS categoria_origem TEXT DEFAULT 'IA',
  ADD COLUMN IF NOT EXISTS categoria_confianca NUMERIC(3,2);
