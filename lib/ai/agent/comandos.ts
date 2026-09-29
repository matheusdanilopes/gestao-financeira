/**
 * Comandos e regras de conversa comuns aos canais de mensagem (WhatsApp,
 * Telegram): o que é "ajuda", "nova conversa" ou "desvincular", e quando uma
 * conversa parada deve ser trocada por outra.
 */

/**
 * Depois de tanto tempo parado, a próxima mensagem abre uma conversa nova:
 * o contexto de ontem mais atrapalha do que ajuda, e uma proposta de operação
 * esquecida não pode ser confirmada por um "sim" solto dias depois.
 */
export const CONVERSA_OCIOSA_MS = 12 * 60 * 60 * 1000

export type Comando = 'ajuda' | 'nova' | 'desvincular'

/** Sem acento, caixa ou pontuação — "/Nova conversa!" e "nova conversa" são o mesmo comando. */
export function normalizarComando(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const COMANDOS: Record<Comando, Set<string>> = {
  ajuda: new Set(['ajuda', 'menu', 'help', 'comandos']),
  nova: new Set(['nova conversa', 'novo assunto', 'nova', 'reiniciar', 'recomecar', 'limpar']),
  desvincular: new Set(['desvincular', 'desconectar']),
}

/** A mensagem inteira precisa ser o comando: "nova conversa sobre a fatura" é uma pergunta. */
export function identificarComando(texto: string): Comando | null {
  const t = normalizarComando(texto)
  for (const [comando, variantes] of Object.entries(COMANDOS) as [Comando, Set<string>][]) {
    if (variantes.has(t)) return comando
  }
  return null
}

/** Exemplos de pergunta mostrados na ajuda de todos os canais. */
export const EXEMPLOS_PERGUNTA = [
  'Quanto eu gastei este mês?',
  'Qual o valor da fatura do Nubank?',
  'Quais contas vencem esta semana?',
  'Paguei a conta de luz, 180 reais',
  'Coloca leite na lista de mercado',
]
