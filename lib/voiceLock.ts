'use client'

/**
 * Mutex simples do microfone do navegador. Duas fontes de escuta convivem no
 * app — o "Hey Gestor" em segundo plano (lib/useWakeWord.ts) e a escuta sob
 * demanda do botão de microfone (lib/useVoice.ts) — e o Web Speech API não
 * lida bem com duas instâncias de reconhecimento ativas ao mesmo tempo. Quem
 * vai falar de fato (usuário tocando o botão, ou o wake word entregando a
 * pergunta) reivindica o microfone; o wake word observa essa mudança e para
 * de ouvir em segundo plano enquanto ele estiver ocupado.
 */

let ocupado = false
const ouvintes = new Set<() => void>()

export function microfoneOcupado(): boolean {
  return ocupado
}

export function ocuparMicrofone(): void {
  if (ocupado) return
  ocupado = true
  ouvintes.forEach(fn => fn())
}

export function liberarMicrofone(): void {
  if (!ocupado) return
  ocupado = false
  ouvintes.forEach(fn => fn())
}

/** Chamado sempre que o microfone é ocupado ou liberado. Devolve a função de cancelar. */
export function aoMudarMicrofone(fn: () => void): () => void {
  ouvintes.add(fn)
  return () => ouvintes.delete(fn)
}
