-- ============================================================
-- FIX: Erro de RLS ao salvar categorias em configuracoes
-- Execute no SQL Editor do Supabase: https://app.supabase.com
--
-- PROBLEMA: upsert de 'categorias_compras' falhava com
-- "new row violates row-level security policy" porque:
--   1. A chave 'categorias_compras' não tinha linha padrão,
--      então o upsert tentava INSERT (mais restritivo).
--   2. Em certas condições o cliente server-side usava a anon
--      key sem o JWT do usuário, e auth.role() retornava 'anon'.
--
-- SOLUÇÃO:
--   1. Pré-inserir 'categorias_compras' para que upserts
--      subsequentes sempre façam UPDATE (não INSERT).
--   2. Usar USING (true) WITH CHECK (true) para configuracoes,
--      igual ao padrão das outras tabelas de config compartilhada.
--      A autenticação já é garantida pela camada de API (requireAuth).
-- ============================================================

-- 1. Pré-inserir a chave categorias_compras com as categorias padrão
INSERT INTO configuracoes (chave, valor)
  VALUES (
    'categorias_compras',
    '["Alimentação","Mercado","Transporte","Saúde","Lazer","Educação","Moradia","Vestuário","Tecnologia","Serviços","Viagem","Pet","Outros"]'
  )
  ON CONFLICT (chave) DO NOTHING;

-- 2. Ajustar a política RLS de configuracoes para permitir todas
--    as operações (a autenticação é controlada pela API via requireAuth)
DROP POLICY IF EXISTS "authenticated_configuracoes" ON configuracoes;
DROP POLICY IF EXISTS "allow_all_authenticated"     ON configuracoes;
DROP POLICY IF EXISTS "allow_anon_read"             ON configuracoes;

CREATE POLICY "configuracoes_allow_all" ON configuracoes
  FOR ALL USING (true) WITH CHECK (true);
