'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, startOfMonth, addMonths, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Layers, Search, CreditCard, ClipboardList, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { formatBRL } from '@/lib/logger'
import FilterSelect from '@/components/FilterSelect'

interface Props {
  mesAtual: Date
}

const RESPONSAVEIS = ['Matheus', 'Jeniffer', 'Conjunto'] as const
type Responsavel = typeof RESPONSAVEIS[number]

const RESPONSAVEL_COR: Record<Responsavel, string> = {
  Matheus: 'text-blue-600 dark:text-blue-400',
  Jeniffer: 'text-pink-500 dark:text-pink-400',
  Conjunto: 'text-violet-600 dark:text-violet-400',
}

type Origem = 'nubank' | 'cartao1' | 'cartao2' | 'planejamento'

const ORIGEM_LABEL: Record<Origem, string> = {
  nubank: 'NuBank',
  cartao1: 'Cartão 1',
  cartao2: 'Cartão 2',
  planejamento: 'Planejado',
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

export default function ParcelamentosMensal({ mesAtual }: Props) {
  const [limites, setLimites] = useState<Record<string, number>>({})
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [origemLimite, setOrigemLimite] = useState<Record<string, string>>({})
  const [sugestoes, setSugestoes] = useState<Record<string, number>>({})
  const [itens, setItens] = useState<ParcelaItem[]>([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState<string | null>(null)

  const [filtroResp, setFiltroResp] = useState<'todos' | Responsavel>('todos')
  const [filtroCategoria, setFiltroCategoria] = useState('todas')
  const [filtroOrigem, setFiltroOrigem] = useState<'todos' | Origem>('todos')
  const [filtroNovidade, setFiltroNovidade] = useState<'todas' | 'novas' | 'andamento'>('todas')
  const [busca, setBusca] = useState('')

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

      if (!cancelado) {
        setLimites(lMap)
        setInputs(iMap)
        setOrigemLimite(oMap)
        setSugestoes(sMap)
        setItens(lista)
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
    salvarLimite(responsavel, String(valor))
  }

  const comprometidoPorPessoa = useMemo(() => {
    const m: Record<string, number> = {}
    for (const item of itens) m[item.responsavel] = (m[item.responsavel] ?? 0) + item.valor
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

  return (
    <div className="space-y-3">
      {!carregando && totalLimite > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Total comprometido no mês</p>
          <p className="text-lg font-bold text-gray-800 dark:text-gray-100 num">
            {formatBRL(totalComprometido)} <span className="text-sm font-medium text-gray-400">/ {formatBRL(totalLimite)}</span>
          </p>
        </div>
      )}

      {RESPONSAVEIS.map(responsavel => {
        const limite = limites[responsavel] ?? 0
        const gasto = comprometidoPorPessoa[responsavel] ?? 0
        const pct = limite > 0 ? (gasto / limite) * 100 : 0
        const mediaHistorica = Math.round(sugestoes[responsavel] ?? 0)
        const sugestao = Math.max(mediaHistorica, Math.round(gasto))
        const sugestaoPresaAoComprometido = sugestao > mediaHistorica
        const mostrarSugestao = sugestao > 0 && Math.abs(sugestao - limite) > 1
        const mesOrigemLimite = origemLimite[responsavel]
        const limiteHerdado = !!mesOrigemLimite && mesOrigemLimite !== mesReferencia

        return (
          <div key={responsavel} className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl bg-teal-50 dark:bg-teal-900/20 flex items-center justify-center">
                <Layers className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              </div>
              <h2 className={`text-base font-semibold ${RESPONSAVEL_COR[responsavel]}`}>{responsavel}</h2>
            </div>

            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Limite do mês</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400">R$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Sem limite"
                  value={inputs[responsavel] ?? ''}
                  onChange={(e) => setInputs(prev => ({ ...prev, [responsavel]: e.target.value }))}
                  onBlur={(e) => salvarLimite(responsavel, e.target.value)}
                  disabled={salvando === responsavel}
                  className="w-28 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary-400 transition-shadow"
                />
              </div>
            </div>

            {limiteHerdado && (
              <p className="text-[10px] text-gray-400 text-right mb-2">
                Herdado de {format(new Date(mesOrigemLimite + 'T12:00:00'), 'MMM/yyyy', { locale: ptBR })} — edite para fixar este mês
              </p>
            )}

            {mostrarSugestao && (
              <div className="flex justify-end mb-2">
                <button
                  type="button"
                  onClick={() => aplicarSugestao(responsavel)}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
                  title={sugestaoPresaAoComprometido
                    ? 'Preenche o limite com o valor já comprometido este mês'
                    : 'Preenche o limite com a média dos últimos 6 meses'}
                >
                  <Sparkles className="w-3 h-3" />
                  Sugestão: {formatBRL(sugestao)} {sugestaoPresaAoComprometido ? '(comprometido este mês)' : '(média 6 meses)'}
                </button>
              </div>
            )}

            <div className="flex justify-between items-baseline mb-1">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Comprometido</span>
              <span className={`text-[11px] font-semibold num ${pct >= 100 ? 'text-red-500' : pct >= 80 ? 'text-amber-500' : 'text-gray-400'}`}>
                {formatBRL(gasto)}{limite > 0 ? ` / ${formatBRL(limite)}` : ''}
              </span>
            </div>

            {limite > 0 && (
              <>
                <div className="w-full h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${pct < 80 ? 'bg-emerald-500' : pct < 100 ? 'bg-amber-400' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-right mt-0.5 font-semibold" style={{ color: pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#6b7280' }}>
                  {pct >= 100
                    ? `Limite ultrapassado em ${formatBRL(gasto - limite)}`
                    : `Ainda pode comprometer ${formatBRL(limite - gasto)}`}
                </p>
              </>
            )}
          </div>
        )
      })}

      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-card border border-gray-100 dark:border-gray-800 p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <ClipboardList className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          </div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">Parcelamentos do mês</h2>
        </div>

        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por descrição…"
            className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-9 pr-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary-400 transition-shadow"
          />
        </div>

        <div className="flex gap-2 mb-3 flex-wrap">
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
              { value: 'nubank', label: 'NuBank' },
              { value: 'cartao1', label: 'Cartão 1' },
              { value: 'cartao2', label: 'Cartão 2' },
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

        {carregando ? (
          <p className="text-xs text-gray-400 text-center py-4">Carregando…</p>
        ) : itensFiltrados.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">Nenhum parcelamento encontrado com esses filtros.</p>
        ) : (
          <div className="space-y-2">
            {itensFiltrados.map((item, i) => (
              <div key={`${item.descricao}-${item.responsavel}-${i}`} className="flex items-center gap-3 py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{item.descricao}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className={`text-[11px] font-medium ${RESPONSAVEL_COR[item.responsavel as Responsavel] ?? 'text-gray-500'}`}>
                      {item.responsavel}
                    </span>
                    <span className="text-[11px] text-gray-400">·</span>
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">{item.categoria}</span>
                    <span className="text-[11px] text-gray-400">·</span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                      <CreditCard className="w-3 h-3" />
                      {ORIGEM_LABEL[item.origem]}
                    </span>
                    {item.parcelaAtual && item.totalParcelas && (
                      <>
                        <span className="text-[11px] text-gray-400">·</span>
                        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 num">
                          {item.parcelaAtual}/{item.totalParcelas}
                        </span>
                        {item.parcelaAtual === 1 && (
                          <span className="inline-flex items-center text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-1.5 py-0.5 rounded-full">
                            Nova
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 num flex-none">{formatBRL(item.valor)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
