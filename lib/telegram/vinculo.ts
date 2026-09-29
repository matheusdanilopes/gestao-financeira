/**
 * Código de uso único que liga um chat do Telegram a um usuário do app.
 *
 * O app gera o código e o embute no link t.me/<bot>?start=CODIGO; o webhook
 * grava o chat que o enviou. É o que prova que o Telegram é de quem está
 * logado no app.
 */

import { randomInt } from 'crypto'

/** Sem 0/O, 1/I, e válido no payload do /start. 32⁸ ≈ 10¹² combinações. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const TAMANHO = 8
export const VALIDADE_CODIGO_MIN = 15

export function gerarCodigo(): string {
  let codigo = ''
  for (let i = 0; i < TAMANHO; i++) codigo += ALFABETO[randomInt(ALFABETO.length)]
  return codigo
}
