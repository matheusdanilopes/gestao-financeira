// Matemática de saldo do mês, compartilhada entre o Dashboard, a tela de Finanças
// (calcularSaldoInvestimentos) e o pré-cache em background (prefetchers).
//
// Antes esta lógica existia em três cópias quase idênticas que já haviam divergido
// entre si — o Dashboard tratava estornos via somarValorFatura enquanto as outras
// duas filtravam ESTORNO no SQL, o que dava saldos diferentes na mesma tela em meses
// com estorno sem par. Agora é uma implementação só, sobre linhas já carregadas.

import { somarValorFatura, type TransacaoParaTotal } from '@/lib/composicaoFatura'
import {
  TIPOS_CARTAO,
  type TipoCartao,
  tipoCartaoPorItem,
  ehLinhaDeReceita,
  ehDespesaReal,
} from '@/lib/tipoCartao'

export interface PlanejamentoSaldoRow {
  item: string
  responsavel?: string | null
  valor_previsto: number | null
  valor_real: number | null
  pago: boolean
}

export interface TransacaoSaldoRow extends TransacaoParaTotal {
  responsavel: string | null
  cartao?: string | null
}

/** Coluna `cartao` de transacoes_nubank correspondente a cada tipo de cartão. */
export const CARTAO_TX_POR_TIPO: Record<TipoCartao, string> = {
  principal: 'nubank',
  cartao1: 'cartao1',
  cartao2: 'cartao2',
}

function previstoDe(p: PlanejamentoSaldoRow): number {
  return p.valor_previsto ?? 0
}

function realizadoDe(p: PlanejamentoSaldoRow): number {
  return p.valor_real ?? previstoDe(p)
}

/** Transações de um cartão. `principal` inclui as linhas sem `cartao` preenchido. */
export function transacoesDoCartao<T extends TransacaoSaldoRow>(transacoes: T[], tipo: TipoCartao): T[] {
  const alvo = CARTAO_TX_POR_TIPO[tipo]
  if (tipo === 'principal') return transacoes.filter(t => !t.cartao || t.cartao === alvo)
  return transacoes.filter(t => t.cartao === alvo)
}

export function calcularReceitaTotal(plan: PlanejamentoSaldoRow[]): number {
  return plan.filter(p => ehLinhaDeReceita(p.item)).reduce((acc, p) => acc + previstoDe(p), 0)
}

/**
 * Despesas que não são fatura de cartão. As linhas de cartão ficam de fora porque o
 * gasto delas já entra pelas transações importadas — contá-las aqui dobraria o valor.
 */
export function calcularContasFixas(plan: PlanejamentoSaldoRow[]): { atual: number; previsto: number } {
  let atual = 0
  let previsto = 0
  for (const p of plan) {
    if (!ehDespesaReal(p.item)) continue
    atual += p.pago ? realizadoDe(p) : previstoDe(p)
    previsto += previstoDe(p)
  }
  return { atual, previsto }
}

/** Tudo que foi planejado como despesa no mês (inclusive as faturas de cartão). */
export function calcularTotalPlanejado(plan: PlanejamentoSaldoRow[]): number {
  return plan.filter(p => !ehLinhaDeReceita(p.item)).reduce((acc, p) => acc + previstoDe(p), 0)
}

export interface EfetivoCartao {
  previsto: number
  atual: number
  efetivo: number
  temDados: boolean
}

/**
 * Valor a considerar para uma fatura, na ordem: o que foi efetivamente pago →
 * o que já caiu no extrato importado → o que estava previsto.
 *
 * `linhas` são as linhas de planejamento daquela fatura; quando alguma foi marcada
 * como paga, somam-se apenas as pagas (é o que já saiu da conta).
 */
function efetivoDe(linhas: PlanejamentoSaldoRow[], atual: number): EfetivoCartao {
  const previsto = linhas.reduce((acc, p) => acc + previstoDe(p), 0)
  const pagas = linhas.filter(p => p.pago)
  const efetivo = pagas.length > 0
    ? pagas.reduce((acc, p) => acc + realizadoDe(p), 0)
    : atual > 0 ? atual : previsto
  return { previsto, atual, efetivo, temDados: atual > 0 || pagas.length > 0 }
}

/**
 * Fatura efetiva de cada cartão. O principal é quebrado por responsável antes de
 * somar: cada cartão adicional tem sua própria linha de planejamento e pode estar
 * pago enquanto os outros ainda não estão.
 */
export function calcularEfetivoPorCartao(
  plan: PlanejamentoSaldoRow[],
  transacoes: TransacaoSaldoRow[]
): Record<TipoCartao, EfetivoCartao> {
  const resultado = {} as Record<TipoCartao, EfetivoCartao>

  for (const tipo of TIPOS_CARTAO) {
    const linhas = plan.filter(p => tipoCartaoPorItem(p.item) === tipo)
    const tx = transacoesDoCartao(transacoes, tipo)

    if (tipo !== 'principal') {
      resultado[tipo] = efetivoDe(linhas, somarValorFatura(tx))
      continue
    }

    // Principal: um sub-cálculo por responsável, depois somado.
    const responsaveis = new Set<string>()
    for (const p of linhas) responsaveis.add(p.responsavel || '')
    for (const t of tx) if (t.responsavel) responsaveis.add(t.responsavel)

    let previsto = 0, atual = 0, efetivo = 0, temDados = false
    for (const responsavel of responsaveis) {
      const linhasResp = linhas.filter(p => (p.responsavel || '') === responsavel)
      const atualResp = somarValorFatura(tx.filter(t => (t.responsavel || '') === responsavel))
      const parcial = efetivoDe(linhasResp, atualResp)
      previsto += parcial.previsto
      atual += parcial.atual
      efetivo += parcial.efetivo
      temDados = temDados || parcial.temDados
    }
    resultado[tipo] = { previsto, atual, efetivo, temDados }
  }

  return resultado
}

export interface ResumoSaldo {
  receitaTotal: number
  contasFixas: number
  faturaEfetiva: number
  totalGastos: number
  saldo: number
  saldoPrevisto: number
  temLancamentosEfetivos: boolean
}

export function calcularResumoSaldo(
  plan: PlanejamentoSaldoRow[],
  transacoes: TransacaoSaldoRow[]
): ResumoSaldo {
  const receitaTotal = calcularReceitaTotal(plan)
  const contasFixas = calcularContasFixas(plan).atual
  const porCartao = calcularEfetivoPorCartao(plan, transacoes)

  const faturaEfetiva = TIPOS_CARTAO.reduce((acc, tipo) => acc + porCartao[tipo].efetivo, 0)
  const temLancamentosEfetivos = TIPOS_CARTAO.some(tipo => porCartao[tipo].temDados)
  const totalGastos = contasFixas + faturaEfetiva

  return {
    receitaTotal,
    contasFixas,
    faturaEfetiva,
    totalGastos,
    saldo: receitaTotal - totalGastos,
    saldoPrevisto: receitaTotal - calcularTotalPlanejado(plan),
    temLancamentosEfetivos,
  }
}
