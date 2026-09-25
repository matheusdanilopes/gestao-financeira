-- Descrição personalizada das compras.
-- Execute no SQL Editor do Supabase: https://app.supabase.com
--
-- A coluna `descricao` guarda o nome original vindo da fatura e é usada para
-- identificar a transação na importação (hash, conciliação, duplicatas). Por isso
-- ela não deve ser alterada pelo usuário. `descricao_personalizada` é opcional e,
-- quando preenchida, é exibida na tela de Compras no lugar da descrição original.
-- As importações nunca enviam esta coluna, então ela é preservada.
--
-- O script é idempotente.

ALTER TABLE transacoes_nubank
  ADD COLUMN IF NOT EXISTS descricao_personalizada TEXT;
