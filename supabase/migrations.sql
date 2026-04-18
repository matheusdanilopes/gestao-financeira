-- ============================================================
-- GESTÃO FINANCEIRA — Scripts de migração do banco de dados
-- Execute no SQL Editor do Supabase (https://app.supabase.com)
-- ============================================================

-- 8. Tabela de notificações entre usuários
CREATE TABLE IF NOT EXISTS notificacoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  de_usuario    TEXT NOT NULL,
  nome_usuario  TEXT,
  acao          TEXT NOT NULL,
  descricao     TEXT NOT NULL,
  valor         NUMERIC(12,2),
  lida          BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notificacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_notificacoes" ON notificacoes;
CREATE POLICY "allow_all_notificacoes" ON notificacoes
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_notificacoes_created
  ON notificacoes(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notificacoes_de_usuario
  ON notificacoes(de_usuario);

-- 9. Tabela de push subscriptions para notificações móveis
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario      TEXT NOT NULL,
  subscription JSONB NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT push_subscriptions_usuario_unique UNIQUE (usuario)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_push_subs" ON push_subscriptions;
CREATE POLICY "allow_all_push_subs" ON push_subscriptions
  FOR ALL USING (true) WITH CHECK (true);

-- 0. Índices de performance
-- Execute estas instruções ANTES de criar as tabelas (ou separadamente, se já existirem)
CREATE INDEX IF NOT EXISTS idx_transacoes_fatura
  ON transacoes_nubank(projeto_fatura);

CREATE INDEX IF NOT EXISTS idx_transacoes_fatura_responsavel
  ON transacoes_nubank(projeto_fatura, responsavel);

CREATE INDEX IF NOT EXISTS idx_transacoes_responsavel
  ON transacoes_nubank(responsavel);

CREATE INDEX IF NOT EXISTS idx_planejamento_mes
  ON planejamento(mes_referencia);

CREATE INDEX IF NOT EXISTS idx_investimentos_mes
  ON investimentos(mes_referencia);

CREATE INDEX IF NOT EXISTS idx_aportes_investimento
  ON investimentos_aportes(investimento_id);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created
  ON activity_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receitas_recebimentos_planejamento
  ON receitas_recebimentos(planejamento_id);

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

-- 3. Tabela de investimentos mensais
CREATE TABLE IF NOT EXISTS investimentos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  descricao      TEXT NOT NULL,
  percentual     NUMERIC(6,3) NOT NULL,
  mes_referencia DATE NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE investimentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_investimentos" ON investimentos;
CREATE POLICY "allow_all_investimentos" ON investimentos
  FOR ALL USING (true) WITH CHECK (true);

-- 4. Tabela de aportes por investimento
CREATE TABLE IF NOT EXISTS investimentos_aportes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investimento_id  UUID NOT NULL REFERENCES investimentos(id) ON DELETE CASCADE,
  valor            NUMERIC(12,2) NOT NULL,
  data_aporte      DATE NOT NULL DEFAULT CURRENT_DATE,
  observacao       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE investimentos_aportes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_aportes" ON investimentos_aportes;
CREATE POLICY "allow_all_aportes" ON investimentos_aportes
  FOR ALL USING (true) WITH CHECK (true);

-- 5. Tabela de logs de atividade do usuário
CREATE TABLE IF NOT EXISTS activity_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acao        TEXT NOT NULL,      -- 'inserir' | 'editar' | 'excluir' | 'pagar' | 'receber' | 'aporte' | 'importar'
  tabela      TEXT NOT NULL,      -- 'planejamento' | 'receitas' | 'investimentos'
  descricao   TEXT NOT NULL,
  valor       NUMERIC(12,2),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_logs" ON activity_logs;
CREATE POLICY "allow_all_logs" ON activity_logs
  FOR ALL USING (true) WITH CHECK (true);
