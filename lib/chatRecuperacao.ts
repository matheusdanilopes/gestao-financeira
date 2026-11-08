/**
 * Recuperação da resposta do Fin quando a conexão cai no meio do turno.
 *
 * No celular, sair do app (trocar de aplicativo, bloquear a tela) derruba a
 * conexão. Com respostas de 30–60 s isso virou o "Falha de conexão" mais
 * comum. O servidor termina o turno e grava a resposta mesmo assim
 * (app/api/chat/route.ts); o app só precisa buscá-la no histórico.
 */

export interface MensagemHistorico {
  role: string
  content: string
}

/** Tempo máximo procurando a resposta depois que a conexão caiu (o turno tem até 75 s). */
export const RECUPERACAO_MS = 100_000
/** Intervalo entre as buscas no histórico. */
export const INTERVALO_RECUPERACAO_MS = 3_000
/** Sem nenhum evento (nem o ping de 8 s) por este tempo, a conexão está morta. */
export const SEM_SINAL_MS = 20_000

/**
 * A pergunta foi gravada e já tem resposta depois dela? O servidor grava a
 * pergunta com o "Contexto da tela" anexado, por isso compara pelo começo.
 */
export function respostaNoHistorico(historico: MensagemHistorico[], pergunta: string): boolean {
  const p = pergunta.trim()
  if (!p) return false
  let iPergunta = -1
  for (let i = historico.length - 1; i >= 0; i--) {
    if (historico[i].role === 'user' && historico[i].content.trim().startsWith(p)) { iPergunta = i; break }
  }
  return iPergunta >= 0 && historico.slice(iPergunta + 1).some(m => m.role === 'assistant' && m.content.trim() !== '')
}

/**
 * Busca o histórico até a resposta aparecer, o prazo acabar ou `continuar`
 * dizer que não vale mais a pena (outra conversa aberta, usuário cancelou).
 */
export async function aguardarResposta<T extends MensagemHistorico>(
  buscar: () => Promise<T[]>,
  pergunta: string,
  continuar: () => boolean,
  opcoes: { prazoMs?: number; intervaloMs?: number; visivel?: () => boolean; esperar?: (ms: number) => Promise<void> } = {}
): Promise<T[] | null> {
  const limite = Date.now() + (opcoes.prazoMs ?? RECUPERACAO_MS)
  const esperar = opcoes.esperar ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const visivel = opcoes.visivel ?? (() => true)
  while (Date.now() < limite && continuar()) {
    // Em segundo plano o navegador congela a rede: busca só com o app à vista.
    if (visivel()) {
      try {
        const historico = await buscar()
        if (respostaNoHistorico(historico, pergunta)) return historico
      } catch { /* rede ainda instável: tenta de novo */ }
    }
    await esperar(opcoes.intervaloMs ?? INTERVALO_RECUPERACAO_MS)
  }
  return null
}
