-- ============================================================
-- Remoção da funcionalidade de insights por IA.
--
-- O card "Insights por IA" do dashboard (app/api/insights) e o cache dos
-- insights de Parcelamentos deixaram de existir; as tabelas de cache ficaram
-- órfãs.
--
-- Rode este arquivo no SQL Editor do Supabase. Idempotente.
-- ============================================================

DROP TABLE IF EXISTS insights_cache;
DROP TABLE IF EXISTS parcelamentos_insights_cache;
