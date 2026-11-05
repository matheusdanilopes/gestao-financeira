/**
 * Próximos passos sugeridos depois de uma resposta do assistente.
 *
 * Antes os chips eram sempre os mesmos cinco, qualquer que fosse o assunto —
 * o que denunciava a "máquina" do outro lado. Aqui eles seguem o que acabou de
 * ser dito: se o assistente pediu confirmação, a resposta natural é "sim" ou
 * "não"; se falou de parcelas, a pergunta seguinte provável é quando acabam.
 */

export interface SugestoesResposta {
  /** O assistente está esperando um sim/não (proposta de operação). */
  confirmacao: boolean
  chips: string[]
}

const MAX_CHIPS = 4

const GENERICAS = [
  'O que está puxando esse número?',
  'Como foi no mês passado?',
  'O que dá para cortar?',
  'E nos próximos meses?',
]

/** Assunto da resposta → perguntas que costumam vir em seguida. */
const POR_ASSUNTO: Array<{ re: RegExp; chips: string[] }> = [
  { re: /parcel/i, chips: ['Quando acabam as parcelas?', 'Quanto de parcela no mês que vem?'] },
  { re: /assinatura/i, chips: ['Dá para cancelar alguma assinatura?', 'Quanto gasto por ano com assinaturas?'] },
  { re: /\bmeta|or[çc]amento|limite/i, chips: ['Quanto ainda posso gastar?', 'Qual categoria está mais perto do limite?'] },
  { re: /venc|atrasad|em aberto|a pagar/i, chips: ['O que vence esta semana?', 'Quanto falta pagar este mês?'] },
  { re: /categoria/i, chips: ['Detalhe a maior categoria', 'Qual categoria mais cresceu?'] },
  { re: /investimento|aporte|carteira/i, chips: ['Como está minha carteira?', 'Quanto aportei este ano?'] },
  { re: /receita|sal[áa]rio|recebi/i, chips: ['Quanto sobrou depois das contas?', 'Ainda falta receber algo?'] },
  { re: /fatura|cart[ãa]o/i, chips: ['Quem gastou mais no cartão?', 'Compare com a fatura passada'] },
  { re: /mercado|lista/i, chips: ['O que tem na lista de mercado?', 'Quanto gastei no mercado este mês?'] },
]

/**
 * Proposta pendente: o resumo termina pedindo confirmação. O prompt manda o
 * modelo sempre perguntar se a pessoa confirma depois de um propor_*.
 */
const PEDE_CONFIRMACAO = /\b(confirm[ao]s?|posso (?:lan[çc]ar|registrar|adicionar|incluir|gravar|seguir)|quer que eu (?:lance|registre|adicione|inclua)|(?:lan[çc]o|registro|adiciono|incluo)\?)/i

function ultimoParagrafo(texto: string): string {
  const partes = texto.trim().split(/\n\s*\n/)
  return partes[partes.length - 1] ?? ''
}

export function sugestoesParaResposta(respostaCompleta: string): SugestoesResposta {
  // O assunto é o texto que a pessoa leu, não os rótulos do JSON do gráfico.
  const resposta = respostaCompleta.replace(/```grafico[\s\S]*?(?:```|$)/g, '')
  const fim = ultimoParagrafo(resposta)
  if (fim.includes('?') && PEDE_CONFIRMACAO.test(fim)) {
    return { confirmacao: true, chips: ['Sim, pode confirmar', 'Não, cancela'] }
  }

  const escolhidas: string[] = []
  for (const { re, chips } of POR_ASSUNTO) {
    if (!re.test(resposta)) continue
    for (const c of chips) if (!escolhidas.includes(c)) escolhidas.push(c)
    if (escolhidas.length >= MAX_CHIPS) break
  }
  for (const c of GENERICAS) {
    if (escolhidas.length >= MAX_CHIPS) break
    if (!escolhidas.includes(c)) escolhidas.push(c)
  }
  return { confirmacao: false, chips: escolhidas.slice(0, MAX_CHIPS) }
}

/** "Bom dia" / "Boa tarde" / "Boa noite" pela hora local. */
export function saudacaoDoHorario(agora = new Date()): string {
  const h = agora.getHours()
  if (h >= 5 && h < 12) return 'Bom dia'
  if (h >= 12 && h < 18) return 'Boa tarde'
  return 'Boa noite'
}
