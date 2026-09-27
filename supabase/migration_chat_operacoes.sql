-- ============================================================
-- Operações propostas pela IA do chat (pagamentos, receitas, aportes,
-- itens de lista) — ficam pendentes até o usuário confirmar na conversa.
--
-- Por que uma tabela e não só o texto da conversa: o valor que será
-- efetivamente gravado precisa vir de algo que o modelo não possa reescrever
-- na hora da confirmação (uma alucinação na segunda chamada não pode trocar o
-- valor da primeira). "Confirmar" só executa o payload já salvo aqui.
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_operacoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL,
  payload         JSONB NOT NULL,
  resumo          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'confirmada', 'cancelada')),
  usuario         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

-- Busca da operação pendente mais recente de uma conversa.
CREATE INDEX IF NOT EXISTS idx_chat_operacoes_pendente
  ON chat_operacoes (conversation_id, status, created_at DESC);

ALTER TABLE chat_operacoes ENABLE ROW LEVEL SECURITY;

-- Mesma convenção do resto do app (ver security_rls_fix.sql): dados
-- financeiros são do casal, não por usuário — qualquer autenticado acessa.
DROP POLICY IF EXISTS "authenticated_chat_operacoes" ON chat_operacoes;
CREATE POLICY "authenticated_chat_operacoes" ON chat_operacoes
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
