-- ============================================================
-- Assessor financeiro pelo Telegram.
--
-- telegram_vinculos: liga um chat privado do Telegram a um usuário do app.
-- O vínculo nasce de um código de uso único gerado no app (Configurações →
-- Conta → Assessor no Telegram): o botão abre o bot com "/start CODIGO" e o
-- webhook grava o chat que mandou. Sem vínculo, o bot não responde nada sobre
-- as finanças.
--
-- telegram_updates_processados: o Telegram reenvia o update quando não recebe
-- 200 a tempo. Guardar o update_id evita responder duas vezes — e, pior,
-- propor/confirmar uma operação duas vezes.
--
-- O webhook usa a SUPABASE_SERVICE_ROLE_KEY (não há sessão de navegador), que
-- ignora RLS. As políticas abaixo valem para a tela de Configurações, que usa
-- a sessão do usuário: cada um só enxerga e altera o próprio vínculo.
-- ============================================================

CREATE TABLE IF NOT EXISTS telegram_vinculos (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              TEXT NOT NULL UNIQUE,
  email                TEXT,
  chat_id              BIGINT UNIQUE,
  telegram_nome        TEXT,
  codigo               TEXT UNIQUE,
  codigo_expira_em     TIMESTAMPTZ,
  conversation_id      UUID REFERENCES conversations(id) ON DELETE SET NULL,
  vinculado_em         TIMESTAMPTZ,
  ultima_interacao_em  TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE telegram_vinculos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proprio_telegram_vinculo" ON telegram_vinculos;
CREATE POLICY "proprio_telegram_vinculo" ON telegram_vinculos
  FOR ALL USING (auth.role() = 'authenticated' AND user_id = auth.uid()::text)
  WITH CHECK (auth.role() = 'authenticated' AND user_id = auth.uid()::text);

CREATE TABLE IF NOT EXISTS telegram_updates_processados (
  update_id    BIGINT PRIMARY KEY,
  recebido_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_updates_recebido
  ON telegram_updates_processados (recebido_em);

-- Só o webhook (service role) lê e grava aqui: RLS ligado e nenhuma política.
ALTER TABLE telegram_updates_processados ENABLE ROW LEVEL SECURITY;
