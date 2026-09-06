/**
 * Loop do agente financeiro.
 *
 * Um turno = várias rodadas com o modelo. Em cada rodada ele pode pedir
 * ferramentas (consultas aos dados reais); executamos, devolvemos o resultado
 * e chamamos de novo. Quando ele produz texto sem pedir mais nada, aquele texto
 * é a resposta e vai em streaming para a tela.
 *
 * Diferenças em relação à implementação anterior, que era a causa dos "não
 * consigo acessar esse dado":
 *  - Ferramentas disponíveis desde a PRIMEIRA mensagem (antes só em follow-ups).
 *  - Várias rodadas de consulta por turno (antes, no máximo uma).
 *  - Nenhum roteador de intenção por regex decidindo o que o modelo pode ver.
 *  - Orçamento de tempo compartilhado, então o turno degrada com uma resposta
 *    parcial em vez de estourar o limite da função e morrer sem JSON.
 */

import {
  gerarStream,
  gerarRodada,
  GeminiError,
  type GeminiContent,
  type ChamadaFerramenta,
} from './geminiClient'
import { FINANCIAL_TOOLS, executarFerramenta, rotuloFerramenta } from './tools'
import type { Referencias } from './queryEngine'
import type { EnrichedData } from '../types'

export type AgentEvent =
  /** Mensagem curta de progresso (ex.: "Consultando compras no cartão"). */
  | { type: 'status'; texto: string }
  /** Uma ferramenta foi executada — usado para montar a trilha de auditoria. */
  | { type: 'tool'; nome: string; rotulo: string }
  /** Pedaço de texto da resposta final. */
  | { type: 'delta'; texto: string }
  /** Descarta o texto parcial já emitido nesta rodada (era um preâmbulo antes de uma consulta). */
  | { type: 'reset' }
  /** Fim do turno com o texto completo consolidado. */
  | { type: 'done'; texto: string; ferramentas: string[] }

/** Rodadas em que o modelo ainda pode pedir ferramentas. */
const MAX_RODADAS_FERRAMENTA = 4
/** Teto de chamadas por rodada, para o modelo não disparar um leque enorme. */
const MAX_CHAMADAS_POR_RODADA = 4

const RESPOSTA_VAZIA =
  'Não consegui formular a resposta agora. Pode reformular a pergunta ou pedir de outro jeito?'

export interface HistoricoMensagem {
  role: string
  content: string
}

export interface AgentInput {
  apiKey: string
  systemPrompt: string
  historico: HistoricoMensagem[]
  pergunta: string
  data: EnrichedData
  refs: Referencias
  /** Quando true, nenhuma ferramenta é oferecida (dataset bloqueado na auditoria). */
  semFerramentas?: boolean
  deadlineMs: number
}

function montarContents(historico: HistoricoMensagem[], pergunta: string): GeminiContent[] {
  const contents: GeminiContent[] = historico
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: m.content }],
    }))
  contents.push({ role: 'user', parts: [{ text: pergunta }] })
  return contents
}

export async function* executarAgente(input: AgentInput): AsyncGenerator<AgentEvent> {
  const contents = montarContents(input.historico, input.pergunta)
  const ferramentasUsadas: string[] = []
  let textoFinal = ''

  for (let rodada = 0; rodada <= MAX_RODADAS_FERRAMENTA; rodada++) {
    const tempoEsgotado = Date.now() >= input.deadlineMs - 3_000
    // Na última rodada (ou sem tempo) tiramos as ferramentas: isso obriga o
    // modelo a responder com o que já tem, em vez de pedir mais uma consulta
    // que não caberia no orçamento.
    const oferecerFerramentas =
      !input.semFerramentas && rodada < MAX_RODADAS_FERRAMENTA && !tempoEsgotado

    let textoRodada = ''
    let chamadas: ChamadaFerramenta[] = []
    let finishReason: string | undefined

    for await (const pedaco of gerarStream({
      apiKey: input.apiKey,
      systemInstruction: input.systemPrompt,
      contents,
      tools: oferecerFerramentas ? FINANCIAL_TOOLS : undefined,
      deadlineMs: input.deadlineMs,
    })) {
      if (pedaco.tipo === 'texto' && pedaco.texto) {
        textoRodada += pedaco.texto
        yield { type: 'delta', texto: pedaco.texto }
      } else if (pedaco.tipo === 'chamadas' && pedaco.chamadas) {
        chamadas = pedaco.chamadas
      } else if (pedaco.tipo === 'fim') {
        finishReason = pedaco.finishReason
      }
    }

    // Sem pedido de ferramenta → o texto desta rodada é a resposta.
    if (chamadas.length === 0) {
      textoFinal = textoRodada.trim()

      if (!textoFinal) {
        // Resposta vazia (bloqueio de segurança, corte prematuro). Uma nova
        // tentativa sem ferramentas costuma resolver; se não, avisamos.
        if (oferecerFerramentas) {
          const retry = await gerarRodada({
            apiKey: input.apiKey,
            systemInstruction: input.systemPrompt,
            contents,
            deadlineMs: input.deadlineMs,
          })
          textoFinal = retry.texto.trim()
          if (textoFinal) yield { type: 'delta', texto: textoFinal }
        }
        if (!textoFinal) {
          textoFinal = RESPOSTA_VAZIA
          yield { type: 'delta', texto: textoFinal }
        }
      } else if (finishReason === 'MAX_TOKENS') {
        const aviso = '\n\n_(resposta truncada por tamanho — peça a continuação se precisar do restante)_'
        textoFinal += aviso
        yield { type: 'delta', texto: aviso }
      }

      yield { type: 'done', texto: textoFinal, ferramentas: ferramentasUsadas }
      return
    }

    // Houve pedido de ferramenta: o texto emitido nesta rodada era só um
    // preâmbulo ("vou verificar…"). Descartamos na tela e usamos como status.
    if (textoRodada.trim()) {
      yield { type: 'reset' }
      const preambulo = textoRodada.trim().replace(/\s+/g, ' ').slice(0, 90)
      if (preambulo.length > 8) yield { type: 'status', texto: preambulo }
    }

    const selecionadas = chamadas.slice(0, MAX_CHAMADAS_POR_RODADA)

    contents.push({
      role: 'model',
      parts: selecionadas.map(c => ({ functionCall: { name: c.name, args: c.args } })),
    })

    const respostas: GeminiContent['parts'] = []
    for (const chamada of selecionadas) {
      const rotulo = rotuloFerramenta(chamada.name, chamada.args)
      yield { type: 'status', texto: rotulo }
      yield { type: 'tool', nome: chamada.name, rotulo }
      ferramentasUsadas.push(chamada.name)

      const resultado = executarFerramenta(chamada.name, chamada.args, input.data, input.refs)
      respostas.push({
        functionResponse: {
          name: chamada.name,
          response: { name: chamada.name, content: resultado },
        },
      })
    }

    contents.push({ role: 'function', parts: respostas })
  }

  // Saiu do laço sem resposta textual: aconteceu apenas se o modelo insistiu em
  // pedir ferramentas em todas as rodadas. Melhor um aviso honesto que silêncio.
  textoFinal = textoFinal || RESPOSTA_VAZIA
  yield { type: 'delta', texto: textoFinal }
  yield { type: 'done', texto: textoFinal, ferramentas: ferramentasUsadas }
}

export { GeminiError }
