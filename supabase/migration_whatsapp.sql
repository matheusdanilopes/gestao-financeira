-- ============================================================
-- Assessor financeiro pelo WhatsApp.
--
-- whatsapp_vinculos: liga um número de WhatsApp a um usuário do app. O
-- vínculo nasce de um código de uso único gerado no app (Configurações →
-- Conta → WhatsApp) e enviado pelo próprio WhatsApp — é assim que se prova
-- que o número pertence a quem está logado. Sem vínculo, o webhook não
-- responde nada sobre as finanças.
--
-- whatsapp_mensagens_processadas: a Meta reenvia o webhook quando não recebe
-- 200 a tempo (ou por instabilidade dela). Guardar o id da mensagem evita
-- responder duas vezes — e, pior, propor/confirmar uma operação duas vezes.
--
-- O webhook usa a SUPABASE_SERVICE_ROLE_KEY (não há sessão de navegador), que
-- ignora RLS. As políticas abaixo valem para a tela de Configurações, que usa
-- a sessão do usuário: cada um só enxerga e altera o próprio vínculo.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_vinculos (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              TEXT NOT NULL UNIQUE,
  email                TEXT,
  telefone             TEXT UNIQUE,
  codigo               TEXT UNIQUE,
  codigo_expira_em     TIMESTAMPTZ,
  conversation_id      UUID REFERENCES conversations(id) ON DELETE SET NULL,
  vinculado_em         TIMESTAMPTZ,
  ultima_interacao_em  TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE whatsapp_vinculos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proprio_whatsapp_vinculo" ON whatsapp_vinculos;
CREATE POLICY "proprio_whatsapp_vinculo" ON whatsapp_vinculos
  FOR ALL USING (auth.role() = 'authenticated' AND user_id = auth.uid()::text)
  WITH CHECK (auth.role() = 'authenticated' AND user_id = auth.uid()::text);

CREATE TABLE IF NOT EXISTS whatsapp_mensagens_processadas (
  wamid        TEXT PRIMARY KEY,
  recebida_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_recebida
  ON whatsapp_mensagens_processadas (recebida_em);

-- Só o webhook (service role) lê e grava aqui: RLS ligado e nenhuma política.
ALTER TABLE whatsapp_mensagens_processadas ENABLE ROW LEVEL SECURITY;
