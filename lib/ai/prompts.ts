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
  'Onde posso cortar gastos esse mês?',
  'Quanto sobrou para investir este mês?',
  'Tem conta vencendo esta semana?',
  'Qual categoria está acima do normal?',
]

export const CHAT_SUGGESTIONS_BY_SCREEN: Record<string, string[]> = {
  compras: [
    'Qual categoria está me custando mais que o esperado?',
    'Quanto estou pagando em parcelamentos ativos?',
    'Quem gastou mais este mês, Matheus ou Jeniffer?',
    'Alguma compra fora do padrão nos últimos 30 dias?',
  ],
  investimentos: [
    'Quanto posso aportar este mês sem apertar?',
    'Quanto já investi no total este ano?',
    'Faz quanto tempo do último aporte?',
    'Qual ativo ocupa mais espaço na carteira?',
  ],
  assinaturas: [
    'Qual assinatura dá para cancelar?',
    'Quanto pago de assinaturas por mês ao todo?',
    'Alguma assinatura duplicada ou esquecida?',
    'As assinaturas subiram de preço ultimamente?',
  ],
  financas: [
    'Tem alguma conta em atraso?',
    'Quais despesas vencem esta semana?',
    'Quanto ainda falta pagar do planejamento?',
    'Estou dentro do orçamento previsto?',
  ],
  dashboard: [
    'Onde posso cortar gastos esse mês?',
    'Quanto sobrou para investir este mês?',
    'Estou gastando mais ou menos que no mês passado?',
    'Qual é meu maior risco financeiro agora?',
  ],
  geral: [
    'Onde posso cortar gastos esse mês?',
    'Quanto sobrou para investir este mês?',
    'Tem conta vencendo esta semana?',
    'Qual categoria está acima do normal?',
  ],
}
