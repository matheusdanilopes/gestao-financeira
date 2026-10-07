This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Assessor financeiro no Telegram

O mesmo agente de IA do chat do app responde pelo Telegram, por texto ou áudio, com os dados do usuário que conectou o Telegram. Perguntas na primeira pessoa ("quanto **eu** gastei?") usam os dados desse usuário; "nós", "a gente" ou perguntas sem pessoa usam o casal todo. Lançamentos (pagar conta, nova despesa etc.) só são gravados depois de tocar em **✅ Confirmar**. Vários lançamentos numa mensagem só ("paguei luz 150, água 80 e internet 100", "coloca arroz, feijão e café na lista") viram um lote, confirmado de uma vez — no app e no Telegram.

1. **Banco:** rode `supabase/migration_telegram.sql` no SQL Editor do Supabase.
2. **Bot:** no Telegram, fale com o **@BotFather**, envie `/newbot`, escolha nome e usuário (terminado em `bot`) e copie o token. Pelo BotFather também dá para trocar a foto (`/setuserpic`) e a descrição do bot.
3. **Vercel:** cadastre `TELEGRAM_BOT_TOKEN` (Production) e faça o redeploy. `SUPABASE_SERVICE_ROLE_KEY` e `GEMINI_API_KEY` também são necessárias.
4. **Conectar:** no app, *Configurações → Conta → Assessor no Telegram → Conectar Telegram → Abrir no Telegram* e toque em **Iniciar**. Cada pessoa conecta o próprio Telegram.

O webhook (`/api/telegram/webhook`) é registrado automaticamente quando a tela de Configurações é aberta em produção, com um segredo derivado do token. Para fixar outra URL, defina `TELEGRAM_WEBHOOK_URL`. Comandos no bot: `/ajuda`, `/nova` e `/desvincular`.

## Notificações pelo Telegram

Quem conectou o Telegram também recebe por lá os avisos do app, com um botão **Abrir no app** que leva à tela certa:

| Tipo | Quando |
| --- | --- |
| Contas a vencer | Na véspera e no dia, às 09:00 (as suas e as do Conjunto, com valor) |
| Resumo semanal | Segundas às 09:00: total da semana, tendência, maiores categorias e o Conjunto |
| Importação de faturas | Compras novas, estornos, falhas e divergências de fatura (importações sem nada novo não geram mensagem) |
| Pagamentos e aportes | Quando a outra pessoa registra pagamento, receita ou aporte |
| Lista de mercado / Wishlist | Itens e desejos adicionados pela outra pessoa |

1. **Banco:** rode `supabase/migration_telegram_notificacoes.sql` no SQL Editor (depois de `migration_telegram.sql`). Sem ela, todos os tipos ficam ligados.
2. **Escolher:** em *Configurações → Conta → Assessor no Telegram*, cada pessoa liga/desliga os tipos e pode **Enviar notificação de teste**. É independente do push do navegador.
3. **Link do botão:** usa `VERCEL_PROJECT_PRODUCTION_URL` (automática na Vercel) ou `NEXT_PUBLIC_APP_URL`; sem endereço https público a mensagem vai sem botão.
4. **Crons:** `vencimento` e `resumo-semanal` rodam às 12:00 UTC (09:00 de Brasília) e leem os dados com a `SUPABASE_SERVICE_ROLE_KEY`. Defina `CRON_SECRET` na Vercel para protegê-los.

### Chat do Telegram limpo, histórico no app

O chat do Telegram não acumula conversa: o histórico real fica no app (*Chat → Histórico*, com o selo **Telegram**). Cada mensagem que chega ou que o bot envia é gravada na tabela `messages` e só **depois** entra na fila de exclusão `telegram_mensagens` — se a gravação falhar, a mensagem fica no Telegram.

- Nada some enquanto a conversa está ativa: cada mensagem nova (sua ou do bot) adia a limpeza do chat inteiro. A conversa sai do Telegram `TELEGRAM_APAGAR_APOS_INATIVIDADE_S` segundos depois da última mensagem (padrão 300 = 5 min). Mensagens com **Confirmar/Cancelar** esperam o toque (ou 24 h).
- Quem apaga é a rotina `/api/telegram/limpeza`, pelo `pg_cron` do Supabase a cada minuto (`supabase/cron_telegram_limpeza.sql`, só chama o app quando há exclusão vencida) e pelo Vercel Cron uma vez por dia. O webhook também apaga o que já venceu ao terminar cada resposta.
- Falhas (limite de requisições, erro do Telegram, rede) ficam registradas em `ultimo_erro` e são tentadas de novo com espera progressiva (30 s, 1 min, 2 min… até 6 h). O Telegram só apaga mensagens com menos de 48 h: as mais antigas viram `nao_apagavel`, sem nova tentativa.

| Variável | Para quê |
|---|---|
| `TELEGRAM_CHATS_PERMITIDOS` | chat_ids aceitos, separados por vírgula. Qualquer outro chat é ignorado em silêncio. Vazia: vale só o vínculo. |
| `TELEGRAM_APAGAR_APOS_INATIVIDADE_S` | segundos sem mensagens até a conversa sumir do Telegram (padrão `300`). |
| `TELEGRAM_AUTOLIMPEZA` | `off` desliga o agendamento de novas exclusões. |
| `TELEGRAM_LIMPEZA_SECRET` | segredo do `pg_cron` para chamar `/api/telegram/limpeza` (o Vercel Cron usa o `CRON_SECRET`). |

Banco: rode `supabase/migration_telegram_autolimpeza.sql` e, para a rotina a cada minuto, `supabase/cron_telegram_limpeza.sql`. Para acompanhar a fila: `select status, count(*) from telegram_mensagens group by status;`

## Como o assessor lê os dados

Chat do app e Telegram passam pelo mesmo turno (`lib/ai/agent/turno.ts`), que lê tudo por um **GatewayDados** (`lib/ai/data/gateway.ts`):

- **Núcleo em cache** (`lib/ai/data/nucleo.ts`): compras e planejamento dos últimos 24 meses, assinaturas, investimentos, listas etc. Fica 60 s em cache por instância; turnos simultâneos (duas mensagens seguidas no Telegram) compartilham a mesma leitura. Toda gravação confirmada pela IA invalida o cache.
- **Histórico sob demanda**: quando uma ferramenta pede um período anterior à janela (ou uma consulta sem período, como "a maior compra de todas"), os meses antigos são buscados na hora — nenhum mês fica fora do alcance.
- **Catálogo de fontes** (`lib/ai/data/catalogo.ts`): lista branca de tudo que a IA pode ler, com nomes de campo. A ferramenta genérica `explorar_dados` consulta qualquer fonte dele (atividade do app, histórico de preço das assinaturas, importações de fatura, idas ao mercado, listas arquivadas…). Para expor uma tabela nova à IA, basta declarar mais uma fonte ali.

## Compras previstas

Em *Cartão → Compras previstas* você cadastra compras que ainda vão cair na fatura do NuBank — **pontuais** (só no mês), **parceladas** (valor total + nº de parcelas, descontando uma parcela por mês) ou **recorrentes** (todo mês até encerrar). O "Restante" de cada pessoa no Dashboard já desconta a parte prevista que ainda não caiu.

- **Palavras-chave** (opcional, separadas por vírgula): compras importadas com esses termos na descrição abatem a previsão automaticamente.
- **Já caiu**: baixa manual da previsão no mês. Numa parcelada, tira também as parcelas seguintes — elas passam a vir das compras importadas (e de "parc. prev." no Dashboard).
- **Banco:** rode `supabase/migration_reservas_fatura.sql` no SQL Editor do Supabase. O arquivo pode ser rodado de novo (adiciona a coluna de parcelas se faltar).
