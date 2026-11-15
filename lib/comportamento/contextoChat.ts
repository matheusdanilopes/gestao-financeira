/**
 * A Análise do Fin como contexto do chat.
 *
 * "Conversar com o Fin sobre isso" abria uma conversa do zero: o Fin do chat
 * não sabia o que a análise tinha dito. Agora a primeira pergunta vai com um
 * resumo da análise no campo `dados` de /api/chat — o servidor grava junto da
 * pergunta, então o Fin o enxerga em todas as respostas da conversa, e os
 * valores dele contam como fonte (lastro) para o que o Fin citar.
 *
 * O resumo é texto corrido e compacto: o limite do servidor é 4.000 caracteres.
 * Se passar, as partes menos importantes saem primeiro.
 */

import type { ResultadoAnalise } from './tipos'
import { rotuloJanela } from './tipos'

/** Começo do contexto: identifica, no histórico, a pergunta que levou a análise. */
export const MARCA_CONTEXTO_ANALISE = 'ANÁLISE DO FIN'
/** Separador que o servidor usa entre a pergunta e o contexto (app/api/chat/route.ts). */
export const SEPARADOR_CONTEXTO = '\n\nContexto da tela:\n'
export const LIMITE_CONTEXTO_CHAT = 3_900

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
const brl = (v: number) => BRL.format(Number.isFinite(v) ? v : 0).replace(/\s/g, ' ')

function mesIso(mes: string): string {
  const [a, m] = mes.split('-')
  return `${m}/${a}`
}

export function rotuloAnexoAnalise(r: ResultadoAnalise): string {
  const d = new Date(r.geradaEm)
  return `Análise do Fin de ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
}

export function contextoAnaliseParaChat(r: ResultadoAnalise): string {
  const { analise: a, metricas: m, parametros: p } = r
  const data = new Date(r.geradaEm).toLocaleDateString('pt-BR')
  const quem = p.escopo === 'casal' ? 'do casal' : `de ${p.escopo}`
  const periodo = m.mesFoco
    ? `fatura paga em ${mesIso(m.mesFoco.mes)}${m.mesFoco.periodoCompras ? ` (compras de ${m.mesFoco.periodoCompras.inicio} a ${m.mesFoco.periodoCompras.fim}; o cartão conta pela fatura, não pela data da compra)` : ''}, comparada com os ${m.mesFoco.mesesBase} meses anteriores`
    : `${mesIso(m.periodo.inicio)} a ${mesIso(m.periodo.fim)}`

  // Em ordem de importância: o fim da lista é o primeiro a sair se não couber.
  const blocos: string[] = [
    `${MARCA_CONTEXTO_ANALISE} (feita por você, Fin, em ${data}; ${rotuloJanela(p.janela)}, ${periodo}, gastos ${quem}). ` +
      'Use como ponto de partida desta conversa; para números de hoje ou de outro período, consulte os dados.',
    `Recado: ${a.manchete} ${a.resumo}`.trim(),
    `Nota de saúde financeira: ${m.saude.nota}/100. ` +
      m.saude.indicadores.map(i => `${i.nome}: ${i.medida} (nota ${i.nota})`).join('; ') + '.',
    a.planoDeAcao.length
      ? 'Dicas dadas: ' + a.planoDeAcao.map((d, i) =>
          `${i + 1}) ${d.acao}${d.economiaMensal > 0 ? ` — economia ${brl(d.economiaMensal)}/mês` : ''}${d.regra ? ` [${d.regra}]` : ''}`,
        ).join(' ')
      : '',
    m.proximoMes
      ? `Próximo mês (${mesIso(m.proximoMes.mes)}): livre ${brl(m.proximoMes.margemLivre)} depois de contas, parcelas e assinaturas; ` +
        `teto de ${brl(m.proximoMes.tetoSemanal)} por semana em compras novas; num mês normal ${m.proximoMes.folga >= 0 ? 'sobram' : 'faltam'} ${brl(Math.abs(m.proximoMes.folga))}.`
      : '',
    a.padroes.length ? 'Descobertas: ' + a.padroes.map(x => `${x.titulo} (${x.destaque}): ${x.descricao}`).join(' ') : '',
    `Médias por mês: receita ${brl(m.resumo.receitaMedia)}, gasto ${brl(m.resumo.gastoMedio)}, ` +
      `${m.resumo.saldoMedio >= 0 ? 'sobra' : 'falta'} ${brl(Math.abs(m.resumo.saldoMedio))}; ${m.resumo.mesesNoVermelho} meses no vermelho.`,
    a.perfil.nome ? `Perfil: ${a.perfil.nome}. ${a.perfil.descricao}`.trim() : '',
    a.riscos.length ? 'Riscos: ' + a.riscos.map(x => `${x.titulo}: ${x.descricao}`).join(' ') : '',
    a.metas.length ? 'Metas: ' + a.metas.map(x => `${x.meta} — ${x.alvo} (${x.prazo})`).join('; ') : '',
  ].filter(Boolean)

  let texto = blocos.join('\n')
  while (texto.length > LIMITE_CONTEXTO_CHAT && blocos.length > 2) {
    blocos.pop()
    texto = blocos.join('\n')
  }
  return texto.slice(0, LIMITE_CONTEXTO_CHAT)
}

/**
 * Separa a pergunta do contexto anexado, para o balão mostrar só o que a
 * pessoa escreveu (o histórico gravado tem os dois juntos).
 */
export function separarContexto(conteudo: string): { texto: string; anexo?: string } {
  const i = conteudo.indexOf(SEPARADOR_CONTEXTO)
  if (i < 0) return { texto: conteudo }
  const contexto = conteudo.slice(i + SEPARADOR_CONTEXTO.length)
  return {
    texto: conteudo.slice(0, i),
    anexo: contexto.startsWith(MARCA_CONTEXTO_ANALISE) ? 'Análise do Fin' : 'Dados da tela',
  }
}
