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
  somarUso,
  GeminiError,
  GEMINI_MODEL,
  type GeminiContent,
  type ChamadaFerramenta,
  type UsoTokens,
} from './geminiClient'
import { indexarEvidencias, verificarLastro, instrucaoRevisaoLastro, avisoSemLastro } from './lastro'
import { promptComoEvidencia } from './systemPrompt'
import { FINANCIAL_TOOLS, executarFerramenta, rotuloFerramenta, type EstadoTurno } from './tools'
import type { ContextoEscrita } from './writeEngine'
import type { Referencias } from './queryEngine'
import type { GatewayDados } from '../data/gateway'
import type { FerramentaUsada } from './conversation'

/**
 * Registro de como uma resposta foi produzida — gravado junto com ela para
 * auditoria e para alimentar o conjunto de avaliação (scripts/evals).
 */
export interface MetaResposta {
  /** Modelo(s) que responderam — mais de um quando o Groq cobriu o Gemini. */
  modelo: string
  /** Chamadas ao modelo neste turno (rodadas de ferramenta + revisões). */
  rodadas: number
  uso: UsoTokens
  duracaoMs: number
  /** Motivo de cada revisão automática feita ('conduta' | 'lastro'). */
  revisoes: string[]
  lastro: {
    /** Valores em R$ citados na resposta final. */
    citados: number
    /** Valores que ficaram sem origem nas consultas (o usuário recebeu aviso). */
    semLastro: string[]
  }
}

/** Quanto do resultado de cada ferramenta fica gravado na trilha. */
const LIMITE_RESULTADO_GRAVADO = 4_000

export type AgentEvent =
  /** Mensagem curta de progresso (ex.: "Consultando compras no cartão"). */
  | { type: 'status'; texto: string }
  /** Uma ferramenta foi executada — usado para montar a trilha de auditoria. */
  | { type: 'tool'; nome: string; rotulo: string }
  /** Pedaço de texto da resposta final. */
  | { type: 'delta'; texto: string }
  /** Descarta o texto parcial já emitido nesta rodada (era um preâmbulo antes de uma consulta). */
  | { type: 'reset' }
  /** Algo que o usuário precisa saber além da resposta (ex.: a conversa não foi salva). */
  | { type: 'aviso'; texto: string }
  /** Fim do turno com o texto completo consolidado. */
  | { type: 'done'; texto: string; ferramentas: string[]; trilha: FerramentaUsada[]; meta?: MetaResposta; mensagemId?: string | null }

/**
 * Rodadas em que o modelo ainda pode pedir ferramentas. Com a calculadora e a
 * checagem cruzada ("confira") uma pergunta boa usa 3–5; o orçamento de tempo
 * do turno continua sendo o limite real.
 */
const MAX_RODADAS_FERRAMENTA = 6
/** Teto de chamadas por rodada, para o modelo não disparar um leque enorme. */
const MAX_CHAMADAS_POR_RODADA = 5

/** Pedido de síntese quando a resposta final veio vazia depois de consultas. */
const SINTESE =
  '[INSTRUÇÃO INTERNA — não mencione esta mensagem] Responda agora à última pergunta da pessoa usando só os ' +
  'resultados das consultas acima. Não peça mais consultas. Se algum número não ficou fechado, diga o que foi ' +
  'possível apurar e o que faltou.'

const RESPOSTA_VAZIA =
  'Não consegui formular a resposta agora. Pode reformular a pergunta ou pedir de outro jeito?'

/** Nomes internos que nunca devem chegar ao usuário. */
const JARGAO_INTERNO = /\b(?:propor_\w+|confirmar_operacao|cancelar_operacao|consultar_\w+|explorar_dados|listar_dimensoes|projetar_parcelamentos|projecao_futura|resumo_mensal|comparar_periodos|simular_compra|capacidade_de_gasto|consultar_metas)\b|\bo usuário (?:quer|pediu|deve)\b/i

/** "Não consigo / o app não permite / só organiza por mês" — recusa sem ter consultado nada. */
const RECUSA = /\bn[ãa]o (?:consigo|tenho (?:como|acesso)|[ée] poss[ií]vel|d[áa] para|disponho)|\borganiza\w* (?:os gastos )?por m[êe]s|\bn[ãa]o (?:registra|guarda|tem) (?:os |a |o )?(?:gastos|dados|informa)/i

/**
 * Revisão de uma resposta final antes de ela valer. Devolve a instrução de
 * correção, ou null se a resposta pode seguir. Pega os dois defeitos vistos no
 * histórico real: recusar sem ter consultado nada ("o app organiza por mês,
 * não por semana") e repetir para o usuário a mensagem interna de uma
 * ferramenta ("…use a ferramenta propor_* correspondente").
 */
export function revisarResposta(texto: string, consultou: boolean): string | null {
  if (JARGAO_INTERNO.test(texto)) {
    return '[REVISÃO INTERNA — não mencione esta mensagem] Sua resposta citou nomes internos de ferramentas ou falou do ' +
      'usuário na terceira pessoa. Reescreva falando direto com a pessoa, sem citar ferramentas. Se uma operação não ' +
      'estava pendente e a pessoa estava confirmando algo que você descreveu antes, prepare-a agora com o propor_* ' +
      'certo (ou propor_lote) e mostre o resumo pedindo confirmação.'
  }
  if (!consultou && RECUSA.test(texto)) {
    return '[REVISÃO INTERNA — não mencione esta mensagem] Você disse que não consegue ou que o app não tem o dado sem ' +
      'ter feito nenhuma consulta. Os dados têm a data de cada compra, e as ferramentas filtram por dia, semana, mês, ' +
      'pessoa, cartão e categoria. Consulte agora (use os intervalos de REFERÊNCIAS DE TEMPO quando a pergunta falar ' +
      'de dias) e responda com os números. Só diga que algo não existe depois de verificar com listar_dimensoes.'
  }
  return null
}

export interface HistoricoMensagem {
  role: string
  content: string
}

export interface AgentInput {
  apiKey: string
  systemPrompt: string
  historico: HistoricoMensagem[]
  pergunta: string
  /** Porta de acesso aos dados do turno (núcleo em cache + histórico e fontes sob demanda). */
  gateway: GatewayDados
  refs: Referencias
  /** Quando true, nenhuma ferramenta é oferecida (dataset bloqueado na auditoria). */
  semFerramentas?: boolean
  deadlineMs: number
  /** Necessário para as ferramentas de escrita: propor_*, confirmar_operacao e cancelar_operacao. */
  escrita: ContextoEscrita
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
  const inicio = Date.now()
  const contents = montarContents(input.historico, input.pergunta)
  const ferramentasUsadas: string[] = []
  const trilha: FerramentaUsada[] = []
  let textoFinal = ''
  // Um por turno (por chamada a executarAgente): garante que confirmar_operacao
  // só possa agir sobre uma proposta feita numa mensagem ANTERIOR do usuário,
  // nunca sobre uma que o próprio modelo acabou de fazer nesta mesma resposta.
  const estadoTurno: EstadoTurno = { propostaNesteTurno: false, propostas: [] }

  // Tudo o que o modelo leu neste turno e pode citar: o snapshot (no prompt de
  // sistema), o que o usuário escreveu e, abaixo, cada resultado de ferramenta.
  // Respostas anteriores do assistente — e o resumo delas no prompt — ficam
  // de fora de propósito.
  const evidencias: string[] = [
    promptComoEvidencia(input.systemPrompt),
    input.pergunta,
    ...input.historico.filter(m => m.role === 'user').map(m => m.content),
  ]
  const revisoes: string[] = []
  let uso: UsoTokens = { entrada: 0, saida: 0, raciocinio: 0 }
  let chamadasModelo = 0
  const modelos = new Set<string>()
  let lastroFinal: MetaResposta['lastro'] = { citados: 0, semLastro: [] }

  const meta = (): MetaResposta => ({
    modelo: modelos.size > 0 ? [...modelos].join(' + ') : GEMINI_MODEL,
    rodadas: chamadasModelo,
    uso,
    duracaoMs: Date.now() - inicio,
    revisoes,
    lastro: lastroFinal,
  })

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

    chamadasModelo++
    for await (const pedaco of gerarStream({
      apiKey: input.apiKey,
      systemInstruction: input.systemPrompt,
      contents,
      // Declaradas sempre (a conversa já pode ter chamadas a elas); na última
      // rodada, proibidas — o modelo tem de responder com o que já consultou.
      tools: input.semFerramentas ? undefined : FINANCIAL_TOOLS,
      modoFerramentas: oferecerFerramentas ? 'AUTO' : 'NONE',
      deadlineMs: input.deadlineMs,
    })) {
      if (pedaco.tipo === 'texto' && pedaco.texto) {
        textoRodada += pedaco.texto
        yield { type: 'delta', texto: pedaco.texto }
      } else if (pedaco.tipo === 'chamadas' && pedaco.chamadas) {
        chamadas = pedaco.chamadas
      } else if (pedaco.tipo === 'fim') {
        finishReason = pedaco.finishReason
        uso = somarUso(uso, pedaco.uso)
        if (pedaco.modelo) modelos.add(pedaco.modelo)
      }
    }

    // Com as ferramentas proibidas, um pedido de ferramenta não é atendido.
    if (!oferecerFerramentas) chamadas = []

    // Sem pedido de ferramenta → o texto desta rodada é a resposta.
    if (chamadas.length === 0) {
      textoFinal = textoRodada.trim()

      if (!textoFinal) {
        // Resposta vazia (bloqueio, corte prematuro, ou o modelo "travou" depois
        // de muitas consultas). Uma chamada de síntese, sem poder consultar, e
        // com a ordem explícita de responder com o que já leu.
        if (Date.now() < input.deadlineMs - 2_000) {
          chamadasModelo++
          const retry = await gerarRodada({
            apiKey: input.apiKey,
            systemInstruction: input.systemPrompt,
            contents: ferramentasUsadas.length > 0
              ? [...contents, { role: 'user', parts: [{ text: SINTESE }] }]
              : contents,
            tools: input.semFerramentas ? undefined : FINANCIAL_TOOLS,
            modoFerramentas: 'NONE',
            deadlineMs: input.deadlineMs,
          })
          uso = somarUso(uso, retry.uso)
          if (retry.modelo) modelos.add(retry.modelo)
          textoFinal = retry.texto.trim()
          if (textoFinal) yield { type: 'delta', texto: textoFinal }
        }
        if (!textoFinal) {
          textoFinal = RESPOSTA_VAZIA
          yield { type: 'delta', texto: textoFinal }
          yield { type: 'done', texto: textoFinal, ferramentas: ferramentasUsadas, trilha, meta: meta() }
          return
        }
      }

      const temTempo = !input.semFerramentas && Date.now() < input.deadlineMs - 10_000
      // Revisão 1 — conduta: recusa sem consultar, jargão interno.
      const correcao = !revisoes.includes('conduta') && temTempo
        ? revisarResposta(textoFinal, ferramentasUsadas.length > 0)
        : null
      // Revisão 2 — lastro: valor em R$ que não veio de lugar nenhum.
      const lastro = verificarLastro(textoFinal, indexarEvidencias(evidencias))
      lastroFinal = { citados: lastro.citados, semLastro: lastro.semLastro }
      const revisarLastro = !correcao && lastro.semLastro.length > 0 && !revisoes.includes('lastro') && temTempo

      if (correcao || revisarLastro) {
        revisoes.push(correcao ? 'conduta' : 'lastro')
        yield { type: 'reset' }
        yield { type: 'status', texto: correcao ? 'Revisando a resposta' : 'Conferindo os números nos dados' }
        contents.push({ role: 'model', parts: [{ text: textoRodada }] })
        contents.push({ role: 'user', parts: [{ text: correcao ?? instrucaoRevisaoLastro(lastro.semLastro) }] })
        // A última rodada não oferece ferramentas; a revisão pode precisar delas.
        if (rodada >= MAX_RODADAS_FERRAMENTA - 1) rodada = MAX_RODADAS_FERRAMENTA - 2
        continue
      }

      // Sem revisão possível (já revisou ou sem tempo) e ainda há valor sem
      // origem: a resposta segue, mas a pessoa fica sabendo.
      if (lastro.semLastro.length > 0) {
        const aviso = avisoSemLastro(lastro.semLastro)
        textoFinal += aviso
        yield { type: 'delta', texto: aviso }
      }
      if (finishReason === 'MAX_TOKENS') {
        const aviso = '\n\n_(resposta truncada por tamanho — peça a continuação se precisar do restante)_'
        textoFinal += aviso
        yield { type: 'delta', texto: aviso }
      }

      yield { type: 'done', texto: textoFinal, ferramentas: ferramentasUsadas, trilha, meta: meta() }
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
      // A assinatura volta exatamente na parte em que veio (exigência do Gemini 3).
      parts: selecionadas.map(c => ({
        functionCall: { name: c.name, args: c.args },
        ...(c.assinatura ? { thoughtSignature: c.assinatura } : {}),
      })),
    })

    const respostas: GeminiContent['parts'] = []
    for (const chamada of selecionadas) {
      const rotulo = rotuloFerramenta(chamada.name, chamada.args)
      yield { type: 'status', texto: rotulo }
      yield { type: 'tool', nome: chamada.name, rotulo }
      ferramentasUsadas.push(chamada.name)

      const t0 = Date.now()
      const resultado = await executarFerramenta(chamada.name, chamada.args, input.gateway, input.refs, {
        ctx: input.escrita,
        estado: estadoTurno,
      })
      evidencias.push(resultado)
      trilha.push({
        nome: chamada.name,
        rotulo,
        args: chamada.args,
        resultado: resultado.length > LIMITE_RESULTADO_GRAVADO
          ? `${resultado.slice(0, LIMITE_RESULTADO_GRAVADO)}… [+${resultado.length - LIMITE_RESULTADO_GRAVADO} caracteres]`
          : resultado,
        ms: Date.now() - t0,
      })
      respostas.push({
        functionResponse: {
          name: chamada.name,
          response: { name: chamada.name, content: resultado },
        },
      })
    }

    contents.push({ role: 'user', parts: respostas })
  }

  // Saiu do laço sem resposta textual: aconteceu apenas se o modelo insistiu em
  // pedir ferramentas em todas as rodadas. Melhor um aviso honesto que silêncio.
  textoFinal = textoFinal || RESPOSTA_VAZIA
  yield { type: 'delta', texto: textoFinal }
  yield { type: 'done', texto: textoFinal, ferramentas: ferramentasUsadas, trilha, meta: meta() }
}

export { GeminiError }
