-- ============================================================
-- Notificações pelo Telegram.
--
-- Além de responder perguntas, o bot passa a mandar os avisos do app (contas
-- a vencer, resumo semanal, importações, lista de mercado…) para quem
-- conectou o Telegram. Cada pessoa escolhe os tipos em Configurações → Conta
-- → Assessor no Telegram.
--
-- notificacoes: { "<tipo>": false } desliga um tipo; tipo ausente = ligado.
-- Tipos: vencimento, resumo_semanal, importacao, movimentacoes, mercado,
-- wishlist (ver lib/telegram/categoriasNotificacao.ts).
--
-- Rode depois de migration_telegram.sql. A política RLS existente
-- (proprio_telegram_vinculo) já cobre a coluna nova.
-- ============================================================

ALTER TABLE telegram_vinculos
  ADD COLUMN IF NOT EXISTS notificacoes JSONB NOT NULL DEFAULT '{}'::jsonb;
