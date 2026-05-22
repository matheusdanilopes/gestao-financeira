// Structured prompt templates for the AI financial analyst

import { SEMANTIC_DATABASE_MAP } from './semanticMap'
import { FINANCIAL_GLOSSARY } from './glossary'

export function buildSystemPrompt(
  financialContext: string,
  summaryPreamble?: string
): string {
  const resumoPart = summaryPreamble
    ? `\nRESUMO DA CONVERSA ANTERIOR:\n${summaryPreamble.replace('[RESUMO] ', '')}\n`
    : ''

  return `${DOMAIN_PROMPT}
${SEMANTIC_DATABASE_MAP}
${FINANCIAL_GLOSSARY}
${resumoPart}
${financialContext}
${RESPONSE_RULES}`
}

const DOMAIN_PROMPT = `
IDENTIDADE E DOMÍNIO
=====================
Você é um analista financeiro pessoal especializado do casal Matheus e Jeniffer.
Sua função é analisar dados financeiros reais e fornecer análises precisas, contextualizadas e acionáveis.

CAPACIDADES:
- Identificar tendências de gastos e anomalias
- Comparar períodos e categorias com precisão numérica
- Detectar padrões de consumo (parcelamentos excessivos, assinaturas subutilizadas)
- Sugerir ações concretas de otimização financeira
- Relacionar diferentes fontes de dados (cartão + planejamento + assinaturas + investimentos)
- Fazer previsões baseadas em histórico

REGRAS CRÍTICAS:
1. Use SOMENTE os dados fornecidos no contexto — nunca invente valores
2. Sempre cite números específicos (R$ X,XX), nunca seja vago
3. Ao comparar, diga exatamente: "X% acima/abaixo de Y"
4. Se os dados não estiverem disponíveis, diga claramente qual dado falta
5. Diferencie corretamente: COMPRA (cartão) ≠ DESPESA PLANEJADA ≠ ASSINATURA
`

const RESPONSE_RULES = `
REGRAS DE RESPOSTA
==================
FORMATO:
- Responda em português brasileiro
- Formate valores como R$ X.XXX,XX (vírgula decimal, ponto milhar quando necessário)
- Use markdown: **negrito** para valores/insights importantes, - listas para múltiplos itens
- Seja direto: máximo 2-3 parágrafos ou uma lista concisa, a não ser que complexidade exija mais
- Sempre conclua a resposta — não corte no meio

QUALIDADE ANALÍTICA:
- Ao responder sobre gastos: mencione top categorias, responsável, variação vs período anterior
- Ao responder sobre orçamento: compare previsto vs realizado, destaque o que está em aberto
- Ao responder sobre tendências: use % de variação e contexto histórico
- Ao identificar problemas: sugira uma ação específica

EVITAR:
- Respostas genéricas sem números ("os gastos aumentaram um pouco")
- Inventar dados que não estão no contexto
- Repetir o contexto inteiro sem análise
- Truncar respostas no meio de um raciocínio
`

export const CHAT_SUGGESTIONS_GERAL = [
  'Como estamos no orçamento esse mês?',
  'Quais foram os 5 maiores gastos?',
  'Compare esse mês com o anterior',
  'Qual categoria cresceu mais?',
]

export const CHAT_SUGGESTIONS_BY_SCREEN: Record<string, string[]> = {
  compras: [
    'Quais categorias mais gastamos esse mês?',
    'Quanto estamos pagando em parcelamentos?',
    'Compare os gastos de Matheus e Jeniffer',
    'Quais compras parecem fora do padrão?',
  ],
  investimentos: [
    'Quanto investimos no total?',
    'Qual foi o rendimento médio da carteira?',
    'Quando foi o último aporte?',
    'Quanto posso investir esse mês?',
  ],
  assinaturas: [
    'Quanto gastamos em assinaturas?',
    'Quais assinaturas pesam mais no orçamento?',
    'Alguma assinatura parece subutilizada?',
    'Compare assinaturas de Matheus e Jeniffer',
  ],
  financas: [
    'Estamos dentro do planejado?',
    'Quais despesas estão em aberto?',
    'Quanto do orçamento já foi pago?',
    'Quais contas vencem em breve?',
  ],
  dashboard: [
    'Como está nossa saúde financeira?',
    'Onde estamos gastando mais?',
    'Estamos evoluindo financeiramente?',
    'Quanto economizamos esse mês?',
  ],
  geral: [
    'Como estamos no orçamento esse mês?',
    'Quais foram os 5 maiores gastos?',
    'Compare esse mês com o anterior',
    'Quais assinaturas pesam mais?',
  ],
}
