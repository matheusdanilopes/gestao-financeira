-- ============================================================
-- SEGURANÇA: Correção de políticas RLS (Row Level Security)
-- Execute no SQL Editor do Supabase: https://app.supabase.com
--
-- PROBLEMA: Todas as tabelas tinham políticas USING (true), permitindo
-- acesso anônimo a todos os dados financeiros de todos os usuários.
--
-- CORREÇÃO: Restringir acesso a usuários autenticados via Supabase Auth.
-- ============================================================

-- ── notificacoes ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_notificacoes" ON notificacoes;
CREATE POLICY "authenticated_notificacoes" ON notificacoes
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── push_subscriptions ───────────────────────────────────────────────────────
-- SELECT e DELETE abertos à anon key: necessário para envio de push em
-- importações via API key (sem sessão de usuário). INSERT/UPDATE exigem auth.
DROP POLICY IF EXISTS "authenticated_push_subs" ON push_subscriptions;
DROP POLICY IF EXISTS "allow_all_push_subs" ON push_subscriptions;
CREATE POLICY "push_subs_read" ON push_subscriptions
  FOR SELECT USING (true);
CREATE POLICY "push_subs_delete" ON push_subscriptions
  FOR DELETE USING (true);
CREATE POLICY "push_subs_write" ON push_subscriptions
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "push_subs_update" ON push_subscriptions
  FOR UPDATE USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── investimentos ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_investimentos" ON investimentos;
CREATE POLICY "authenticated_investimentos" ON investimentos
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── investimentos_aportes ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_aportes" ON investimentos_aportes;
CREATE POLICY "authenticated_aportes" ON investimentos_aportes
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── activity_logs ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_logs" ON activity_logs;
CREATE POLICY "authenticated_logs" ON activity_logs
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── categorization_jobs ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_categorization_jobs" ON categorization_jobs;
CREATE POLICY "authenticated_categorization_jobs" ON categorization_jobs
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── conversations ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_conversations" ON conversations;
CREATE POLICY "authenticated_conversations" ON conversations
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── messages ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_messages" ON messages;
CREATE POLICY "authenticated_messages" ON messages
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── assinaturas ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_assinaturas" ON assinaturas;
CREATE POLICY "authenticated_assinaturas" ON assinaturas
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── assinaturas_historico ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_assinaturas_historico" ON assinaturas_historico;
CREATE POLICY "authenticated_assinaturas_historico" ON assinaturas_historico
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── faturas ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "allow_all_faturas" ON faturas;
CREATE POLICY "authenticated_faturas" ON faturas
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── configuracoes ─────────────────────────────────────────────────────────────
-- Remove a política de leitura anônima (o servidor usa a sessão autenticada agora)
DROP POLICY IF EXISTS "allow_anon_read" ON configuracoes;
DROP POLICY IF EXISTS "allow_all_authenticated" ON configuracoes;
CREATE POLICY "authenticated_configuracoes" ON configuracoes
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── transacoes_nubank ─────────────────────────────────────────────────────────
-- Verificar se existe e garantir RLS
ALTER TABLE transacoes_nubank ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_transacoes" ON transacoes_nubank;
DROP POLICY IF EXISTS "authenticated_transacoes" ON transacoes_nubank;
CREATE POLICY "authenticated_transacoes" ON transacoes_nubank
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── planejamento ──────────────────────────────────────────────────────────────
ALTER TABLE planejamento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_planejamento" ON planejamento;
DROP POLICY IF EXISTS "authenticated_planejamento" ON planejamento;
CREATE POLICY "authenticated_planejamento" ON planejamento
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── receitas_recebimentos (se existir) ───────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'receitas_recebimentos') THEN
    ALTER TABLE receitas_recebimentos ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "allow_all_receitas" ON receitas_recebimentos;
    DROP POLICY IF EXISTS "authenticated_receitas" ON receitas_recebimentos;
    CREATE POLICY "authenticated_receitas" ON receitas_recebimentos
      FOR ALL USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- ── wishlist_items (se existir) ───────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'wishlist_items') THEN
    ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "allow_all_wishlist" ON wishlist_items;
    DROP POLICY IF EXISTS "authenticated_wishlist" ON wishlist_items;
    CREATE POLICY "authenticated_wishlist" ON wishlist_items
      FOR ALL USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- ── lista_mercado_itens (se existir) ─────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'lista_mercado_itens') THEN
    ALTER TABLE lista_mercado_itens ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "allow_all_lista_mercado" ON lista_mercado_itens;
    DROP POLICY IF EXISTS "authenticated_lista_mercado" ON lista_mercado_itens;
    CREATE POLICY "authenticated_lista_mercado" ON lista_mercado_itens
      FOR ALL USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- ── classificacoes_aprendidas (se existir) ────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'classificacoes_aprendidas') THEN
    ALTER TABLE classificacoes_aprendidas ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "allow_all_classificacoes" ON classificacoes_aprendidas;
    DROP POLICY IF EXISTS "authenticated_classificacoes" ON classificacoes_aprendidas;
    CREATE POLICY "authenticated_classificacoes" ON classificacoes_aprendidas
      FOR ALL USING (auth.role() = 'authenticated')
      WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- ── Storage: wishlist-images bucket ──────────────────────────────────────────
-- Restringir uploads e leitura a usuários autenticados
-- (Execute separadamente se as políticas de storage precisarem ser recriadas)
-- INSERT INTO storage.policies (name, bucket_id, operation, definition)
-- VALUES ('authenticated_upload', 'wishlist-images', 'INSERT', '(auth.role() = ''authenticated'')');

-- ── Verificação final ─────────────────────────────────────────────────────────
-- Confirma que RLS está ativo em todas as tabelas críticas
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'transacoes_nubank', 'planejamento', 'configuracoes',
    'investimentos', 'investimentos_aportes', 'assinaturas',
    'assinaturas_historico', 'notificacoes', 'push_subscriptions',
    'conversations', 'messages', 'categorization_jobs',
    'activity_logs', 'faturas', 'wishlist_items', 'lista_mercado_itens'
  )
ORDER BY tablename;
