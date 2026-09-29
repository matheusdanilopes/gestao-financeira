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

## Assessor financeiro no WhatsApp

O mesmo agente de IA do chat do app responde pelo WhatsApp (texto e áudio), com os dados do usuário dono do número. Perguntas na primeira pessoa ("quanto **eu** gastei?") usam os dados do usuário logado/vinculado; "nós", "a gente" ou perguntas sem pessoa usam o casal todo. Lançamentos (pagar conta, nova despesa etc.) continuam exigindo confirmação ("sim") antes de gravar.

### Configuração

1. **Banco:** rode `supabase/migration_whatsapp.sql` no SQL Editor do Supabase.
2. **Meta:** crie um app em [developers.facebook.com](https://developers.facebook.com) com o produto WhatsApp e um número de envio.
3. **Variáveis de ambiente (Vercel):**

   | Variável | Onde obter |
   | --- | --- |
   | `WHATSAPP_TOKEN` | Token de acesso (de preferência de um usuário do sistema, sem expiração) com `whatsapp_business_messaging` |
   | `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp → Configuração da API → "Phone number ID" |
   | `WHATSAPP_APP_SECRET` | Configurações do app → Básico → Chave secreta |
   | `WHATSAPP_VERIFY_TOKEN` | Qualquer texto — o mesmo informado no passo 4 |
   | `WHATSAPP_NUMERO` | (opcional) número do assessor só com dígitos, ex.: `5511999999999` — gera o link wa.me na tela |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (o webhook não tem sessão de navegador) |
   | `GEMINI_API_KEY` | Já usada pelo chat do app |

4. **Webhook:** em WhatsApp → Configuração, use a URL `https://<seu-domínio>/api/whatsapp/webhook`, o `WHATSAPP_VERIFY_TOKEN` acima e assine o campo **messages**.
5. **Vincular o número:** no app, *Configurações → Conta → Assessor no WhatsApp → Gerar código* e envie a mensagem `vincular XXXX-XXXX` pelo WhatsApp. Cada pessoa vincula o próprio número.

Comandos no WhatsApp: `ajuda`, `nova conversa` (recomeça o contexto) e `desvincular`. Depois de 12 h sem mensagens, a próxima abre uma conversa nova automaticamente. As conversas também aparecem no histórico do chat do app.
