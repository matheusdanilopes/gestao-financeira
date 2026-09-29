-- ============================================================
-- Limpeza automática do chat do Telegram.
--
-- O chat do Telegram fica limpo; o histórico real fica no app (tabela
-- messages, que o chat do PWA já lê). Cada mensagem recebida ou enviada pelo
-- bot só entra nesta fila DEPOIS de gravada em messages — e sai do Telegram
-- quando apagar_em vence:
--
--   recebidas  → logo após processadas (TELEGRAM_APAGAR_RECEBIDAS_APOS_S, padrão 0)
--   enviadas   → TELEGRAM_APAGAR_RESPOSTAS_APOS_S depois (padrão 60)
--   com botões → só depois do toque em Confirmar/Cancelar (ou em 24 h)
--
-- A Bot API só apaga mensagens com menos de 48 h: passou disso, a linha vira
-- 'nao_apagavel' sem nova chamada. Falhas temporárias (429, 5xx, rede)
-- reagendam apagar_em com espera progressiva; depois de várias, 'falhou'.
--
-- Rode este arquivo no SQL Editor do Supabase. Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS telegram_mensagens (
  id                BIGSERIAL PRIMARY KEY,
  chat_id           BIGINT NOT NULL,
  message_id        BIGINT NOT NULL,
  direcao           TEXT NOT NULL CHECK (direcao IN ('recebida', 'enviada')),
  -- Registro correspondente no histórico do app.
  mensagem_app_id   UUID REFERENCES messages(id) ON DELETE SET NULL,
  -- Quando a mensagem chegou ao Telegram — é daqui que contam as 48 h.
  enviada_em        TIMESTAMPTZ NOT NULL,
  -- Próxima tentativa de exclusão.
  apagar_em         TIMESTAMPTZ NOT NULL,
  -- Mensagem com Confirmar/Cancelar ainda sem resposta: não some antes do toque.
  aguardando_toque  BOOLEAN NOT NULL DEFAULT FALSE,
  status            TEXT NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente', 'apagada', 'nao_apagavel', 'falhou')),
  tentativas        INT NOT NULL DEFAULT 0,
  ultimo_erro       TEXT,
  apagada_em        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_mensagens_fila
  ON telegram_mensagens (apagar_em)
  WHERE status = 'pendente';

CREATE INDEX IF NOT EXISTS idx_telegram_mensagens_created
  ON telegram_mensagens (created_at);

-- Só o servidor (service role) lê e grava aqui: RLS ligado e nenhuma política.
ALTER TABLE telegram_mensagens ENABLE ROW LEVEL SECURITY;

-- De onde veio cada mensagem do histórico — o chat do app mostra o selo
-- "Telegram" nas que vieram do bot.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS canal TEXT NOT NULL DEFAULT 'app';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_canal_check') THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_canal_check CHECK (canal IN ('app', 'telegram'));
  END IF;
END $$;
