-- ============================================================
-- VERIFICAÇÃO (somente leitura): estado atual das políticas RLS
-- Execute no SQL Editor do Supabase: https://app.supabase.com
--
-- Não altera nada — só mostra se as tabelas financeiras estão com a
-- política aberta original (qual="true", any user com a anon key lê tudo)
-- ou já com a restrição de security_rls_fix.sql (qual contém
-- "auth.role() = 'authenticated'"). Rode isto antes de decidir se vale
-- aplicar security_rls_fix.sql — que por sua vez exige que
-- lib/ai/contextBuilder.ts pare de usar a anon key "crua" (sem sessão) e
-- passe a usar um cliente autenticado, senão o chat passaria a receber
-- dados vazios.
-- ============================================================

select
  schemaname,
  tablename,
  policyname,
  cmd as comando,
  qual as condicao_using,
  with_check as condicao_with_check
from pg_policies
where tablename in (
  'transacoes_nubank', 'planejamento', 'configuracoes',
  'investimentos', 'investimentos_aportes', 'assinaturas',
  'faturas', 'conversations', 'messages'
)
order by tablename, policyname;
