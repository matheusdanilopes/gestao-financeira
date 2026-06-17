'use client'

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, subMonths } from 'date-fns'
import { useGlobalSync } from '@/lib/useGlobalSync'
import { TrendingUp, CirclePlus, History, Trash2, X, WifiOff } from 'lucide-react'
import PageActionButtons from '@/components/PageActionButtons'
import { SwipeableItem } from '@/components/SwipeableItem'
import { log, numericOnly, formatBRL } from '@/lib/logger'

const RECEITA_PREFIXO = '[RECEITA] '

interface ItemReceita {
  id: string
  item: string
  responsavel: string
  valor_previsto: number
  valor_real: number | null
  pago: boolean
  mes_referencia: string
}

interface Recebimento {
  id: string
  planejamento_id: string
  valor: number
  data_recebimento: string
  observacao: string | null
  created_at: string
}

function paraNomeInterno(nome: string) {
  return `${RECEITA_PREFIXO}${nome}`
}

function paraNomeExibicao(nome: string) {
  return nome.startsWith(RECEITA_PREFIXO) ? nome.replace(RECEITA_PREFIXO, '') : nome
}

export default function ReceitasMensal({ mesSelecionado, autoOpen }: { mesSelecionado: Date; autoOpen?: boolean }) {
  const [itens, setItens] = useState<ItemReceita[]>([])
  const [recebimentos, setRecebimentos] = useState<Record<string, Recebimento[]>>({})

  // Modais de item (adicionar/editar/excluir)
  const [modalAberto, setModalAberto] = useState<string | null>(null)
  useEffect(() => {
    if (autoOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModalAberto('adicionar')
    }
  }, [autoOpen])
  const [itemSelecionado, setItemSelecionado] = useState<ItemReceita | null>(null)
  const [formData, setFormData] = useState({ item: '', responsavel: 'Matheus', valor_previsto: '' })

  // Modais de recebimento parcial
  const [modalRecebimento, setModalRecebimento] = useState<ItemReceita | null>(null)
  const [formRecebimento, setFormRecebimento] = useState({
    valor: '',
    data_recebimento: format(new Date(), 'yyyy-MM-dd'),
    observacao: '',
  })
  const [modalHistorico, setModalHistorico] = useState<ItemReceita | null>(null)
  const [recebimentoPendingDelete, setRecebimentoPendingDelete] = useState<string | null>(null) // id do recebimento ou 'legado'

  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null)
  const [importando, setImportando] = useState(false)
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set())
  const [newItemId, setNewItemId] = useState<string | null>(null)
  const pendingNewRef = useRef<string | null>(null)

  const mesRefStr = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')

  // Fetcher estável para o useDataSync
  const fetcherReceitas = useCallback(async () => {
    const { data: lista } = await supabase
      .from('planejamento')
      .select('*')
      .eq('mes_referencia', mesRefStr)
      .ilike('item', '[RECEITA]%')
      .order('item', { ascending: true })
    const itensList: ItemReceita[] = lista || []
    const ids = itensList.map(i => i.id)
    const recsMap: Record<string, Recebimento[]> = {}
    if (ids.length > 0) {
      const { data: recs } = await supabase
        .from('receitas_recebimentos')
        .select('*')
        .in('planejamento_id', ids)
        .order('data_recebimento', { ascending: true })
      for (const r of (recs || [])) {
        if (!recsMap[r.planejamento_id]) recsMap[r.planejamento_id] = []
        recsMap[r.planejamento_id].push(r)
      }
    }
    return { itens: itensList, recebimentos: recsMap }
  }, [mesRefStr])

  // Sincronização automática: Realtime + polling 45s + cache localStorage
  const { isOnline, refetch } = useGlobalSync({
    cacheKey: `receitas:${mesRefStr}`,
    tables: ['planejamento', 'receitas_recebimentos'],
    fetcher: fetcherReceitas,
    onData: (raw: unknown) => {
      const d = raw as { itens: ItemReceita[]; recebimentos: Record<string, Recebimento[]> }
      setItens(d.itens)
      setRecebimentos(d.recebimentos)
      if (pendingNewRef.current) {
        const id = pendingNewRef.current
        pendingNewRef.current = null
        setNewItemId(id)
        setTimeout(() => setNewItemId(null), 400)
      }
    },
    pollInterval: 45_000,
  })

  function showToast(msg: string, tipo: 'ok' | 'erro' = 'ok') {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  // Total recebido por item: usa recebimentos da tabela; fallback para valor_real (dados legados)
  function totalRecebidoItem(item: ItemReceita): number {
    const recs = recebimentos[item.id] || []
    if (recs.length > 0) return recs.reduce((acc, r) => acc + r.valor, 0)
    if (item.pago) return item.valor_real ?? item.valor_previsto
    return 0
  }

  async function salvarRecebimento() {
    if (!modalRecebimento) return
    const valor = parseFloat(formRecebimento.valor.replace(',', '.'))
    if (isNaN(valor) || valor <= 0) return

    const { error } = await supabase.from('receitas_recebimentos').insert([{
      planejamento_id: modalRecebimento.id,
      valor,
      data_recebimento: formRecebimento.data_recebimento,
      observacao: formRecebimento.observacao.trim() || null,
    }])

    if (error) { showToast('Erro ao registrar recebimento', 'erro'); return }

    // Atualiza flag pago se total >= previsto
    const novoTotal = totalRecebidoItem(modalRecebimento) + valor
    if (novoTotal >= modalRecebimento.valor_previsto) {
      await supabase.from('planejamento').update({ pago: true, valor_real: novoTotal }).eq('id', modalRecebimento.id)
    }

    log('receber', 'receitas', `Recebimento: ${paraNomeExibicao(modalRecebimento.item)} — ${formatBRL(valor)}`, valor)
    showToast(`${formatBRL(valor)} registrado!`)
    setModalRecebimento(null)
    setFormRecebimento({ valor: '', data_recebimento: format(new Date(), 'yyyy-MM-dd'), observacao: '' })
    refetch()
  }

  async function excluirRecebimento(r: Recebimento) {
    const item = itens.find(i => i.id === r.planejamento_id)
    const prevRecs = recebimentos[r.planejamento_id] || []
    // Optimistic: remove the recebimento locally
    setRecebimentos(prev => ({
      ...prev,
      [r.planejamento_id]: prevRecs.filter(x => x.id !== r.id),
    }))
    setRecebimentoPendingDelete(null)
    const { error } = await supabase.from('receitas_recebimentos').delete().eq('id', r.id)
    if (!error) {
      const remaining = prevRecs.filter(x => x.id !== r.id)
      const novoTotal = remaining.reduce((acc, x) => acc + x.valor, 0)
      if (item && novoTotal < item.valor_previsto) {
        await supabase.from('planejamento').update({ pago: false, valor_real: null }).eq('id', r.planejamento_id)
      }
      log('excluir', 'receitas', `Recebimento excluído: ${item ? paraNomeExibicao(item.item) : ''}`, r.valor)
      showToast('Recebimento excluído')
      refetch()
    } else {
      setRecebimentos(prev => ({ ...prev, [r.planejamento_id]: prevRecs }))
      showToast('Erro ao excluir recebimento', 'erro')
    }
  }

  // Desfaz um recebimento registrado pelo método legado (pago=true sem entradas na tabela)
  async function excluirLegado(item: ItemReceita) {
    setItens(prev => prev.map(i => i.id === item.id ? { ...i, pago: false, valor_real: null } : i))
    setRecebimentoPendingDelete(null)
    setModalHistorico(null)
    const { error } = await supabase.from('planejamento').update({ pago: false, valor_real: null }).eq('id', item.id)
    if (!error) {
      log('excluir', 'receitas', `Recebimento desfeito: ${paraNomeExibicao(item.item)}`)
      showToast('Recebimento desfeito')
      refetch()
    } else {
      setItens(prev => prev.map(i => i.id === item.id ? { ...i, pago: item.pago, valor_real: item.valor_real } : i))
      showToast('Erro ao desfazer recebimento', 'erro')
    }
  }

  async function excluir(id: string) {
    const item = itens.find(i => i.id === id)
    setModalAberto(null)

    setExitingIds(prev => new Set(prev).add(id))
    const removeTimer = setTimeout(() => {
      setItens(prev => prev.filter(i => i.id !== id))
      setExitingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }, 300)

    const { error } = await supabase.from('planejamento').delete().eq('id', id)
    if (!error) {
      log('excluir', 'receitas', `Excluída: ${item ? paraNomeExibicao(item.item) : id}`)
      refetch()
    } else {
      clearTimeout(removeTimer)
      setExitingIds(prev => { const s = new Set(prev); s.delete(id); return s })
      if (item) setItens(prev => [...prev, item].sort((a, b) => a.item.localeCompare(b.item)))
      showToast('Erro ao excluir receita', 'erro')
    }
  }

  async function salvar() {
    const valor = parseFloat(formData.valor_previsto.replace(',', '.'))
    const payload = {
      item: paraNomeInterno(formData.item),
      responsavel: formData.responsavel,
      valor_previsto: valor,
    }
    if (modalAberto === 'adicionar') {
      const mesRef = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')
      const { data: insertData } = await supabase.from('planejamento').insert([{
        ...payload,
        categoria: 'Extra',
        mes_referencia: mesRef,
        pago: false,
        valor_real: null,
      }]).select()
      if (insertData?.[0]) pendingNewRef.current = insertData[0].id
      log('inserir', 'receitas', `Nova receita: ${formData.item} — ${formatBRL(valor)}`, valor)
    } else if (itemSelecionado) {
      await supabase.from('planejamento').update(payload).eq('id', itemSelecionado.id)
      log('editar', 'receitas', `Editada: ${formData.item} — ${formatBRL(valor)}`, valor, itemSelecionado.valor_previsto)
    }
    setModalAberto(null)
    setItemSelecionado(null)
    setFormData({ item: '', responsavel: 'Matheus', valor_previsto: '' })
    refetch()
  }

  async function importarMesAnterior() {
    setImportando(true)
    const mesAnterior = format(startOfMonth(subMonths(mesSelecionado, 1)), 'yyyy-MM-dd')
    const mesAtual = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')

    try {
      const { data: itensAnteriores } = await supabase
        .from('planejamento')
        .select('*')
        .eq('mes_referencia', mesAnterior)
        .ilike('item', '[RECEITA]%')

      if (!itensAnteriores || itensAnteriores.length === 0) {
        showToast('Nenhuma receita encontrada no mês anterior', 'erro')
        return
      }

      // 1. Busca IDs das receitas existentes no mês atual
      const { data: existentes } = await supabase
        .from('planejamento')
        .select('id')
        .eq('mes_referencia', mesAtual)
        .ilike('item', '[RECEITA]%')
      const idsExistentes = (existentes || []).map(i => i.id)

      // 2. Insere as receitas do mês anterior primeiro — se falhar, os dados existentes são preservados
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const inserts = itensAnteriores.map(({ id, mes_referencia, pago, valor_real, data_pagamento, created_at, parcela_atual, total_parcelas, ...resto }) => ({
        ...resto,
        mes_referencia: mesAtual,
        pago: false,
        valor_real: null,
        data_pagamento: null,
        parcela_atual: parcela_atual ? parcela_atual + 1 : null,
        total_parcelas: total_parcelas ?? null,
      }))

      const { error: insertError } = await supabase.from('planejamento').insert(inserts)
      if (insertError) throw insertError

      // 3. Só apaga os existentes após o insert ser bem-sucedido
      if (idsExistentes.length > 0) {
        await supabase.from('planejamento').delete().in('id', idsExistentes)
      }

      log('inserir', 'receitas', `Importadas ${inserts.length} receita(s) do mês anterior`)
      showToast(`${inserts.length} receita${inserts.length > 1 ? 's' : ''} importada${inserts.length > 1 ? 's' : ''}!`)
      refetch()
    } catch (e) {
      console.error('Erro ao importar receitas:', e)
      showToast('Erro ao importar receitas', 'erro')
    } finally {
      setImportando(false)
    }
  }

  function abrirEditar(item: ItemReceita) {
    setItemSelecionado(item)
    setFormData({
      item: paraNomeExibicao(item.item),
      responsavel: item.responsavel,
      valor_previsto: String(item.valor_previsto),
    })
    setModalAberto('editar')
  }

  const [filtroStatus, setFiltroStatus] = useState<'' | 'recebido' | 'pendente'>('')

  const totalPrevisto = useMemo(() => itens.reduce((acc, i) => acc + i.valor_previsto, 0), [itens])
  const totalRecebido = itens.reduce((acc, i) => acc + totalRecebidoItem(i), 0)
  const percentual = totalPrevisto > 0 ? Math.min((totalRecebido / totalPrevisto) * 100, 100) : 0

  const itensFiltrados = useMemo(() => {
    if (filtroStatus === 'recebido') return itens.filter(i => totalRecebidoItem(i) >= i.valor_previsto)
    if (filtroStatus === 'pendente') return itens.filter(i => totalRecebidoItem(i) < i.valor_previsto)
    return itens
  }, [itens, filtroStatus, recebimentos])

  return (
    <div className="space-y-3">

      {/* Resumo */}
      <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3.5">
          <div className="w-7 h-7 rounded-xl bg-emerald-100 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <span className="font-semibold text-gray-800 text-sm">Resumo de Receitas</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 mb-3.5">
          <div className="bg-gray-50 rounded-2xl p-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">Previsto</p>
            <p className="text-base font-bold text-gray-800 num">{formatBRL(totalPrevisto)}</p>
          </div>
          <div className="bg-emerald-50 rounded-2xl p-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-500 mb-0.5">Recebido</p>
            <p className="text-base font-bold text-emerald-700 num">{formatBRL(totalRecebido)}</p>
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1.5">
            <span>Progresso do mês</span>
            <span className="font-bold text-emerald-600 tabular-nums">{percentual.toFixed(0)}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
            <div
              key={Math.round(percentual)}
              className="h-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 bar-enter"
              style={{ '--bar-w': `${percentual}%` } as React.CSSProperties}
            />
          </div>
        </div>

        {/* Filtros compactos */}
        <div className="flex gap-1.5 pt-3 border-t border-gray-100">
          {(['', 'recebido', 'pendente'] as const).map((f) => {
            const label = f === '' ? 'Todos' : f === 'recebido' ? 'Recebidas' : 'Pendentes'
            return (
              <button
                key={f}
                onClick={() => setFiltroStatus(f)}
                className={`text-xs px-3 py-1 rounded-full font-medium transition-all duration-150 active:scale-95 ${
                  filtroStatus === f
                    ? 'bg-gray-800 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Banner offline */}
      {!isOnline && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 flex items-center gap-2">
          <WifiOff className="w-4 h-4 text-blue-600 shrink-0" />
          <p className="text-sm text-blue-700 font-medium">Você está offline — edição desabilitada</p>
        </div>
      )}

      {/* Botões de ação */}
      {isOnline && (
        <PageActionButtons
          onAdd={() => setModalAberto('adicionar')}
          onImport={importarMesAnterior}
          isImporting={importando}
          importColorClass="bg-primary-600 text-white hover:bg-primary-700"
        />
      )}

      {/* Lista */}
      <div className="bg-white rounded-3xl shadow-card border border-gray-100 overflow-hidden divide-y divide-gray-100">
        {itensFiltrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-emerald-300" strokeWidth={1.5} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-500">
                {filtroStatus ? 'Nenhum item neste filtro' : 'Nenhuma receita cadastrada'}
              </p>
              {!filtroStatus && (
                <p className="text-xs text-gray-400 mt-0.5">Toque em + Adicionar para começar</p>
              )}
            </div>
          </div>
        ) : (
          itensFiltrados.map((item) => {
            const recebido = totalRecebidoItem(item)
            const progresso = item.valor_previsto > 0 ? Math.min((recebido / item.valor_previsto) * 100, 100) : 0
            const concluido = recebido > 0 && recebido >= item.valor_previsto
            const parcial = recebido > 0 && !concluido
            const hasRecs = (recebimentos[item.id] || []).length > 0
            // Legado: pago=true sem entradas na tabela — também mostra histórico
            const showHistory = hasRecs || (item.pago && !hasRecs)

            return (
              <SwipeableItem
                key={item.id}
                onDelete={() => { setItemSelecionado(item); setModalAberto('excluir') }}
                disabled={!isOnline}
              >
                <div
                  className={`px-4 py-3 transition-[background-color,color,opacity] duration-200 ${concluido ? 'bg-green-100/50 dark:bg-green-900/25' : 'bg-white'} ${isOnline ? 'cursor-pointer active:bg-gray-50 dark:active:bg-white/[0.06] hover:bg-gray-50/50 dark:hover:bg-white/[0.06]' : ''} ${exitingIds.has(item.id) ? 'item-exit' : newItemId === item.id ? 'item-new' : ''}`}
                  onClick={() => { if (isOnline) abrirEditar(item) }}
                  role={isOnline ? 'button' : undefined}
                  tabIndex={isOnline ? 0 : undefined}
                  onKeyDown={isOnline ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirEditar(item) } } : undefined}
                  aria-label={isOnline ? `Editar ${paraNomeExibicao(item.item)}` : undefined}
                >
                  <div className="flex items-center gap-3">
                    {/* Status dot */}
                    <div className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${
                      concluido ? 'bg-green-500' : parcial ? 'bg-yellow-400' : 'bg-gray-300'
                    }`} />

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {paraNomeExibicao(item.item)}
                      </p>
                      <p className="text-xs text-gray-400">{item.responsavel}</p>
                    </div>

                    {/* Valores */}
                    <div className="text-right shrink-0 mr-1">
                      <p className="text-sm font-semibold text-gray-800">
                        {formatBRL(item.valor_previsto)}
                      </p>
                      {recebido > 0 && (
                        <p className={`text-xs font-medium ${concluido ? 'text-green-600' : 'text-yellow-600'}`}>
                          ✓ {formatBRL(recebido)}
                        </p>
                      )}
                    </div>

                    {/* Ações rápidas */}
                    <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {showHistory && (
                        <button
                          onClick={() => { setModalHistorico(item); setRecebimentoPendingDelete(null) }}
                          className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition"
                          title="Histórico"
                        >
                          <History className="w-4 h-4" />
                        </button>
                      )}
                      {isOnline && (
                        <button
                          onClick={() => {
                            setModalRecebimento(item)
                            setFormRecebimento({ valor: '', data_recebimento: format(new Date(), 'yyyy-MM-dd'), observacao: '' })
                          }}
                          className="p-1.5 rounded-lg text-green-600 hover:bg-green-100 transition"
                          title="Registrar recebimento"
                        >
                          <CirclePlus className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Barra de progresso por item */}
                  <div className="mt-2 ml-4">
                    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full transition-[width] duration-500 ease-smooth ${
                          concluido ? 'bg-green-500' : parcial ? 'bg-yellow-400' : 'bg-gray-200'
                        }`}
                        style={{ width: `${progresso}%` }}
                      />
                    </div>
                  </div>
                </div>
              </SwipeableItem>
            )
          })
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`toast-enter fixed bottom-24 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-2xl shadow-float text-sm font-semibold text-white z-[60] ${
          toast.tipo === 'ok' ? 'bg-gray-900' : 'bg-red-500'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* ── Modal: registrar recebimento parcial ── */}
      {modalRecebimento && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-float">
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-lg font-bold">Registrar Recebimento</h3>
              <button onClick={() => setModalRecebimento(null)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">{paraNomeExibicao(modalRecebimento.item)}</p>

            {/* Progresso atual */}
            {(() => {
              const recebido = totalRecebidoItem(modalRecebimento)
              const restante = Math.max(0, modalRecebimento.valor_previsto - recebido)
              return (
                <div className="bg-green-50 rounded-xl px-3 py-2 mb-4 text-xs text-gray-600 flex justify-between">
                  <span>Recebido: <strong>{formatBRL(recebido)}</strong></span>
                  <span>Restante: <strong className="text-green-700">{formatBRL(restante)}</strong></span>
                </div>
              )
            })()}

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Valor (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="w-full border border-gray-200 rounded-xl p-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-green-400"
                  placeholder="0,00"
                  value={formRecebimento.valor}
                  onChange={(e) => setFormRecebimento(f => ({ ...f, valor: numericOnly(e.target.value) }))}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Data</label>
                <input
                  type="date"
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-green-400"
                  value={formRecebimento.data_recebimento}
                  onChange={(e) => setFormRecebimento(f => ({ ...f, data_recebimento: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Observação (opcional)</label>
                <input
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-green-400"
                  placeholder="Ex: Adiantamento, comissão…"
                  value={formRecebimento.observacao}
                  onChange={(e) => setFormRecebimento(f => ({ ...f, observacao: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setModalRecebimento(null)} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600">
                Cancelar
              </button>
              <button onClick={salvarRecebimento} className="flex-1 py-3 rounded-xl bg-green-600 text-white font-semibold">
                Confirmar
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* ── Modal: histórico de recebimentos ── */}
      {modalHistorico && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-float">
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-lg font-bold">Histórico</h3>
              <button onClick={() => setModalHistorico(null)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">{paraNomeExibicao(modalHistorico.item)}</p>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {/* Entradas da tabela (novo sistema) */}
              {(recebimentos[modalHistorico.id] || []).map((r) => (
                <div key={r.id} className={`rounded-xl overflow-hidden transition-all ${
                  recebimentoPendingDelete === r.id ? 'ring-2 ring-red-300' : ''
                }`}>
                  <div className="flex items-center gap-3 bg-gray-50 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{formatBRL(r.valor)}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(r.data_recebimento + 'T12:00:00').toLocaleDateString('pt-BR')}
                        {r.observacao && <span className="ml-1">· {r.observacao}</span>}
                      </p>
                    </div>
                    {recebimentoPendingDelete === r.id ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => setRecebimentoPendingDelete(null)}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-200 text-gray-600 hover:bg-gray-300 transition"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => excluirRecebimento(r)}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition"
                        >
                          Excluir
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setRecebimentoPendingDelete(r.id)}
                        className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {/* Entrada legada: pago=true sem registros na tabela */}
              {(recebimentos[modalHistorico.id] || []).length === 0 && modalHistorico.pago && (
                <div className={`rounded-xl overflow-hidden transition-all ${
                  recebimentoPendingDelete === 'legado' ? 'ring-2 ring-red-300' : ''
                }`}>
                  <div className="flex items-center gap-3 bg-gray-50 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">
                        {formatBRL(modalHistorico.valor_real ?? modalHistorico.valor_previsto)}
                      </p>
                      <p className="text-xs text-gray-400">Recebido integralmente</p>
                    </div>
                    {recebimentoPendingDelete === 'legado' ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => setRecebimentoPendingDelete(null)}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-200 text-gray-600 hover:bg-gray-300 transition"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => excluirLegado(modalHistorico)}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition"
                        >
                          Desfazer
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setRecebimentoPendingDelete('legado')}
                        className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="border-t mt-3 pt-3 flex justify-between text-sm font-medium text-gray-600">
              <span>Total recebido</span>
              <span className="text-green-700 font-bold">
                {(recebimentos[modalHistorico.id] || []).length > 0
                  ? formatBRL((recebimentos[modalHistorico.id] || []).reduce((a, r) => a + r.valor, 0))
                  : formatBRL(modalHistorico.pago ? (modalHistorico.valor_real ?? modalHistorico.valor_previsto) : 0)}
              </span>
            </div>
            <button
              onClick={() => {
                setModalHistorico(null)
                setModalRecebimento(modalHistorico)
                setFormRecebimento({ valor: '', data_recebimento: format(new Date(), 'yyyy-MM-dd'), observacao: '' })
              }}
              className="w-full mt-4 py-3 rounded-xl bg-green-600 text-white font-semibold flex items-center justify-center gap-2"
            >
              <CirclePlus className="w-5 h-5" />
              Novo recebimento
            </button>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* ── Modal: adicionar / editar ── */}
      {(modalAberto === 'adicionar' || modalAberto === 'editar') && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-float">
            <h3 className="text-lg font-bold mb-5">
              {modalAberto === 'adicionar' ? 'Nova Receita' : 'Editar Receita'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Descrição</label>
                <input
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-green-400"
                  placeholder="Ex: Salário Matheus"
                  value={formData.item}
                  onChange={(e) => setFormData({ ...formData, item: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Responsável</label>
                <select
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-green-400"
                  value={formData.responsavel}
                  onChange={(e) => setFormData({ ...formData, responsavel: e.target.value })}
                >
                  <option value="Matheus">Matheus</option>
                  <option value="Jeniffer">Jeniffer</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Valor previsto (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-green-400"
                  placeholder="0,00"
                  value={formData.valor_previsto}
                  onChange={(e) => setFormData({ ...formData, valor_previsto: numericOnly(e.target.value) })}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setModalAberto(null)} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600">
                Cancelar
              </button>
              <button onClick={salvar} className="flex-1 py-3 rounded-xl bg-green-600 text-white font-semibold">
                Salvar
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* ── Modal: excluir ── */}
      {modalAberto === 'excluir' && itemSelecionado && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-float">
            <h3 className="text-lg font-bold mb-2">Excluir receita</h3>
            <p className="text-sm text-gray-500 mb-6">
              Tem certeza que deseja excluir <span className="font-semibold text-gray-800">&quot;{paraNomeExibicao(itemSelecionado.item)}&quot;</span>?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setModalAberto(null)} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600">
                Cancelar
              </button>
              <button onClick={() => excluir(itemSelecionado.id)} className="flex-1 py-3 rounded-xl bg-red-500 text-white font-semibold">
                Excluir
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  )
}
