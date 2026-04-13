-- ============================================================
-- GESTÃO FINANCEIRA — Scripts de migração do banco de dados
-- Execute no SQL Editor do Supabase (https://app.supabase.com)
-- ============================================================

-- 1. Coluna de categoria nas transações
ALTER TABLE transacoes_nubank
  ADD COLUMN IF NOT EXISTS categoria TEXT;

-- 2. Tabela de configurações (dia de vencimento, ajuste de fechamento, etc.)
CREATE TABLE IF NOT EXISTS configuracoes (
  chave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL
);

-- Valores padrão (não sobrescreve se já existirem)
INSERT INTO configuracoes (chave, valor)
  VALUES
    ('dia_vencimento',    '10'),
    ('ajuste_fechamento', '0')
  ON CONFLICT (chave) DO NOTHING;

-- Permite leitura e escrita para usuários autenticados (necessário se RLS estiver ativo)
ALTER TABLE configuracoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_authenticated" ON configuracoes;
CREATE POLICY "allow_all_authenticated" ON configuracoes
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Permite leitura anônima também (para o servidor via anon key)
DROP POLICY IF EXISTS "allow_anon_read" ON configuracoes;
CREATE POLICY "allow_anon_read" ON configuracoes
  FOR SELECT USING (true);
