/**
 * O agente é instruído a escrever no formato do WhatsApp, mas o hábito do
 * markdown escapa (e o histórico da conversa vem do app, que usa markdown).
 * Estas conversões garantem que nada chegue com "**" ou "###" literais.
 */

import { LIMITE_MENSAGEM } from './cloudApi'

export function markdownParaWhatsApp(texto: string): string {
  return texto
    .replace(/\r\n/g, '\n')
    // Títulos viram uma linha em negrito.
    .replace(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, '*$1*')
    // Marcadores de lista ("- " ou "* ") viram "• " — antes do negrito, para
    // o "* " de lista não ser lido como abertura de ênfase.
    .replace(/^([ \t]*)[-*][ \t]+/gm, '$1• ')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '*$1*')
    .replace(/~~(.+?)~~/g, '~$1~')
    // [texto](url) → texto (url)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    // Linhas horizontais não têm equivalente.
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Quebra em mensagens de até LIMITE_MENSAGEM, preferindo parágrafos e linhas inteiras. */
export function dividirMensagem(texto: string, limite = LIMITE_MENSAGEM): string[] {
  if (texto.length <= limite) return [texto]

  const partes: string[] = []
  let atual = ''
  const empurrar = () => {
    if (atual.trim()) partes.push(atual.trim())
    atual = ''
  }

  for (const linha of texto.split('\n')) {
    if (linha.length > limite) {
      empurrar()
      for (let i = 0; i < linha.length; i += limite) partes.push(linha.slice(i, i + limite))
      continue
    }
    if (atual.length + linha.length + 1 > limite) empurrar()
    atual += (atual ? '\n' : '') + linha
  }
  empurrar()
  return partes
}
