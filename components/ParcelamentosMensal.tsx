'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, startOfMonth, addMonths, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Layers, Search, CreditCard, ClipboardList, Sparkles, SlidersHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { formatBRL } from '@/lib/logger'
import FilterSelect from '@/components/FilterSelect'
import EmptyState from '@/components/EmptyState'
import { buscarCartaoLabels, type CartaoLabels } from '@/lib/cartaoLabels'

interface Props {
  mesAtual: Date
}

const RESPONSAVEIS = ['Matheus', 'Jeniffer', 'Conjunto'] as const
type Responsavel = typeof RESPONSAVEIS[number]

// Reaproveita os tokens de marca já definidos em tailwind.config.js (matheus/jeniffer).
// "Conjunto" não é uma pessoa, então usa um neutro em vez de inventar uma cor nova —
// violet já é a cor-assinatura de Investimentos em outras telas do app.
const RESPONSAVEL_STYLE: Record<Responsavel, { texto: string; iconBg: string }> = {
  Matheus:  { texto: 'text-matheus dark:text-blue-400',    iconBg: 'bg-matheus-light dark:bg-blue-900/20' },
  Jeniffer: { texto: 'text-jeniffer dark:text-pink-400',   iconBg: 'bg-jeniffer-light dark:bg-pink-900/20' },
  Conjunto: { texto: 'text-slate-600 dark:text-slate-300', iconBg: 'bg-slate-100 dark:bg-slate-800/40' },
}

type Origem = 'nubank' | 'cartao1' | 'cartao2' | 'planejamento'

const CARTAO_LABELS_PADRAO: CartaoLabels = { nubank: 'NuBank', cartao1: 'Cartão 1', cartao2: 'Cartão 2' }

function origemLabel(o: Origem, cartaoLabels: CartaoLabels): string {
  if (o === 'planejamento') return 'Planejado'
  return cartaoLabels[o]
}

const ORIGEM_ICON: Record<Origem, LucideIcon> = {
  nubank: CreditCard,
  cartao1: CreditCard,
  cartao2: CreditCard,
  planejamento: ClipboardList,
}

interface ParcelaItem {
  descricao: string
  valor: number
  responsavel: string
  categoria: string
  origem: Origem
  parcelaAtual: number | null
  totalParcelas: number | null
}

const MESES_HISTORICO = 6

function arredondar(n: number, casas: number): number {
  const f = 10 ** casas
  return Math.round(n * f) / f
}

// Recipe de foco premium equivalente à classe `.input-base` de app/globals.css,
// aplicada via `focus-within` no wrapper (o input em si fica transparente) —
// evita depender da ordem de cascata do CSS para permitir campos compactos.
const CAMPO_FOCO = 'focus-within:border-primary-400 focus-within:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] dark:focus-within:shadow-[0_0_0_3px_rgba(129,140,248,0.18)] transition-shadow'

export default function ParcelamentosMensal({ mesAtual }: Props) {
  const [limites, setLimites] = useState<Record<string, number>>({})
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [inputsPct, setInputsPct] = useState<Record<string, string>>({})
  const [origemLimite, setOrigemLimite] = useState<Record<string, string>>({})
  const [sugestoes, setSugestoes] = useState<Record<string, number>>({})
  const [previstoFatura, setPrevistoFatura] = useState<Record<string, number>>({})
  const [itens, setItens] = useState<ParcelaItem[]>([])
  const [cartaoLabels, setCartaoLabels] = useState<CartaoLabels>(CARTAO_LABELS_PADRAO)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState<string | null>(null)

  const [filtroResp, setFiltroResp] = useState<'todos' | Responsavel>('todos')
  const [filtroCategoria, setFiltroCategoria] = useState('todas')
  const [filtroOrigem, setFiltroOrigem] = useState<'todos' | Origem>('todos')
  const [filtroNovidade, setFiltroNovidade] = useState<'todas' | 'novas' | 'andamento'>('todas')
  const [busca, setBusca] = useState('')
  const [dropdownFiltro, setDropdownFiltro] = useState(false)

  const mesReferencia = format(startOfMonth(mesAtual), 'yyyy-MM-dd')

  useEffect(() => {
    let cancelado = false

    async function carregar() {
      setCarregando(true)

      const projetoFatura = format(startOfMonth(addMonths(mesAtual, 1)), 'yyyy-MM-dd')

      // Últimos N meses anteriores ao mês selecionado, usados para sugerir um limite
      // com base na média histórica do que cada pessoa costuma comprometer em parcelas.
      const mesesHistorico = Array.from({ length: MESES_HISTORICO }, (_, i) => subMonths(mesAtual, i + 1))
      const projetoFaturasHist = mesesHistorico.map(m => format(startOfMonth(addMonths(m, 1)), 'yyyy-MM-dd'))
      const mesesRefHist = mesesHistorico.map(m => format(startOfMonth(m), 'yyyy-MM-dd'))

      const [
        limitesRes,
        { data: transacoes },
        { data: planejados },
        { data: transacoesHist },
        { data: planejadosHist },
        cartaoLabelsCarregados,
        { data: planejamentoMes },
      ] = await Promise.all([
        fetch(`/api/limites-parcelamentos?ate=${mesReferencia}`),
        supabase
          .from('transacoes_nubank')
          .select('descricao, valor, responsavel, categoria, cartao, parcela_atual, total_parcelas')
          .eq('projeto_fatura', projetoFatura)
          .gt('total_parcelas', 1)
          .neq('status', 'ESTORNO')
          .neq('status', 'ESTORNADO'),
        supabase
          .from('planejamento')
          .select('item, valor_previsto, responsavel, categoria, parcela_atual, total_parcelas')
          .eq('mes_referencia', mesReferencia)
          .gt('total_parcelas', 1),
        supabase
          .from('transacoes_nubank')
          .select('valor, responsavel, projeto_fatura')
          .in('projeto_fatura', projetoFaturasHist)
          .gt('total_parcelas', 1)
          .neq('status', 'ESTORNO')
          .neq('status', 'ESTORNADO'),
        supabase
          .from('planejamento')
          .select('valor_previsto, responsavel, mes_referencia')
          .in('mes_referencia', mesesRefHist)
          .gt('total_parcelas', 1),
        buscarCartaoLabels(supabase, mesReferencia),
        // Mesmos dados da tela de Despesas (ChecklistMensal): usados para somar o valor
        // previsto da fatura de cada cartão (NuBank + Cartão 1 + Cartão 2) por responsável.
        supabase
          .from('planejamento')
          .select('item, valor_previsto, responsavel')
          .eq('mes_referencia', mesReferencia),
      ])

      if (cancelado) return

      const limitesJson = await limitesRes.json()
      // A API retorna todos os limites até o mês selecionado, ordenados do mais
      // recente para o mais antigo — o primeiro de cada responsável é o valor
      // "efetivo" daquele mês: o próprio, se existir, senão o do mês anterior
      // mais recente que tenha sido configurado (herança futura → passado).
      const limitesData: Array<{ mes_referencia: string; responsavel: string; valor: number }> = limitesJson.limites ?? []

      const lMap: Record<string, number> = {}
      const iMap: Record<string, string> = {}
      const oMap: Record<string, string> = {}
      for (const l of limitesData) {
        if (oMap[l.responsavel]) continue // já achou a linha mais recente para esse responsável
        lMap[l.responsavel] = Number(l.valor ?? 0)
        iMap[l.responsavel] = String(l.valor ?? '')
        oMap[l.responsavel] = l.mes_referencia
      }

      const lista: ParcelaItem[] = [
        ...(transacoes ?? []).map(t => ({
          descricao: String(t.descricao ?? ''),
          valor: Number(t.valor ?? 0),
          responsavel: String(t.responsavel ?? ''),
          categoria: t.categoria || 'Sem categoria',
          origem: (t.cartao || 'nubank') as Origem,
          parcelaAtual: t.parcela_atual,
          totalParcelas: t.total_parcelas,
        })),
        ...(planejados ?? []).map(p => ({
          descricao: String(p.item ?? ''),
          valor: Number(p.valor_previsto ?? 0),
          responsavel: String(p.responsavel ?? ''),
          categoria: p.categoria || 'Sem categoria',
          origem: 'planejamento' as Origem,
          parcelaAtual: p.parcela_atual,
          totalParcelas: p.total_parcelas,
        })),
      ]
        .filter(item => item.responsavel)
        .sort((a, b) => b.valor - a.valor)

      // Soma por (mês bruto, responsável), usada para calcular a média histórica.
      const somaTransacoesPorMes: Record<string, Record<string, number>> = {}
      for (const t of transacoesHist ?? []) {
        const chave = String(t.projeto_fatura)
        const resp = String(t.responsavel ?? '')
        if (!resp) continue
        somaTransacoesPorMes[chave] ??= {}
        somaTransacoesPorMes[chave][resp] = (somaTransacoesPorMes[chave][resp] ?? 0) + Number(t.valor ?? 0)
      }
      const somaPlanejadosPorMes: Record<string, Record<string, number>> = {}
      for (const p of planejadosHist ?? []) {
        const chave = String(p.mes_referencia)
        const resp = String(p.responsavel ?? '')
        if (!resp) continue
        somaPlanejadosPorMes[chave] ??= {}
        somaPlanejadosPorMes[chave][resp] = (somaPlanejadosPorMes[chave][resp] ?? 0) + Number(p.valor_previsto ?? 0)
      }

      const sMap: Record<string, number> = {}
      for (const responsavel of RESPONSAVEIS) {
        const totalHistorico = mesesHistorico.reduce((soma, m, i) => {
          const doCartao = somaTransacoesPorMes[projetoFaturasHist[i]]?.[responsavel] ?? 0
          const doPlanejamento = somaPlanejadosPorMes[mesesRefHist[i]]?.[responsavel] ?? 0
          return soma + doCartao + doPlanejamento
        }, 0)
        sMap[responsavel] = totalHistorico / MESES_HISTORICO
      }

      // Valor previsto da fatura por responsável — soma do previsto de cada cartão
      // (NuBank + Cartão 1 + Cartão 2), igual ao que a tela de Despesas mostra.
      // É o denominador do campo "%": quanto do limite representa da fatura prevista.
      const despesas = planejamentoMes ?? []
      const nubankPrevistoPor = (nome: string) =>
        Number(despesas.find(p => String(p.item ?? '').trim().toLowerCase() === nome)?.valor_previsto ?? 0)
      const cartaoPrevistoPor = (responsavel: string, prefixo: string) =>
        despesas
          .filter(p => String(p.item ?? '').startsWith(prefixo) && p.responsavel === responsavel)
          .reduce((soma, p) => soma + Number(p.valor_previsto ?? 0), 0)

      const pMap: Record<string, number> = {}
      for (const responsavel of RESPONSAVEIS) {
        const nubankPrevisto = responsavel === 'Matheus'
          ? nubankPrevistoPor('nubank matheus')
          : responsavel === 'Jeniffer'
            ? nubankPrevistoPor('nubank jeniffer') + nubankPrevistoPor('nubank jeniffer conjunto')
            : nubankPrevistoPor('nubank conjunto')
        pMap[responsavel] = nubankPrevisto
          + cartaoPrevistoPor(responsavel, '[CARTAO1]')
          + cartaoPrevistoPor(responsavel, '[CARTAO2]')
      }

      const pctMap: Record<string, string> = {}
      for (const responsavel of RESPONSAVEIS) {
        const previsto = pMap[responsavel] ?? 0
        const valor = lMap[responsavel] ?? 0
        pctMap[responsavel] = previsto > 0 && valor > 0 ? String(arredondar((valor / previsto) * 100, 1)) : ''
      }

      if (!cancelado) {
        setLimites(lMap)
        setInputs(iMap)
        setInputsPct(pctMap)
        setOrigemLimite(oMap)
        setSugestoes(sMap)
        setPrevistoFatura(pMap)
        setItens(lista)
        setCartaoLabels(cartaoLabelsCarregados)
        setCarregando(false)
      }
    }

    carregar()
    return () => { cancelado = true }
  }, [mesReferencia, mesAtual])

  async function salvarLimite(responsavel: Responsavel, valorStr: string) {
    const valor = parseFloat(valorStr.replace(',', '.'))
    const valorFinal = !isNaN(valor) && valor > 0 ? valor : 0

    setSalvando(responsavel)
    try {
      await fetch('/api/limites-parcelamentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limites: [{ mes_referencia: mesReferencia, responsavel, valor: valorFinal }] }),
      })
      setLimites(prev => ({ ...prev, [responsavel]: valorFinal }))
      setOrigemLimite(prev => ({ ...prev, [responsavel]: mesReferencia }))
    } finally {
      setSalvando(null)
    }
  }

  function aplicarSugestao(responsavel: Responsavel) {
    const valor = Math.max(Math.round(sugestoes[responsavel] ?? 0), Math.round(comprometidoPorPessoa[responsavel] ?? 0))
    setInputs(prev => ({ ...prev, [responsavel]: String(valor) }))
    const previsto = previstoFatura[responsavel] ?? 0
    setInputsPct(prev => ({ ...prev, [responsavel]: previsto > 0 ? String(arredondar((valor / previsto) * 100, 1)) : '' }))
    salvarLimite(responsavel, String(valor))
  }

  function alterarValor(responsavel: Responsavel, valorStr: string) {
    setInputs(prev => ({ ...prev, [responsavel]: valorStr }))
    const previsto = previstoFatura[responsavel] ?? 0
    const valor = parseFloat(valorStr.replace(',', '.'))
    if (previsto > 0 && !isNaN(valor)) {
      setInputsPct(prev => ({ ...prev, [responsavel]: String(arredondar((valor / previsto) * 100, 1)) }))
    } else if (valorStr === '') {
      setInputsPct(prev => ({ ...prev, [responsavel]: '' }))
    }
  }

  function alterarPercentual(responsavel: Responsavel, pctStr: string) {
    setInputsPct(prev => ({ ...prev, [responsavel]: pctStr }))
    const previsto = previstoFatura[responsavel] ?? 0
    const pct = parseFloat(pctStr.replace(',', '.'))
    if (previsto > 0 && !isNaN(pct)) {
      setInputs(prev => ({ ...prev, [responsavel]: String(arredondar((pct / 100) * previsto, 2)) }))
    } else if (pctStr === '') {
      setInputs(prev => ({ ...prev, [responsavel]: '' }))
    }
  }

  function limparFiltros(incluirBusca = false) {
    setFiltroResp('todos')
    setFiltroCategoria('todas')
    setFiltroOrigem('todos')
    setFiltroNovidade('todas')
    if (incluirBusca) setBusca('')
  }

  const comprometidoPorPessoa = useMemo(() => {
    const m: Record<string, number> = {}
    for (const item of itens) m[item.responsavel] = (m[item.responsavel] ?? 0) + item.valor
    return m
  }, [itens])

  // Abre o "comprometido" por origem (NuBank/Cartão 1/Cartão 2/Planejado) —
  // sem essa quebra, o total combinado de todos os cartões parecia "errado"
  // por não bater com a fatura de um cartão específico exibida em outra tela.
  const comprometidoPorPessoaOrigem = useMemo(() => {
    const m: Record<string, Partial<Record<Origem, number>>> = {}
    for (const item of itens) {
      m[item.responsavel] ??= {}
      m[item.responsavel][item.origem] = (m[item.responsavel][item.origem] ?? 0) + item.valor
    }
    return m
  }, [itens])

  const categoriasDisponiveis = useMemo(
    () => Array.from(new Set(itens.map(i => i.categoria))).sort(),
    [itens]
  )

  const itensFiltrados = useMemo(() => {
    const buscaNorm = busca.trim().toLowerCase()
    return itens.filter(item => {
      if (filtroResp !== 'todos' && item.responsavel !== filtroResp) return false
      if (filtroCategoria !== 'todas' && item.categoria !== filtroCategoria) return false
      if (filtroOrigem !== 'todos' && item.origem !== filtroOrigem) return false
      if (filtroNovidade === 'novas' && item.parcelaAtual !== 1) return false
      if (filtroNovidade === 'andamento' && (!item.parcelaAtual || item.parcelaAtual < 2)) return false
      if (buscaNorm && !item.descricao.toLowerCase().includes(buscaNorm)) return false
      return true
    })
  }, [itens, filtroResp, filtroCategoria, filtroOrigem, filtroNovidade, busca])

  const totalComprometido = RESPONSAVEIS.reduce((s, r) => s + (comprometidoPorPessoa[r] ?? 0), 0)
  const totalLimite = RESPONSAVEIS.reduce((s, r) => s + (limites[r] ?? 0), 0)
  const filtrosAtivos = [
    filtroResp !== 'todos',
    filtroCategoria !== 'todas',
    filtroOrigem !== 'todos',
    filtroNovidade !== 'todas',
  ].filter(Boolean).length

  if (carregando) {
    return (
      <div className="space-y-6 animate-pulse" aria-hidden="true">
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-white/[0.06]" />
                <div className="h-4 w-24 bg-gray-100 dark:bg-white/[0.06] rounded-full" />
              </div>
              <div className="h-7 w-full bg-gray-100 dark:bg-white/[0.06] rounded-xl" />
              <div className="h-1.5 w-full bg-gray-100 dark:bg-white/[0.06] rounded-full" />
            </div>
          ))}
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-4 space-y-3">
          <div className="h-4 w-40 bg-gray-100 dark:bg-white/[0.06] rounded-full" />
          <div className="h-9 w-full bg-gray-100 dark:bg-white/[0.06] rounded-xl" />
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-10 w-full bg-gray-100 dark:bg-white/[0.06] rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 content-enter">
      <div className="space-y-3">
        {totalLimite > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-0.5">Total comprometido no mês</p>
            <p className="text-lg font-bold text-gray-800 dark:text-gray-100 num">
              {formatBRL(totalComprometido)} <span className="text-sm font-medium text-gray-400">/ {formatBRL(totalLimite)}</span>
            </p>
          </div>
        )}

        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 px-1">Limites por pessoa</p>

        {RESPONSAVEIS.map(responsavel => {
          const limite = limites[responsavel] ?? 0
          const gasto = comprometidoPorPessoa[responsavel] ?? 0
          const pct = limite > 0 ? (gasto / limite) * 100 : 0
          const previstoPessoa = previstoFatura[responsavel] ?? 0
          const porOrigem = comprometidoPorPessoaOrigem[responsavel] ?? {}
          const origensComValor = (['nubank', 'cartao1', 'cartao2', 'planejamento'] as Origem[])
            .filter(o => (porOrigem[o] ?? 0) > 0)
          const mediaHistorica = Math.round(sugestoes[responsavel] ?? 0)
          const sugestao = Math.max(mediaHistorica, Math.round(gasto))
          const sugestaoPresaAoComprometido = sugestao > mediaHistorica
          const mostrarSugestao = sugestao > 0 && Math.abs(sugestao - limite) > 1
          const mesOrigemLimite = origemLimite[responsavel]
          const limiteHerdado = !!mesOrigemLimite && mesOrigemLimite !== mesReferencia
          const tituloSugestao = sugestaoPresaAoComprometido
            ? `Preenche o limite com o valor já comprometido este mês (${formatBRL(sugestao)})`
            : `Preenche o limite com a média dos últimos 6 meses (${formatBRL(sugestao)})`
          const { texto, iconBg } = RESPONSAVEL_STYLE[responsavel]

          const corPct = pct >= 100 ? 'text-red-600 dark:text-red-400' : pct >= 80 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
          const bgPct = pct >= 100 ? 'bg-red-100 dark:bg-red-900/30' : pct >= 80 ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-emerald-100 dark:bg-emerald-900/30'

          return (
            <div key={responsavel} className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-8 h-8 rounded-xl ${iconBg} flex items-center justify-center`}>
                  <Layers className={`w-4 h-4 ${texto}`} />
                </div>
                <h2 className={`text-base font-semibold flex-1 ${texto}`}>{responsavel}</h2>
                {limite > 0 && (
                  <span className={`text-[10px] font-bold num px-2 py-0.5 rounded-full ${bgPct} ${corPct}`}>
                    {Math.round(Math.min(pct, 999))}%
                  </span>
                )}
              </div>

              <div className="mb-3">
                <p
                  key={`${mesReferencia}-${Math.round(gasto)}`}
                  className="text-2xl font-bold text-gray-800 dark:text-gray-100 num value-tight value-update"
                >
                  {formatBRL(gasto)}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mt-0.5">
                  comprometido este mês
                </p>
                {origensComValor.length > 1 && (
                  <div className="flex items-center gap-x-2.5 gap-y-1 flex-wrap mt-1.5">
                    {origensComValor.map(o => (
                      <span key={o} className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                        {origemLabel(o, cartaoLabels)}
                        <span className="font-semibold text-gray-700 dark:text-gray-300 num">{formatBRL(porOrigem[o] ?? 0)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {limite > 0 && (
                <div className="mb-3">
                  <div
                    className="w-full h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"
                    role="progressbar"
                    aria-valuenow={Math.round(Math.min(pct, 100))}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Comprometido de ${responsavel}: ${Math.round(Math.min(pct, 100))}%`}
                  >
                    <div
                      key={`${mesReferencia}-${Math.round(pct)}`}
                      className={`h-full rounded-full bar-enter ${pct < 80 ? 'bg-emerald-500' : pct < 100 ? 'bg-amber-400' : 'bg-red-500'}`}
                      style={{ '--bar-w': `${Math.min(pct, 100)}%` } as React.CSSProperties}
                    />
                  </div>
                  <p className="text-[10px] text-right mt-0.5 font-semibold" style={{ color: pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#6b7280' }}>
                    {pct >= 100
                      ? `Limite ultrapassado em ${formatBRL(gasto - limite)}`
                      : `Ainda pode comprometer ${formatBRL(limite - gasto)}`}
                  </p>
                </div>
              )}

              <div className="pt-3 border-t border-gray-50 dark:border-gray-800/60">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Limite mensal</span>
                  {previstoPessoa > 0 && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">
                      Previsto da fatura <span className="font-semibold text-gray-500 dark:text-gray-400 num">{formatBRL(previstoPessoa)}</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className={`flex-1 min-w-0 flex items-center gap-1.5 bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl pl-3 pr-2.5 py-2 ${CAMPO_FOCO}`}>
                    <span className="text-xs font-medium text-gray-400 dark:text-gray-500 shrink-0">R$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Sem limite"
                      value={inputs[responsavel] ?? ''}
                      onChange={(e) => alterarValor(responsavel, e.target.value)}
                      onBlur={(e) => salvarLimite(responsavel, e.target.value)}
                      disabled={salvando === responsavel}
                      aria-label={`Limite mensal de ${responsavel}`}
                      className="w-full min-w-0 bg-transparent outline-none text-sm font-semibold text-gray-800 dark:text-gray-100 num"
                    />
                  </div>
                  <div
                    className={`flex-1 min-w-0 flex items-center gap-1.5 bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl pl-3 pr-2.5 py-2 ${CAMPO_FOCO} ${previstoPessoa <= 0 ? 'opacity-50' : ''}`}
                    title={previstoPessoa > 0 ? `% do valor previsto da fatura (${formatBRL(previstoPessoa)})` : 'Sem valor previsto da fatura este mês para calcular o %'}
                  >
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="%"
                      value={inputsPct[responsavel] ?? ''}
                      onChange={(e) => alterarPercentual(responsavel, e.target.value)}
                      onBlur={() => salvarLimite(responsavel, inputs[responsavel] ?? '')}
                      disabled={salvando === responsavel || previstoPessoa <= 0}
                      aria-label={`Percentual do valor previsto da fatura de ${responsavel}`}
                      className="w-full min-w-0 bg-transparent outline-none text-sm font-semibold text-gray-800 dark:text-gray-100 num"
                    />
                    <span className="text-xs font-medium text-gray-400 dark:text-gray-500 shrink-0">%</span>
                  </div>
                </div>

                {limite === 0 && !mostrarSugestao && (
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">
                    Defina um limite para acompanhar o progresso deste mês.
                  </p>
                )}

                {(limiteHerdado || mostrarSugestao) && (
                  <div className="flex items-center justify-between gap-2 mt-1.5 min-h-[19px]">
                    {limiteHerdado ? (
                      <span
                        className="badge-fade-in inline-flex items-center text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 px-2 py-0.5 rounded-full"
                        title="Edite o valor para fixar o limite deste mês"
                      >
                        Herdado de {format(new Date(mesOrigemLimite + 'T12:00:00'), 'MMM/yyyy', { locale: ptBR })}
                      </span>
                    ) : <span />}
                    {mostrarSugestao && (
                      <button
                        type="button"
                        onClick={() => aplicarSugestao(responsavel)}
                        className="tap-scale inline-flex items-center gap-1 text-[10px] font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
                        title={tituloSugestao}
                        aria-label={tituloSugestao}
                      >
                        <Sparkles className="w-3 h-3" />
                        Sugestão: {formatBRL(sugestao)}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <ClipboardList className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          </div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">Parcelamentos do mês</h2>
        </div>

        <div className={`relative mb-2 bg-gray-50 dark:bg-gray-800 border border-transparent rounded-xl ${CAMPO_FOCO}`}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por descrição…"
            aria-label="Buscar parcelamento por descrição"
            className="w-full bg-transparent outline-none pl-9 pr-3 py-2 text-xs"
          />
        </div>

        <div className="flex items-center justify-between gap-2 mb-3">
          <button
            type="button"
            onClick={() => setDropdownFiltro(v => !v)}
            aria-expanded={dropdownFiltro}
            className={`tap-scale inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${
              filtrosAtivos > 0
                ? 'border-primary-400 bg-primary-600 text-white shadow-sm'
                : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filtrar
            {filtrosAtivos > 0 && (
              <span className="bg-white text-primary-600 rounded-full w-4 h-4 text-[10px] font-bold flex items-center justify-center">{filtrosAtivos}</span>
            )}
          </button>
          {itensFiltrados.length !== itens.length && (
            <span className="text-[11px] text-gray-400">{itensFiltrados.length} de {itens.length}</span>
          )}
        </div>

        {dropdownFiltro && (
          <div className="badge-fade-in bg-gray-50 dark:bg-gray-800/60 rounded-2xl p-3 mb-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <FilterSelect
                value={filtroResp}
                onChange={v => setFiltroResp(v as 'todos' | Responsavel)}
                options={[
                  { value: 'todos', label: 'Todos' },
                  ...RESPONSAVEIS.map(r => ({ value: r, label: r })),
                ]}
              />
              <FilterSelect
                value={filtroCategoria}
                onChange={setFiltroCategoria}
                options={[
                  { value: 'todas', label: 'Todas categorias' },
                  ...categoriasDisponiveis.map(c => ({ value: c, label: c })),
                ]}
              />
              <FilterSelect
                value={filtroOrigem}
                onChange={v => setFiltroOrigem(v as 'todos' | Origem)}
                options={[
                  { value: 'todos', label: 'Todas origens' },
                  { value: 'nubank', label: cartaoLabels.nubank },
                  { value: 'cartao1', label: cartaoLabels.cartao1 },
                  { value: 'cartao2', label: cartaoLabels.cartao2 },
                  { value: 'planejamento', label: 'Planejado' },
                ]}
              />
              <FilterSelect
                value={filtroNovidade}
                onChange={v => setFiltroNovidade(v as 'todas' | 'novas' | 'andamento')}
                options={[
                  { value: 'todas', label: 'Novas e em andamento' },
                  { value: 'novas', label: 'Novas (1ª parcela)' },
                  { value: 'andamento', label: 'Em andamento (2ª+)' },
                ]}
              />
            </div>
            {filtrosAtivos > 0 && (
              <button
                type="button"
                onClick={() => limparFiltros()}
                className="w-full text-xs text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 py-1 font-semibold transition-colors"
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}

        {itens.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Nenhum parcelamento neste mês"
            description="Compras parceladas do cartão ou itens parcelados do planejamento aparecerão aqui."
          />
        ) : itensFiltrados.length === 0 ? (
          <EmptyState
            icon={Search}
            title="Nenhum resultado com esses filtros"
            description="Tente ajustar a busca ou os filtros aplicados."
            action={
              <button
                type="button"
                onClick={() => limparFiltros(true)}
                className="tap-scale text-xs font-semibold text-primary-600 dark:text-primary-400"
              >
                Limpar filtros
              </button>
            }
          />
        ) : (
          <div className="space-y-2">
            {itensFiltrados.map((item, i) => {
              const IconeOrigem = ORIGEM_ICON[item.origem]
              return (
                <div
                  key={`${item.descricao}-${item.responsavel}-${i}`}
                  className="list-item-enter flex items-center gap-3 py-2 border-b border-gray-50 dark:border-gray-800 last:border-0"
                  style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{item.descricao}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className={`text-[11px] font-medium ${RESPONSAVEL_STYLE[item.responsavel as Responsavel]?.texto ?? 'text-gray-500'}`}>
                        {item.responsavel}
                      </span>
                      <span className="text-[11px] text-gray-400">·</span>
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">{item.categoria}</span>
                      <span className="text-[11px] text-gray-400">·</span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                        <IconeOrigem className="w-3 h-3" />
                        {origemLabel(item.origem, cartaoLabels)}
                      </span>
                      {item.parcelaAtual && item.totalParcelas && (
                        <>
                          <span className="inline-flex items-center text-[10px] font-semibold bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 num px-1.5 py-0.5 rounded-full">
                            {item.parcelaAtual}/{item.totalParcelas}
                          </span>
                          {item.parcelaAtual === 1 && (
                            <span className="badge-fade-in inline-flex items-center text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-1.5 py-0.5 rounded-full">
                              Nova
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 num flex-none">{formatBRL(item.valor)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
