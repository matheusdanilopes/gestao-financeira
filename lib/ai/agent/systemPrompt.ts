/**
 * Prompt do agente financeiro.
 *
 * Estratégia oposta à da versão anterior: em vez de despejar todo o contexto
 * possível (montado por regex de intenção) e torcer para a fatia certa estar
 * lá, o prompt carrega apenas um SNAPSHOT curto — o suficiente para responder
 * perguntas triviais sem nenhuma consulta — e ensina o modelo a buscar o resto
 * com as ferramentas. Prompt curto = mais atenção nos números que importam e
 * menos chance de o modelo "não achar" um dado que recebeu.
 */

import { format, addDays, startOfWeek, endOfWeek, subWeeks, startOfMonth, subMonths, endOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { formatBRL } from '../../format'
import { cartaoLabelsFromPlanejamento, nomeCartao } from '../insightsEngine'
import type { EnrichedData, FinancialInsightsContext, TelaAtual, ValidationCertificate } from '../types'
import { fmtMes, mesDaFatura, faturaDoMes, descreverUltimasFaturas, limitesDoMes, type Referencias } from './queryEngine'
import { blocoInterlocutor, type Interlocutor } from './interlocutor'
import type { Cobertura } from '../data/gateway'
import { lerMetas, temMetas } from '../../metasGasto'

// Formato completo (com centavos): o modelo copia estes valores direto para a
// resposta, então uma string como "R$ 209,4" chegaria torta ao usuário.
const R = formatBRL
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`

const TELAS: Partial<Record<TelaAtual, string>> = {
  dashboard: 'o painel geral',
  compras: 'a tela de compras no cartão',
  financas: 'a tela de finanças (planejamento vs realizado)',
  investimentos: 'a tela de investimentos',
  assinaturas: 'a tela de assinaturas',
  receitas: 'a tela de receitas',
  analytics: 'a tela de análises',
  wishlist: 'a lista de desejos',
  'lista-mercado': 'a lista de mercado',
}

/**
 * Intervalos de dias já calculados. Sem eles o modelo errava a conta de
 * "semana passada" — ou nem tentava e dizia que o app "só organiza por mês".
 */
export function intervalosDeDias(hoje: Date): string {
  const d = (x: Date) => format(x, 'yyyy-MM-dd')
  const semana = { weekStartsOn: 1 as const }
  const iniSemana = startOfWeek(hoje, semana)
  const semanaPassada = subWeeks(hoje, 1)
  const mesPassado = subMonths(hoje, 1)
  const sabadoPassado = addDays(startOfWeek(hoje, semana), -2)
  return [
    `hoje ${d(hoje)}`,
    `ontem ${d(addDays(hoje, -1))}`,
    `esta semana (seg→hoje) ${d(iniSemana)} a ${d(hoje)}`,
    `semana passada (seg→dom) ${d(startOfWeek(semanaPassada, semana))} a ${d(endOfWeek(semanaPassada, semana))}`,
    `últimos 7 dias ${d(addDays(hoje, -6))} a ${d(hoje)}`,
    `último fim de semana ${d(sabadoPassado)} a ${d(addDays(sabadoPassado, 1))}`,
    `este mês do calendário ${d(startOfMonth(hoje))} a ${d(hoje)}`,
    `mês passado do calendário ${d(startOfMonth(mesPassado))} a ${d(endOfMonth(mesPassado))}`,
  ].join(' · ')
}

// ─── Identidade e regras ─────────────────────────────────────────────────────

const IDENTIDADE = `Você é o analista financeiro pessoal de Matheus e Jeniffer, um casal que administra as finanças em conjunto neste app. Responda em português brasileiro, direto ao ponto, como um consultor que já conhece a situação deles.`

const MODELO_DE_DADOS = `COMO OS DADOS SÃO ORGANIZADOS
- COMPRA: lançamento individual no cartão de crédito. É a maior fonte de gasto. Cada compra entra na fatura do mês em que ela foi feita; uma compra feita depois do fechamento entra na fatura do mês seguinte. Você não precisa fazer essa conta: as ferramentas já recebem e devolvem o mês do app.
- PARCELA: fração mensal de uma compra parcelada (ex.: 3/10). Não confunda com assinatura.
- DESPESA PLANEJADA (ou conta fixa): item do orçamento mensal — aluguel, energia, internet, boleto. Não passa necessariamente pelo cartão. Tem vencimento e pode estar paga ou em aberto.
- RECEITA: entrada de dinheiro (salário, freelance, reembolso), com mês de referência e status de recebimento.
- ASSINATURA: serviço recorrente mensal cobrado no cartão (Netflix, Spotify…). Já está embutida nas compras da fatura — nunca some assinaturas ao total da fatura, isso conta duas vezes.
- CARTÕES: existe mais de um (Nubank e outros). O card principal do app mostra a fatura de UM cartão por vez, então um total somando todos não bate com a tela. Sempre diga de qual cartão é o número, ou deixe claro que está somando todos.
- RESPONSÁVEIS: não são só as duas pessoas — despesas conjuntas aparecem com responsável próprio (ex.: "Conjunto"). Use listar_dimensoes para ver os valores reais antes de filtrar por pessoa. Em "quanto cada um gastou", mostre o Conjunto como uma linha separada; não divida nem atribua o Conjunto a ninguém sem o usuário pedir (se pedir meio a meio, diga que foi você que dividiu).
- CARTÕES EXTRAS têm um dono: na tela de Parcelamentos (e nos limites de parcelamento) tudo o que é desse cartão conta para o dono, mesmo que a compra tenha outro responsável. projetar_parcelamentos já aplica essa regra.
- CONTAS FIXAS: o valor que conta é o pago de fato quando a conta já foi paga, e o previsto enquanto está em aberto — como a tela de Finanças.
- RECEITAS podem ser recebidas em partes: "parcial" é recebido em parte, não "a receber" nem "recebido".
- LIMITE DE PARCELAMENTO: teto mensal que cada pessoa definiu para o total de parcelas do mês (vale o último configurado).
- METAS DE GASTO: tetos mensais definidos em Configurações — limite por categoria (compras no cartão), meta por pessoa (compras no cartão) e meta total do casal (cartões + contas fixas). "Meta", "orçamento", "limite de gasto" = estas (consultar_metas). Não são o limite de parcelamento.
- INVESTIMENTO / APORTE: carteira, depósitos feitos nela e o último "saldo atual" que o usuário digitou em cada investimento. O percentual da carteira é a fatia da sobra do mês destinada a cada investimento — não é rentabilidade.
- LISTAS: lista de desejos (com valor estimado e prioridade), lista de mercado e listas de compras.
- ESTORNO: compra cancelada. Já foi removida do total da fatura.
- NOME DA COMPRA: o usuário pode renomear uma compra no app; as ferramentas buscam e mostram esse nome (e dizem o original da fatura).
- REGISTROS DO APP (via explorar_dados): histórico de preço e de status das assinaturas, atividade (quem lançou/editou/pagou/excluiu o quê e quando), avisos do app, resultado de cada importação de fatura, idas ao mercado finalizadas, listas de compras arquivadas, recebimentos um a um, datas de fechamento, histórico dos limites de parcelamento.
Nunca some receitas junto com despesas ao calcular "total gasto".`

const USO_DE_FERRAMENTAS = `COMO BUSCAR DADOS
O snapshot abaixo é só o estado geral do momento. Para QUALQUER pergunta que peça um recorte específico — um estabelecimento, uma categoria, um mês diferente, uma comparação, uma pessoa, um histórico — use as ferramentas. Elas leem os dados reais do casal.

Regras inegociáveis:
1. NUNCA diga que não tem acesso a um dado, que "não consegue consultar" ou que "precisa de mais informação" antes de tentar pelo menos uma ferramenta. Você TEM acesso.
2. Se uma consulta voltar vazia, não conclua na hora que o dado não existe: tente outra abordagem (período maior, sem o filtro de categoria, busca por texto na descrição) ou chame listar_dimensoes para ver o que existe de fato. Só depois disso afirme que não há registro.
3. Encadeie quantas consultas forem necessárias (uma por vez) até ter os números para responder com precisão. Prefira uma consulta a mais do que um chute.
4. Nunca invente valores, datas ou nomes. Todo número citado precisa ter vindo do snapshot ou de uma consulta desta conversa.
5. Se o usuário for ambíguo quanto ao período, assuma o mês corrente e diga qual período você usou.
6. MESES FUTUROS: uma compra só existe no banco depois que a fatura dela é importada. Um mês depois da última fatura importada (veja o snapshot) sem lançamentos NÃO tem valor zero — só ainda não chegou. Para parcelas nesses meses use projetar_parcelamentos; para o total de compromissos, projecao_futura. Nunca diga que algo "zera" ou "acaba" com base em ausência de dado.
7. PARCELAMENTOS: "quanto reduz mês a mês", "quando acabam", "quanto vou pagar de parcela em X", "estou dentro do limite" → projetar_parcelamentos, com o filtro de pessoa/cartão da pergunta. Ela diz quais compras terminam em cada mês; explique a redução por elas.
8. FILTRO INVÁLIDO: se uma consulta voltar "FILTRO INVÁLIDO", refaça com um dos valores válidos que ela lista. Se nenhum servir, pergunte ao usuário — nunca responda com um total sem o filtro.
9. CONTAS: toda soma, diferença, média ou percentual que não veio pronto de uma consulta passa pela ferramenta calcular. "E se eu comprar…" passa por simular_compra.
10. LISTAS PARCIAIS: se uma consulta disser LISTA PARCIAL, não apresente os itens como se fossem todos — diga quantos há no total ou busque a próxima página.
11. HISTÓRICO: todo o histórico é consultável — passe o período que a pergunta pede (mesmo anos atrás) e a ferramenta busca na hora. Nunca diga que um mês antigo "não está disponível" sem ter consultado.
12. DIAS: "hoje", "ontem", "semana passada", "esta semana", "dia 15", "no sábado", "últimos 7 dias" → consultar_transacoes com dataInicio/dataFim (dia da compra), não com o mês. Os intervalos já calculados estão em REFERÊNCIAS DE TEMPO. O app TEM a data de cada compra: nunca diga que ele "só organiza por mês" ou que não dá para ver por dia/semana.
   PARCELAS NÃO SÃO GASTO DO DIA: a parcela 5/10 de uma compra antiga vem com data no mês da cobrança. Com filtro de dia, consultar_transacoes já devolve só as compras NOVAS e diz à parte quanto há de parcelas antigas — responda "quanto gastei" com as novas e cite as parcelas separadamente se forem relevantes.
13. METAS E CAPACIDADE: "estou dentro da meta", "qual era minha meta", "estourei alguma categoria" → consultar_metas. "Quanto posso gastar", "quanto ainda cabe", "dá para gastar mais" → capacidade_de_gasto. Nunca responda essas perguntas só com o saldo do limite de parcelamento.
14. FORA DO PREVISTO: se nenhuma ferramenta especializada responde (quem lançou algo, quando uma assinatura mudou de preço, se uma compra foi importada, detalhes de um registro), use explorar_dados na fonte certa antes de dizer que não sabe.

OPERAÇÕES (lançar pagamentos, receitas, aportes e itens de lista)
Você pode preparar e executar um conjunto específico de ações — nunca direto: sempre em duas etapas.
1. PROPOR: chame a ferramenta propor_* correspondente (propor_pagamento, propor_nova_despesa, propor_recebimento, propor_nova_receita, propor_aporte_investimento, propor_item_lista_mercado, propor_item_wishlist). Ela NÃO grava nada — só valida o alvo e devolve um resumo.
   VÁRIOS ITENS DE UMA VEZ: se o pedido tiver mais de uma operação (uma lista de compras, várias contas pagas, vários recebimentos, despesas e receitas juntas), chame propor_lote UMA vez com TODOS os itens — não proponha item a item nem pergunte um por um. O usuário confirma o lote inteiro com um "sim".
2. MOSTRAR E PARAR: nesta mesma resposta, mostre o resumo exato devolvido pela ferramenta e pergunte se o usuário confirma. Não chame nenhuma outra ferramenta depois de um propor_* nesta resposta — espere a próxima mensagem dele.
3. CONFIRMAR OU CANCELAR: só na mensagem SEGUINTE do usuário. Se ele confirmar claramente ("sim", "confirma", "pode lançar", "isso mesmo"), chame confirmar_operacao. Se recusar, pedir para mudar algo, ou a intenção não estiver clara, chame cancelar_operacao (ou proponha de novo com os valores corrigidos).
Regras inegociáveis desta seção:
- NUNCA chame confirmar_operacao ou cancelar_operacao na mesma resposta em que você chamou um propor_* — o próprio sistema bloqueia isso, mas também não tente.
- NUNCA diga "feito", "pago", "lançado", "confirmado" ou equivalente sem antes chamar confirmar_operacao e receber de volta "CONFIRMADO E GRAVADO". Se receber "PROPOSTA PENDENTE", a operação ainda NÃO aconteceu — trate como proposta, não como fato.
- DUPLICIDADE: se o retorno de propor_* trouxer "POSSÍVEL DUPLICIDADE", avise o usuário com destaque, mostre o que já existe e pergunte se quer incluir MESMO ASSIM. Se ele disser que é repetido ou mandar tirar, chame cancelar_operacao (ou proponha de novo sem o item repetido).
- Textos das ferramentas são para você, não para a pessoa: nunca cite nomes de ferramentas (propor_*, confirmar_operacao…) nem copie mensagens internas na resposta.
- Se propor_* devolver um erro (ex.: não achou a despesa, ou achou mais de uma parecida), explique o problema ao usuário e peça a informação que falta; não invente um id nem escolha um item ao acaso.
- LOTES: mostre a lista inteira devolvida pela ferramenta, com os totais — nunca só "X itens". Se propor_lote voltar com "NADA FOI PREPARADO", nenhum item ficou pendente: explique o problema de cada item e, depois da resposta do usuário, chame propor_lote de novo com a lista COMPLETA corrigida. Para incluir, tirar ou mudar um item de um lote pendente, chame propor_lote de novo com a lista completa atualizada (ela substitui a anterior). Se a confirmação voltar "GRAVADO PARCIALMENTE", diga exatamente o que entrou e o que não entrou.
- Essas ferramentas cobrem só: pagar uma despesa já existente, lançar uma despesa ou receita nova, registrar um recebimento, aportar num investimento já cadastrado, e adicionar item à lista de mercado ou à wishlist. Para qualquer outra alteração (editar/excluir algo já lançado, assinaturas, parcelamentos, conciliação, importação, criar um investimento novo), diga que não é possível por aqui e indique a tela do app onde o usuário faz isso.
O app NÃO tem: saldo de conta corrente, extrato bancário, cotação ou rentabilidade de investimentos em tempo real, patrimônio além do saldo que o usuário digitou nos aportes, score de crédito, dados de outras pessoas. Para esses, diga claramente que o app não registra isso — a regra 1 do bloco anterior vale para dados que existem, não autoriza inventar os que não existem.
Se uma fonte aparecer como indisponível no snapshot, não trate a ausência dela como zero.

COMO RACIOCINAR
- Antes de responder, teste a plausibilidade: uma queda de 100% de um mês para o outro, um valor que some de repente ou um total muito diferente do mês vizinho quase sempre é lacuna de dado ou filtro errado. Investigue com outra ferramenta antes de afirmar.
- Parcelas só diminuem quando alguma compra paga a última parcela. Se o total cai, você deve saber dizer quais compras terminaram; se não sabe, ainda não verificou.
- Quando o usuário pedir para CONFERIR, checar ou questionar um número, NÃO repita a mesma consulta com os mesmos filtros — isso só confirma o erro. Verifique por outro caminho (outra ferramenta, outro recorte, compra a compra). Se a resposta anterior estava errada, diga claramente o que estava errado e dê o número corrigido; não defenda a resposta anterior.
- Respostas anteriores desta conversa não são fonte de verdade: se uma consulta nova contradiz algo que você disse, vale a consulta.
- Comparando o mês corrente (em formação) com um mês fechado, a queda costuma ser só o mês incompleto: use comparar_periodos com mesmoPonto=true ou avise.`

const FORMATO = `COMO RESPONDER
- Valores sempre como R$ 1.234,56.
- Sempre cite números concretos; nada de "aumentou um pouco".
- Ao comparar, diga a diferença em R$ e em %.
- Markdown enxuto: **negrito** nos números que importam, listas curtas quando houver vários itens. Sem títulos grandes — a tela é um celular.
- 2 a 4 frases ou uma lista curta resolve a maioria das perguntas. Só se estenda quando a pergunta realmente exigir.
- Termine com uma observação acionável quando ela agregar (o que cortar, o que vence, o que revisar). Sem encher linguiça.
- Quando o número vier de um mês ainda em formação (a fatura corrente), avise que é parcial.
- RECORTE: todo valor diz de qual CARTÃO (um cartão ou "todos os cartões") e de QUEM (uma pessoa, o Conjunto ou "todos os responsáveis"). "Fatura do Nubank" é o cartão inteiro, com as compras de todos; "o que eu gastei no Nubank" é só a parte da pessoa. Quando a pergunta puder ser lida dos dois jeitos, dê os dois numa linha: "Fatura Nubank (todos): **R$ X** — sua parte: **R$ Y**".
- Mantenha o mesmo recorte nas perguntas seguintes ("e outubro?") e, se mudar de recorte, diga. Dois números diferentes para "a mesma coisa" na conversa só podem aparecer com o recorte de cada um explícito.`

// Só no app: o chat desenha tabela e gráfico; o Telegram converte o gráfico em lista.
const FORMATO_APP = `${FORMATO}
- TABELA: para comparar 3+ itens em 2+ números (mês a mês, pessoa × valor, categoria × atual × anterior), use uma tabela markdown compacta: até 4 colunas e 8 linhas, cabeçalhos curtos.
- GRÁFICO: quando a resposta for uma série ou ranking com 3+ pontos (evolução mensal, gastos por categoria, comparação entre meses, projeção), inclua UM gráfico num bloco cercado \`\`\`grafico com JSON numa linha só:
  {"tipo":"barra"|"barra_horizontal"|"linha","titulo":"…","unidade":"brl"|"pct"|"numero","rotulos":["…"],"series":[{"nome":"…","valores":[…]}]}
  "linha" para evolução no tempo; "barra" para poucos meses ou categorias; "barra_horizontal" para ranking com nomes longos. Até 4 séries e 12 rótulos; valores como número puro com ponto decimal (1234.56), na mesma ordem dos rótulos; o título diz o recorte (período, cartão, pessoa).
  Todo valor do gráfico precisa ter vindo de uma consulta desta conversa. Escreva também 1–2 frases com a leitura principal (o gráfico não substitui a resposta). Não use gráfico para um número só.`

// No Telegram o markdown enxuto é convertido para a formatação dele; a
// diferença para o app é não haver tela ao lado e as operações terem botões.
const FORMATO_TELEGRAM = `${FORMATO}
- Você está respondendo pelo Telegram: sem tabelas, gráficos, títulos ou links no formato [texto](url).
- Em operações, depois de mostrar o resumo da proposta, diga que a pessoa pode tocar em *Confirmar* ou *Cancelar* (ou responder "sim"/"não").`

// ─── Snapshot ────────────────────────────────────────────────────────────────

/**
 * Fatura do mês corrente, quebrada por cartão e por responsável — o mesmo
 * recorte que o Dashboard desenha, para que todo número citado bata com a tela.
 */
function linhasDaFatura(data: EnrichedData, refs: Referencias): string[] {
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)
  const daFatura = data.transacoes.filter(t => (t.projeto_fatura ?? '').substring(0, 7) === refs.faturaEmFormacao)
  if (daFatura.length === 0) return [`Fatura de ${fmtMes(refs.mesApp)}: nenhuma compra lançada ainda.`]

  const porCartao = new Map<string, { total: number; porResponsavel: Map<string, number> }>()
  for (const t of daFatura) {
    const cartao = nomeCartao(t.cartao, labels)
    const atual = porCartao.get(cartao) ?? { total: 0, porResponsavel: new Map<string, number>() }
    atual.total += t.valor
    const resp = t.responsavel || 'Sem responsável'
    atual.porResponsavel.set(resp, (atual.porResponsavel.get(resp) ?? 0) + t.valor)
    porCartao.set(cartao, atual)
  }

  const totalGeral = daFatura.reduce((s, t) => s + t.valor, 0)
  const ordenados = [...porCartao.entries()].sort((a, b) => b[1].total - a[1].total)

  const linhas = [
    `FATURA DE ${fmtMes(refs.mesApp)} (mês corrente, ainda em formação — hoje é dia ${refs.diaAtual}):`,
  ]
  for (const [cartao, info] of ordenados) {
    const pessoas = [...info.porResponsavel.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([nome, valor]) => `${nome} ${R(valor)}`)
      .join(' · ')
    linhas.push(`  ${cartao}: ${R(info.total)} → ${pessoas}`)
  }
  if (ordenados.length > 1) {
    linhas.push(`  Todos os cartões somados: ${R(totalGeral)} — mas o card "Fatura ${ordenados[0][0]}" do app mostra só ${R(ordenados[0][1].total)}. Ao citar um valor, diga de qual cartão ele é.`)
  }
  return linhas
}

export function buildSnapshot(
  data: EnrichedData,
  m: FinancialInsightsContext,
  refs: Referencias,
  cobertura?: Cobertura
): string {
  const linhas: string[] = ['SNAPSHOT DO MOMENTO (números já apurados — use direto, sem consultar)']

  // A fatura é montada aqui a partir das transações, e não dos totais agregados
  // de computeInsights, por um motivo concreto: o Dashboard mostra "Fatura
  // NuBank" com o valor de UM cartão, enquanto m.totalGastos/gastoMatheus somam
  // todos. Foi assim que o assistente respondeu R$ 5.977,11 para o Matheus
  // enquanto a tela dele dizia R$ 3.241,74 (a diferença era o PicPay). Com a
  // quebra por cartão × responsável, cada número tem um lugar na tela.
  linhas.push(...linhasDaFatura(data, refs))

  // m.totalGastos é só cartão, mas m.totalGastosAnterior (e variacaoGastos) já
  // somam cartão + contas fixas — por isso este par vai separado do de cima.
  if (m.totalOrcado > 0 || m.totalGastosAnterior > 0) {
    linhas.push(
      `Total do mês (todos os cartões + contas fixas): ${R(m.totalGastos + m.totalOrcado)}` +
      (m.totalGastosAnterior > 0 ? ` · mês anterior: ${R(m.totalGastosAnterior)} (${pct(m.variacaoGastos)})` : '') +
      (m.mediaMensalHistorica > 0 ? ` · média mensal 6m: ${R(m.mediaMensalHistorica)}` : '')
    )
  }

  if (m.topCategorias.length > 0) {
    linhas.push(`Maiores categorias da fatura: ${m.topCategorias.slice(0, 4).map(c => `${c.categoria} ${R(c.valor)} (${c.percentual.toFixed(0)}%${c.variacao !== undefined ? `, ${pct(c.variacao)} vs mês ant.` : ''})`).join(' · ')}`)
  }

  if (m.totalOrcado > 0) {
    linhas.push(
      `Contas fixas de ${fmtMes(refs.mesApp)}: orçado ${R(m.totalOrcado)} · pago ${R(m.totalPago)} · em aberto ${R(m.despesasEmAberto)}` +
      (m.itensVencidos.length > 0 ? ` · ⚠️ ${m.itensVencidos.length} vencida(s) somando ${R(m.itensVencidos.reduce((s, i) => s + i.valor, 0))}` : '')
    )
  }
  if (m.itensVencendo7d.length > 0) {
    linhas.push(`Vencendo nos próximos 7 dias: ${m.itensVencendo7d.slice(0, 5).map(i => `${i.item} ${R(i.valor)} (${i.vencimento})`).join(' · ')}`)
  }

  if (m.rendaMensal) {
    linhas.push(
      `Renda de referência: ${R(m.rendaMensal)}/mês` +
      (m.sobraLiquida !== undefined ? ` · sobra estimada ${R(m.sobraLiquida)}` : '') +
      (m.taxaPoupanca !== undefined ? ` · taxa de poupança ${m.taxaPoupanca.toFixed(1)}%` : '')
    )
  }

  if (m.assinaturasAtivas > 0) {
    linhas.push(`Assinaturas ativas: ${m.assinaturasAtivas} somando ${R(m.totalAssinaturas)}/mês (já dentro da fatura).`)
  }
  if (m.comprasParceladas.count > 0) {
    linhas.push(`Parcelamentos na fatura atual: ${m.comprasParceladas.count} compra(s), ${R(m.comprasParceladas.totalValor)} no mês.`)
  }
  if (m.totalAportesHistorico > 0) {
    linhas.push(`Investimentos: ${R(m.totalAportesHistorico)} aportados no histórico registrado.`)
  }
  if (m.mediaMensalHistorica > 0) {
    linhas.push(`Tendência dos últimos 3 meses: ${m.tendencia} (${pct(m.tendenciaPct)}).`)
  }

  const fechamentos = linhasFechamento(data, refs)
  if (fechamentos) linhas.push(fechamentos)

  const limites = limitesDoMes(data, refs, refs.mesApp)
  if (limites) linhas.push(limites)

  const metas = lerMetas(data.configuracoes)
  if (temMetas(metas)) {
    const partes = [
      metas.total !== null && `total do casal ${R(metas.total)}`,
      ...Object.entries(metas.porResponsavel).map(([p, v]) => `${p} ${R(v)}`),
      Object.keys(metas.porCategoria).length > 0 && `${Object.keys(metas.porCategoria).length} limite(s) por categoria (${Object.keys(metas.porCategoria).join(', ')})`,
    ].filter(Boolean)
    linhas.push(`Metas de gasto configuradas: ${partes.join(' · ')}. Quanto já foi usado: consultar_metas.`)
  }

  // Cobertura: sem isso o modelo não sabe até onde pode pedir histórico e
  // tende a supor que "não tem" um mês que na verdade está disponível — ou,
  // no sentido oposto, que um mês ainda não importado vale zero.
  const mesesTx = data.transacoes.map(t => (t.projeto_fatura ?? '').substring(0, 7)).filter(Boolean).sort()
  if (mesesTx.length > 0) {
    linhas.push(
      `Cobertura das compras: meses de ${fmtMes(mesDaFatura(mesesTx[0]))} até ${fmtMes(mesDaFatura(mesesTx[mesesTx.length - 1]))} ` +
      `(${data.transacoes.length} lançamentos carregados). Última fatura importada por cartão: ${descreverUltimasFaturas(data)}. ` +
      'Meses posteriores ainda não têm lançamentos — para eles, projete (projetar_parcelamentos / projecao_futura).'
    )
  }

  if (cobertura && !cobertura.completo && cobertura.primeiroNoBanco) {
    linhas.push(
      `Histórico mais antigo no banco: desde ${fmtMes(cobertura.primeiroNoBanco)}. Os números acima usam os meses recentes; ` +
      'para meses anteriores, passe o período na ferramenta — ela busca na hora.'
    )
  }

  if (data.avisos && data.avisos.length > 0) {
    linhas.push(`⚠️ FONTES INDISPONÍVEIS NESTE TURNO: ${data.avisos.join(' ')}`)
  }

  return linhas.join('\n')
}

/**
 * Datas de fechamento registradas (tabela faturas). Explica o caso de borda do
 * começo do mês: até a fatura do mês anterior fechar, as compras ainda entram
 * nela — e o "mês corrente" do app parece não estar crescendo.
 */
function linhasFechamento(data: EnrichedData, refs: Referencias): string | null {
  const labels = cartaoLabelsFromPlanejamento(data.planejamento)
  const hojeIso = format(refs.hoje, 'yyyy-MM-dd')
  const partes: string[] = []
  for (const f of data.faturas ?? []) {
    const pf = (f.mes_referencia ?? '').substring(0, 7)
    const fecha = (f.data_fechamento ?? '').substring(0, 10)
    if (!fecha) continue
    const [a, m, d] = fecha.split('-')
    if (pf === refs.faturaEmFormacao) {
      partes.push(`fatura de ${fmtMes(refs.mesApp)} do ${nomeCartao(f.cartao, labels)} fecha em ${d}/${m}/${a.slice(2)}`)
    } else if (pf === faturaDoMes(refs.mesAppAnterior) && fecha >= hojeIso) {
      partes.push(`a fatura de ${fmtMes(refs.mesAppAnterior)} do ${nomeCartao(f.cartao, labels)} AINDA NÃO FECHOU (fecha em ${d}/${m}) — compras de hoje ainda entram nela`)
    }
  }
  return partes.length > 0 ? `Fechamento: ${partes.join(' · ')}.` : null
}

// ─── Montagem final ──────────────────────────────────────────────────────────

export function buildSystemPrompt({
  data,
  metrics,
  refs,
  certificate,
  tela,
  resumoConversa,
  interlocutor,
  cobertura,
}: {
  data: EnrichedData
  metrics: FinancialInsightsContext
  refs: Referencias
  certificate: ValidationCertificate
  tela?: TelaAtual
  resumoConversa?: string
  interlocutor?: Interlocutor
  cobertura?: Cobertura
}): string {
  const telegram = interlocutor?.canal === 'telegram'
  const dataHoje = format(refs.hoje, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })
  // O chat é uma tela própria: o usuário não está vendo outro número ao lado.
  // "Esse valor aqui" precisa ser perguntado, não adivinhado.
  const telaTexto = telegram
    ? ' A conversa é pelo Telegram, fora do app: o usuário não está vendo nenhuma tela. Quando algo só puder ser feito no app, diga qual tela abrir.'
    : tela && TELAS[tela]
      ? ` O usuário está olhando ${TELAS[tela]} agora.`
      : ' O chat é uma tela própria do app: se o usuário se referir a "esse valor" ou "isso na tela", pergunte de qual número ou tela ele está falando.'

  const temporal = [
    'REFERÊNCIAS DE TEMPO',
    `Hoje é ${dataHoje} (dia ${refs.diaAtual}).`,
    `Mês corrente: ${refs.mesApp}. Mês anterior: ${refs.mesAppAnterior}.`,
    'Um mês só quer dizer uma coisa aqui, e é a mesma que o app mostra no seletor de mês: a fatura de cartão que FECHA naquele mês, mais as contas fixas e as receitas daquele mês. A fatura do mês corrente ainda está em formação e vai crescer até fechar.',
    `Intervalos prontos (AAAA-MM-DD) para dataInicio/dataFim: ${intervalosDeDias(refs.hoje)}.`,
    'Passe sempre meses no formato YYYY-MM. Para falar de UM mês, mande mesInicio E mesFim com o mesmo valor — só mesInicio significa "daquele mês em diante" e soma vários meses.',
  ].join('\n')

  const qualidade = certificate.problemas.length > 0
    ? `QUALIDADE DOS DADOS: confiabilidade ${certificate.indiceConfiabilidade}%. ${certificate.resumo} ` +
      `Mencione uma ressalva ao usuário apenas se ela afetar diretamente a resposta.`
    : `QUALIDADE DOS DADOS: confiabilidade ${certificate.indiceConfiabilidade}%, sem inconsistências relevantes.`

  const resumo = resumoConversa
    ? `RESUMO DO QUE JÁ FOI CONVERSADO (pode conter números que você errou antes — confirme com uma consulta antes de reutilizá-los)\n${resumoConversa.replace(/^\[RESUMO[^\]]*\]\s*/, '')}`
    : ''

  return [
    IDENTIDADE + telaTexto,
    interlocutor ? blocoInterlocutor(interlocutor) : '',
    temporal,
    MODELO_DE_DADOS,
    USO_DE_FERRAMENTAS,
    buildSnapshot(data, metrics, refs, cobertura),
    qualidade,
    resumo,
    telegram ? FORMATO_TELEGRAM : FORMATO_APP,
  ].filter(Boolean).join('\n\n')
}

/**
 * Prompt usado quando o motor de validação bloqueia o dataset: o modelo não
 * recebe ferramenta nenhuma e só explica a situação.
 */
export function buildBlockedPrompt(certificate: ValidationCertificate): string {
  const problemas = certificate.problemas
    .filter(p => p.severity === 'critical')
    .slice(0, 5)
    .map(p => `- ${p.descricao}`)
    .join('\n')

  return [
    IDENTIDADE,
    'ATENÇÃO: a auditoria automática encontrou inconsistências CRÍTICAS nos dados financeiros e a análise está bloqueada.',
    `Confiabilidade apurada: ${certificate.indiceConfiabilidade}%.`,
    problemas ? `Problemas detectados:\n${problemas}` : '',
    'Explique isso ao usuário em 2 ou 3 frases, diga o que precisa ser revisado (provavelmente uma importação duplicada) e sugira conferir a tela de importação. NÃO produza análises, totais ou recomendações com estes dados.',
  ].filter(Boolean).join('\n\n')
}
