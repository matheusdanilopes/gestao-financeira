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

ALTER TABLE transacoes_nubank
  ADD COLUMN IF NOT EXISTS categoria_origem TEXT DEFAULT 'IA',
  ADD COLUMN IF NOT EXISTS categoria_confianca NUMERIC(3,2);

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

-- 10. Expandir categorias permitidas em planejamento
-- Remove o constraint antigo que só permitia 'Fixa' e 'Extra'
ALTER TABLE planejamento DROP CONSTRAINT IF EXISTS planejamento_categoria_check;
ALTER TABLE planejamento DROP CONSTRAINT IF EXISTS planejamento_categoria_fkey;

-- Garante que o campo aceita qualquer valor de texto
ALTER TABLE planejamento ALTER COLUMN categoria TYPE TEXT;

-- Atualiza itens sem categoria para 'Fixa' como fallback
UPDATE planejamento SET categoria = 'Fixa' WHERE categoria IS NULL OR categoria = '';

-- 11. Remover constraint de categoria em transacoes_nubank
ALTER TABLE transacoes_nubank DROP CONSTRAINT IF EXISTS transacoes_nubank_categoria_check;

-- 12. Tabela de jobs de categorização (permite rastrear progresso mesmo com o app fechado)
CREATE TABLE IF NOT EXISTS categorization_jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status                TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'done' | 'error'
  total                 INT,
  categorized           INT DEFAULT 0,
  cota_diaria_esgotada  BOOLEAN DEFAULT FALSE,
  erros                 JSONB,
  started_at            TIMESTAMPTZ DEFAULT NOW(),
  finished_at           TIMESTAMPTZ
);

ALTER TABLE categorization_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_categorization_jobs" ON categorization_jobs;
CREATE POLICY "allow_all_categorization_jobs" ON categorization_jobs
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_categorization_jobs_started
  ON categorization_jobs(started_at DESC);

-- 13. Garantir unicidade de hash_linha para que o upsert deduplication funcione corretamente
ALTER TABLE transacoes_nubank
  ADD CONSTRAINT transacoes_nubank_hash_linha_unique UNIQUE (hash_linha);

-- 14. Coluna cartao para identificar o cartão de origem das transações
-- 'nubank' = NuBank (padrão), 'cartao1' = Cartão 1, 'cartao2' = Cartão 2
ALTER TABLE transacoes_nubank
  ADD COLUMN IF NOT EXISTS cartao TEXT NOT NULL DEFAULT 'nubank';

CREATE INDEX IF NOT EXISTS idx_transacoes_cartao
  ON transacoes_nubank(cartao);

CREATE INDEX IF NOT EXISTS idx_transacoes_fatura_cartao
  ON transacoes_nubank(projeto_fatura, cartao);

-- 15. Conciliação Inteligente: status, valor reconciliado e referência de conflito
ALTER TABLE transacoes_nubank
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDENTE';

ALTER TABLE transacoes_nubank
  ADD COLUMN IF NOT EXISTS valor_final NUMERIC(12,2);

ALTER TABLE transacoes_nubank
  ADD COLUMN IF NOT EXISTS conciliacao_ref UUID REFERENCES transacoes_nubank(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transacoes_status
  ON transacoes_nubank(status);

-- 16. Campo metadata nas notificações para dados de conflito de conciliação
ALTER TABLE notificacoes
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 17. Tabela de faturas com datas de fechamento por cartão
-- Registra a data real de fechamento de cada fatura (mês) por cartão.
-- Permite saber em qual fatura cada compra entra e sobrescrever datas calculadas.
CREATE TABLE IF NOT EXISTS faturas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cartao         TEXT NOT NULL,           -- 'nubank' | 'cartao1' | 'cartao2'
  mes_referencia DATE NOT NULL,           -- Primeiro dia do mês da fatura (yyyy-MM-01)
  data_fechamento DATE NOT NULL,          -- Data de fechamento registrada para esta fatura
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT faturas_cartao_mes_unique UNIQUE (cartao, mes_referencia)
);

ALTER TABLE faturas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_faturas" ON faturas;
CREATE POLICY "allow_all_faturas" ON faturas
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_faturas_cartao_mes
  ON faturas(cartao, mes_referencia DESC);

-- Configurações de vencimento por cartão (cartao1 e cartao2)
-- O nubank continua usando as chaves globais 'dia_vencimento' e 'ajuste_fechamento'
INSERT INTO configuracoes (chave, valor)
  VALUES
    ('dia_vencimento_cartao1',    '10'),
    ('dia_vencimento_cartao2',    '10'),
    ('ajuste_fechamento_cartao1', '0'),
    ('ajuste_fechamento_cartao2', '0')
  ON CONFLICT (chave) DO NOTHING;

-- 18. Tabelas de chat stateful com IA
CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_conversations" ON conversations;
CREATE POLICY "allow_all_conversations" ON conversations
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_conversations_user
  ON conversations(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content          TEXT NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_messages" ON messages;
CREATE POLICY "allow_all_messages" ON messages
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages(conversation_id, created_at ASC);

-- 19. Tabela de assinaturas recorrentes no cartão
-- Permite cadastrar serviços cobrados mensalmente e acompanhar o montante por cartão
CREATE TABLE IF NOT EXISTS assinaturas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         TEXT NOT NULL,
  valor        NUMERIC(12,2) NOT NULL,
  cartao       TEXT NOT NULL DEFAULT 'nubank',        -- 'nubank' | 'cartao1' | 'cartao2'
  responsavel  TEXT NOT NULL DEFAULT 'Compartilhado', -- 'Matheus' | 'Jeniffer' | 'Compartilhado'
  dia_cobranca INT,                                   -- dia do mês em que é cobrada (1–31)
  categoria    TEXT NOT NULL DEFAULT 'Outros',        -- 'Streaming' | 'Música' | 'Software' | 'Saúde' | 'Educação' | 'Jogos' | 'Segurança' | 'Outros'
  ativa        BOOLEAN NOT NULL DEFAULT TRUE,
  observacao   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE assinaturas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_assinaturas" ON assinaturas;
CREATE POLICY "allow_all_assinaturas" ON assinaturas
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_assinaturas_cartao ON assinaturas(cartao);
CREATE INDEX IF NOT EXISTS idx_assinaturas_ativa  ON assinaturas(ativa);
