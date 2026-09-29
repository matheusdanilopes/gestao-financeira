-- ============================================================
-- Rotina periódica da limpeza do Telegram, pelo pg_cron do Supabase.
--
-- O plano Hobby da Vercel só roda cron uma vez por dia. O webhook já apaga as
-- mensagens no prazo (espera o atraso e apaga na mesma execução); esta rotina
-- é a rede de segurança para o que ficou pendente — falhas, reagendamentos,
-- mensagens com botões. A cada minuto ela só olha a fila: a chamada HTTP ao
-- app sai apenas quando há exclusão vencida.
--
-- Antes de rodar:
--   1. Gere um segredo (ex.: `openssl rand -hex 32`) e cadastre-o na Vercel
--      como TELEGRAM_LIMPEZA_SECRET (Production), depois faça o redeploy.
--   2. Troque <SEGREDO> e <URL_DO_APP> abaixo e rode no SQL Editor.
--
-- Para trocar o segredo depois:
--   SELECT vault.update_secret(
--     (SELECT id FROM vault.secrets WHERE name = 'telegram_limpeza_secret'), '<NOVO>');
-- Para desligar: SELECT cron.unschedule('telegram-limpeza');
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- O segredo fica no Vault (criptografado), nunca no texto do job.
SELECT vault.create_secret('<SEGREDO>', 'telegram_limpeza_secret',
  'Authorization da rotina /api/telegram/limpeza')
WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'telegram_limpeza_secret');

SELECT cron.unschedule('telegram-limpeza')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'telegram-limpeza');

SELECT cron.schedule(
  'telegram-limpeza',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := '<URL_DO_APP>/api/telegram/limpeza',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'telegram_limpeza_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  WHERE EXISTS (
    SELECT 1 FROM public.telegram_mensagens
    WHERE status = 'pendente' AND apagar_em <= NOW()
  );
  $$
);
