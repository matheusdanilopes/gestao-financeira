/**
 * Vínculo número de WhatsApp ↔ usuário do app.
 *
 * O app gera um código de uso único; a pessoa o envia pelo WhatsApp e o
 * webhook grava o número que mandou. É o que prova que o número é de quem
 * está logado — digitar o telefone num campo não provaria nada.
 */

import { randomInt } from 'crypto'

/** Sem 0/O, 1/I: o código pode ser digitado à mão. 32⁸ ≈ 10¹² combinações. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const TAMANHO = 8
export const VALIDADE_CODIGO_MIN = 15

export function gerarCodigo(): string {
  let codigo = ''
  for (let i = 0; i < TAMANHO; i++) codigo += ALFABETO[randomInt(ALFABETO.length)]
  return codigo
}

/** "ABCDEFGH" → "ABCD-EFGH" (formato exibido e enviado). */
export function formatarCodigo(codigo: string): string {
  return `${codigo.slice(0, 4)}-${codigo.slice(4)}`
}

/**
 * Reconhece uma mensagem de vínculo. Exige a palavra "vincular" ou o formato
 * com hífen: uma palavra comum de 8 letras ("cancelar") não pode ser lida
 * como código no meio de uma conversa.
 */
export function extrairCodigo(texto: string): string | null {
  const t = texto.trim()
  const m =
    t.match(/^vincular\s*:?\s*([a-z2-9]{4})-?([a-z2-9]{4})$/i) ??
    t.match(/^([a-z2-9]{4})-([a-z2-9]{4})$/i)
  if (!m) return null
  const codigo = (m[1] + m[2]).toUpperCase()
  return [...codigo].every(c => ALFABETO.includes(c)) ? codigo : null
}

/** "5511987654321" → "+55 (11) •••••-4321" — o app não precisa exibir o número inteiro. */
export function mascararTelefone(telefone: string | null | undefined): string | null {
  if (!telefone) return null
  const d = telefone.replace(/\D/g, '')
  if (d.length < 4) return null
  const fim = d.slice(-4)
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    return `+55 (${d.slice(2, 4)}) •••••-${fim}`
  }
  return `+${d.slice(0, 2)} •••• ${fim}`
}
