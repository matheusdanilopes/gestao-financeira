-- Adiciona 'Conjunto' como valor permitido no campo responsavel da tabela transacoes_nubank.
-- Execute no SQL Editor do Supabase: https://app.supabase.com

ALTER TABLE transacoes_nubank
  DROP CONSTRAINT IF EXISTS transacoes_nubank_responsavel_check;

ALTER TABLE transacoes_nubank
  ADD CONSTRAINT transacoes_nubank_responsavel_check
  CHECK (responsavel IN ('Matheus', 'Jeniffer', 'Conjunto'));
