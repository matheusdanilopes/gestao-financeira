/**
 * O agente escreve em markdown enxuto. O Telegram não entende markdown comum
 * (o MarkdownV2 dele exige escapar metade da pontuação, e um "." fora do lugar
 * faz a mensagem inteira ser recusada), então convertemos para o HTML dele —
 * <b>, <i>, <s>, <code>, <a> —, que só exige escapar &, < e >.
 */

import { LIMITE_MENSAGEM } from './botApi'

const escapar = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function estruturar(texto: string): string {
  return texto
    .replace(/\r\n/g, '\n')
    // Marcadores de lista viram "• " antes da ênfase, para "* item" não abrir negrito.
    .replace(/^([ \t]*)[-*][ \t]+/gm, '$1• ')
    // Linhas horizontais não têm equivalente.
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function markdownParaHtmlTelegram(texto: string): string {
  return escapar(estruturar(texto))
    .replace(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, '<b>$1</b>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<b>$1</b>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    // *ênfase* e _ênfase_ simples (o próprio prompt do Telegram usa *Confirmar*).
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?![*\w])/g, '$1<b>$2</b>')
    .replace(/(^|[^_\w])_(?!\s)([^_\n]+?)_(?![_\w])/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s"]+)\)/g, '<a href="$2">$1</a>')
}

/** Mesmo conteúdo sem marcação — usado se o Telegram recusar o HTML. */
export function markdownParaTextoPuro(texto: string): string {
  return estruturar(texto)
    .replace(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
}

/**
 * Quebra o markdown em partes de até LIMITE_MENSAGEM antes de converter,
 * sempre em fim de linha — assim nenhuma tag HTML fica aberta entre duas
 * mensagens (a ênfase nunca atravessa linhas).
 */
export function dividirMarkdown(texto: string, limite = LIMITE_MENSAGEM): string[] {
  const limpo = estruturar(texto)
  if (limpo.length <= limite) return [limpo]

  const partes: string[] = []
  let atual = ''
  const empurrar = () => {
    if (atual.trim()) partes.push(atual.trim())
    atual = ''
  }
  for (const linha of limpo.split('\n')) {
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
