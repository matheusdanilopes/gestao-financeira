'use client'

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, subMonths } from 'date-fns'
import { useGlobalSync } from '@/lib/useGlobalSync'
import { ptBR } from 'date-fns/locale'
import { PiggyBank, CirclePlus, History, Trash2, X, WifiOff } from 'lucide-react'
import PageActionButtons from '@/components/PageActionButtons'
import { SwipeableItem } from '@/components/SwipeableItem'
import { log } from '@/lib/logger'
import { numericOnly, formatBRL } from '@/lib/format'
import {
  atualizarRegistrosFuturos,
  excluirRegistrosFuturos,
  criarRegistrosFuturos,
  MESES_FUTUROS_PADRAO,
  MESES_FUTUROS_MAXIMO,
} from '@/lib/registrosFuturos'

interface Investimento {
  id: string
  descricao: string
  percentual: number
  mes_referencia: string
  created_at: string
}

interface Aporte {
  id: string
  investimento_id: string
  valor: number
  saldo_atual: number | null
  data_aporte: string
  observacao: string | null
  created_at: string
}

interface Props {
  mesSelecionado: Date
  saldo: number
  saldoPrevisto?: number
  autoOpen?: boolean
}

export default function InvestimentosMensal({ mesSelecionado, saldo, saldoPrevisto = 0, autoOpen }: Props) {
  const [itens, setItens] = useState<Investimento[]>([])
  const [aportes, setAportes] = useState<Record<string, Aporte[]>>({})

  // Modais de investimento
  const [modalAberto, setModalAberto] = useState<string | null>(null)
  const [itemSelecionado, setItemSelecionado] = useState<Investimento | null>(null)
  const [formData, setFormData] = useState({ descricao: '', percentual: '', valor: '' })
  const [ultimoCampo, setUltimoCampo] = useState<'percentual' | 'valor'>('percentual')
  const [aplicarFuturos, setAplicarFuturos] = useState(false)
  const [quantidadeMesesFuturos, setQuantidadeMesesFuturos] = useState(String(MESES_FUTUROS_PADRAO))
  useEffect(() => {
    if (autoOpen) {
      setUltimoCampo('percentual')
      setModalAberto('adicionar')
    }
  }, [autoOpen])

  // Modais de aporte
  const [modalAporte, setModalAporte] = useState<Investimento | null>(null)
  const [formAporte, setFormAporte] = useState({
    valor: '',
    saldo_atual: '',
    data_aporte: format(new Date(), 'yyyy-MM-dd'),
    observacao: '',
  })
  const [modalHistorico, setModalHistorico] = useState<Investimento | null>(null)
  const [aportePendingDelete, setAportePendingDelete] = useState<string | null>(null)

  // Importar
  const [previewImport, setPreviewImport] = useState<{ itens: Investimento[]; mesOrigem: string } | null>(null)
  const [importando, setImportando] = useState(false)

  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null)
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set())
  const [newItemId, setNewItemId] = useState<string | null>(null)
  const pendingNewRef = useRef<string | null>(null)

  const mesRefStr = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')

  // Fetcher estável para o useDataSync
  const fetcherInvestimentos = useCallback(async () => {
    const { data: invData } = await supabase
      .from('investimentos')
      .select('*')
      .eq('mes_referencia', mesRefStr)
      .order('created_at', { ascending: true })
    const ids = (invData || []).map((i: Investimento) => i.id)
    const aportesMap: Record<string, Aporte[]> = {}
    if (ids.length > 0) {
      const { data: aportesData } = await supabase
        .from('investimentos_aportes')
        .select('*')
        .in('investimento_id', ids)
        .order('data_aporte', { ascending: true })
      for (const a of (aportesData || [])) {
        if (!aportesMap[a.investimento_id]) aportesMap[a.investimento_id] = []
        aportesMap[a.investimento_id].push(a)
      }
    }
    return { itens: invData || [], aportes: aportesMap }
  }, [mesRefStr])

  // Sincronização automática: Realtime + polling 45s + cache localStorage
  const { isOnline, refetch } = useGlobalSync({
    cacheKey: `investimentos:${mesRefStr}`,
    tables: ['investimentos', 'investimentos_aportes'],
    fetcher: fetcherInvestimentos,
    onData: (raw: unknown) => {
      const d = raw as { itens: Investimento[]; aportes: Record<string, Aporte[]> }
      setItens(d.itens)
      setAportes(d.aportes)
      if (pendingNewRef.current) {
        const id = pendingNewRef.current
        pendingNewRef.current = null
        setNewItemId(id)
        setTimeout(() => setNewItemId(null), 400)
      }
    },
    pollInterval: 45_000,
  })

  // Recalculate secondary field when saldo changes
  useEffect(() => {
    if (modalAberto !== 'adicionar' && modalAberto !== 'editar') return
    if (ultimoCampo === 'percentual') {
      const pct = parseFloat(formData.percentual.replace(',', '.'))
      if (!isNaN(pct) && saldo > 0)
        setFormData(f => ({ ...f, valor: (saldo * pct / 100).toFixed(2) }))
    } else {
      const val = parseFloat(formData.valor.replace(',', '.'))
      if (!isNaN(val) && saldo > 0)
        setFormData(f => ({ ...f, percentual: (val / saldo * 100).toFixed(2) }))
    }
  }, [saldo])

  function showToast(msg: string, tipo: 'ok' | 'erro' = 'ok') {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  function totalAportado(id: string) {
    return (aportes[id] || []).reduce((acc, a) => acc + a.valor, 0)
  }

  function ultimoSaldoAtual(id: string) {
    const lista = aportes[id] || []
    for (let i = lista.length - 1; i >= 0; i--) {
      if (lista[i].saldo_atual !== null) return lista[i].saldo_atual
    }
    return null
  }

  const totalMeta = useMemo(() => saldo > 0 ? saldo * itens.reduce((acc, i) => acc + i.percentual, 0) / 100 : 0, [saldo, itens])
  const totalMetaPrevisto = useMemo(() => saldoPrevisto > 0 ? saldoPrevisto * itens.reduce((acc, i) => acc + i.percentual, 0) / 100 : 0, [saldoPrevisto, itens])
  const totalPercentual = useMemo(() => itens.reduce((acc, i) => acc + i.percentual, 0), [itens])
  const totalAportadoGeral = useMemo(() => itens.reduce((acc, i) => acc + totalAportado(i.id), 0), [itens, aportes])

  function percentualDisponivel(excludeId?: string) {
    return 100 - itens.filter(i => i.id !== excludeId).reduce((acc, i) => acc + i.percentual, 0)
  }

  function handlePercentualChange(v: string) {
    const clean = numericOnly(v)
    setUltimoCampo('percentual')
    const pct = parseFloat(clean.replace(',', '.'))
    setFormData(f => ({ ...f, percentual: clean, valor: !isNaN(pct) && saldo > 0 ? (saldo * pct / 100).toFixed(2) : '' }))
  }

  function handleValorChange(v: string) {
    const clean = numericOnly(v)
    setUltimoCampo('valor')
    const val = parseFloat(clean.replace(',', '.'))
    setFormData(f => ({ ...f, valor: clean, percentual: !isNaN(val) && saldo > 0 ? (val / saldo * 100).toFixed(2) : '' }))
  }

  // ── Salvar investimento ──────────────────────────────────────
  async function salvar() {
    const pct = parseFloat(formData.percentual.replace(',', '.'))
    if (!formData.descricao.trim() || isNaN(pct) || pct <= 0) return

    const disponivel = percentualDisponivel(itemSelecionado?.id)
    if (pct > disponivel + 0.001) {
      showToast(`Limite disponível: ${disponivel.toFixed(2)}%`, 'erro')
      return
    }

    const mesRef = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')
    const tambemFuturos = aplicarFuturos

    if (modalAberto === 'adicionar') {
      const tempId = `temp-${Date.now()}`
      const itemOtimista: Investimento = {
        id: tempId,
        descricao: formData.descricao.trim(),
        percentual: pct,
        mes_referencia: mesRef,
        created_at: new Date().toISOString(),
      }
      const quantidade = Math.min(
        MESES_FUTUROS_MAXIMO,
        Math.max(1, parseInt(quantidadeMesesFuturos, 10) || MESES_FUTUROS_PADRAO)
      )

      // Feedback imediato: fecha modal e adiciona item otimisticamente
      fecharModal()
      setItens(prev => [...prev, itemOtimista])
      setNewItemId(tempId)
      setTimeout(() => setNewItemId(null), 400)
      showToast('Investimento adicionado!')

      const { data: insertData, error } = await supabase.from('investimentos').insert([{
        descricao: formData.descricao.trim(), percentual: pct, mes_referencia: mesRef,
      }]).select()
      if (!error) {
        const realId = insertData?.[0]?.id
        if (realId) {
          setItens(prev => prev.map(i => i.id === tempId
            ? { ...itemOtimista, id: realId, created_at: insertData[0].created_at }
            : i
          ))
        }
        log('inserir', 'investimentos', `Novo investimento: ${formData.descricao.trim()} — ${pct}%`)

        if (tambemFuturos) {
          try {
            await criarRegistrosFuturos(
              'investimentos',
              { descricao: formData.descricao.trim(), percentual: pct },
              mesSelecionado,
              quantidade
            )
            showToast(`Investimento adicionado e repetido nos próximos ${quantidade} mês(es)`)
          } catch {
            showToast('Investimento adicionado, mas houve erro ao repetir nos meses futuros', 'erro')
          }
        }
      } else {
        setItens(prev => prev.filter(i => i.id !== tempId))
        showToast('Erro ao adicionar', 'erro')
      }
    } else if (itemSelecionado) {
      const id = itemSelecionado.id
      const originalItem = itemSelecionado

      // Feedback imediato: fecha modal e atualiza otimisticamente
      fecharModal()
      setItens(prev => prev.map(i => i.id === id
        ? { ...i, descricao: formData.descricao.trim(), percentual: pct }
        : i
      ))
      showToast('Atualizado!')

      const { error } = await supabase.from('investimentos')
        .update({ descricao: formData.descricao.trim(), percentual: pct })
        .eq('id', id)
      if (!error) {
        log('editar', 'investimentos', `Editado: ${formData.descricao.trim()} — ${pct}%`)
        if (tambemFuturos) {
          try {
            const alterados = await atualizarRegistrosFuturos(
              'investimentos',
              { descricao: originalItem.descricao },
              mesSelecionado,
              { descricao: formData.descricao.trim(), percentual: pct }
            )
            if (alterados > 0) showToast(`Atualizado (e ${alterados} ocorrência(s) futura(s))`)
          } catch {
            showToast('Atualizado, mas houve erro ao aplicar aos meses futuros', 'erro')
          }
        }
      } else {
        // Reverte em caso de erro
        setItens(prev => prev.map(i => i.id === id ? originalItem : i))
        showToast('Erro ao salvar', 'erro')
      }
    }
  }

  async function excluir(id: string, tambemFuturos: boolean) {
    const item = itens.find(i => i.id === id)
    fecharModal()

    setExitingIds(prev => new Set(prev).add(id))
    const removeTimer = setTimeout(() => {
      setItens(prev => prev.filter(i => i.id !== id))
      setExitingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }, 300)

    const { error } = await supabase.from('investimentos').delete().eq('id', id)
    if (!error) {
      log('excluir', 'investimentos', `Excluído: ${item?.descricao ?? id}`)
      if (tambemFuturos && item) {
        try {
          const removidos = await excluirRegistrosFuturos(
            'investimentos',
            { descricao: item.descricao },
            mesSelecionado
          )
          showToast(removidos > 0 ? `Excluído (e ${removidos} ocorrência(s) futura(s))` : 'Excluído')
        } catch {
          showToast('Excluído, mas houve erro ao excluir as ocorrências futuras', 'erro')
        }
      } else {
        showToast('Excluído')
      }
      refetch()
    } else {
      clearTimeout(removeTimer)
      setExitingIds(prev => { const s = new Set(prev); s.delete(id); return s })
      if (item) setItens(prev => [...prev, item])
      showToast('Erro ao excluir', 'erro')
    }
  }

  function abrirEditar(item: Investimento) {
    setItemSelecionado(item)
    setFormData({
      descricao: item.descricao,
      percentual: String(item.percentual),
      valor: saldo > 0 ? (saldo * item.percentual / 100).toFixed(2) : '',
    })
    setUltimoCampo('percentual')
    setAplicarFuturos(false)
    setModalAberto('editar')
  }

  function fecharModal() {
    setModalAberto(null)
    setItemSelecionado(null)
    setFormData({ descricao: '', percentual: '', valor: '' })
    setAplicarFuturos(false)
  }

  // ── Aportes ──────────────────────────────────────────────────
  async function salvarAporte() {
    if (!modalAporte) return
    const valor = parseFloat(formAporte.valor.replace(',', '.'))
    if (isNaN(valor) || valor <= 0) return
    const saldoAtualInformado = parseFloat(formAporte.saldo_atual.replace(',', '.'))
    const saldoAtualValido = !isNaN(saldoAtualInformado) && saldoAtualInformado >= 0

    const { error } = await supabase.from('investimentos_aportes').insert([{
      investimento_id: modalAporte.id,
      valor,
      saldo_atual: saldoAtualValido ? saldoAtualInformado : null,
      data_aporte: formAporte.data_aporte,
      observacao: formAporte.observacao.trim() || null,
    }])

    if (error) { showToast('Erro ao registrar aporte', 'erro'); return }
    log('aporte', 'investimentos', `Aporte em ${modalAporte.descricao} — ${formatBRL(valor)}`, valor)
    showToast(`Aporte de ${formatBRL(valor)} registrado!`)
    setModalAporte(null)
    setFormAporte({ valor: '', saldo_atual: '', data_aporte: format(new Date(), 'yyyy-MM-dd'), observacao: '' })
    refetch()
  }

  async function excluirAporte(aporte: Aporte) {
    const inv = itens.find(i => i.id === aporte.investimento_id)
    const { error } = await supabase.from('investimentos_aportes').delete().eq('id', aporte.id)
    if (!error) {
      log('excluir', 'investimentos', `Aporte removido de ${inv?.descricao ?? 'investimento'} — ${formatBRL(aporte.valor)}`, aporte.valor)
      refetch(); showToast('Aporte removido')
    } else showToast('Erro ao remover aporte', 'erro')
  }

  // ── Importar mês anterior ────────────────────────────────────
  async function abrirModalImportar() {
    const mesAnterior = startOfMonth(subMonths(mesSelecionado, 1))
    const { data } = await supabase
      .from('investimentos')
      .select('*')
      .eq('mes_referencia', format(mesAnterior, 'yyyy-MM-dd'))
      .order('created_at', { ascending: true })
    setPreviewImport({ itens: data || [], mesOrigem: format(mesAnterior, 'MMMM yyyy', { locale: ptBR }) })
    setModalAberto('importar')
  }

  async function confirmarImportar() {
    if (!previewImport) return
    setImportando(true)
    const mesAtualStr = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')
    try {
      // 1. Busca IDs dos investimentos existentes no mês atual
      const { data: existentes } = await supabase
        .from('investimentos')
        .select('id')
        .eq('mes_referencia', mesAtualStr)
      const idsExistentes = (existentes || []).map(i => i.id)

      // 2. Insere os investimentos do mês anterior primeiro — se falhar, os dados existentes são preservados
      const novos = previewImport.itens.map(i => ({
        descricao: i.descricao, percentual: i.percentual, mes_referencia: mesAtualStr,
      }))
      if (novos.length > 0) {
        const { error: insertError } = await supabase.from('investimentos').insert(novos)
        if (insertError) throw insertError
      }

      // 3. Só apaga os existentes após o insert ser bem-sucedido
      if (idsExistentes.length > 0) {
        await supabase.from('investimentos').delete().in('id', idsExistentes)
      }

      log('importar', 'investimentos', `Importados ${novos.length} investimento(s) de ${previewImport.mesOrigem}`)
      fecharModal()
      setPreviewImport(null)
      refetch()
      showToast(`${novos.length} investimento(s) importado(s)!`)
    } catch (e) {
      console.error('Erro ao importar investimentos:', e)
      showToast('Erro ao importar. Os dados existentes foram preservados.', 'erro')
    } finally {
      setImportando(false)
    }
  }

  const [filtroStatus, setFiltroStatus] = useState<'' | 'concluido' | 'andamento'>('')

  const itensFiltrados = useMemo(() => {
    if (filtroStatus === '') return itens
    return itens.filter(item => {
      const meta = saldo > 0 ? saldo * item.percentual / 100 : 0
      const aportado = totalAportado(item.id)
      const concluido = aportado >= meta && meta > 0
      return filtroStatus === 'concluido' ? concluido : !concluido
    })
  }, [itens, filtroStatus, saldo, aportes])

  const progressoGeralPct = totalMeta > 0 ? Math.min((totalAportadoGeral / totalMeta) * 100, 100) : 0

  return (
    <div className="space-y-3">

      {/* Toast */}
      {toast && (
        <div className={`toast-enter fixed top-4 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium shadow-float ${
          toast.tipo === 'ok' ? 'bg-gray-900 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Resumo */}
      <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3.5">
          <div className="w-7 h-7 rounded-xl bg-violet-100 flex items-center justify-center">
            <PiggyBank className="w-4 h-4 text-violet-600" />
          </div>
          <span className="font-semibold text-gray-800 text-sm">Resumo de Investimentos</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 mb-3.5">
          <div className="bg-gray-50 rounded-2xl p-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">Saldo atual</p>
            <p className={`text-base font-bold num ${saldo >= 0 ? 'text-gray-800' : 'text-red-600'}`}>
              {formatBRL(saldo)}
            </p>
          </div>
          <div className="bg-violet-50 rounded-2xl p-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-400 mb-0.5">Meta prevista</p>
            <p className={`text-base font-bold num ${totalMetaPrevisto >= 0 ? 'text-violet-700' : 'text-red-600'}`}>
              {formatBRL(totalMetaPrevisto)}
            </p>
            <p className="text-[10px] text-violet-400 tabular-nums mt-0.5">{totalPercentual.toFixed(0)}% do previsto</p>
          </div>
          <div className="bg-emerald-50 rounded-2xl p-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-500 mb-0.5">Total aportado</p>
            <p className="text-base font-bold text-emerald-700 num">{formatBRL(totalAportadoGeral)}</p>
          </div>
          <div className="bg-gray-50 rounded-2xl p-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">Restante</p>
            <p className={`text-base font-bold num ${totalMeta - totalAportadoGeral > 0 ? 'text-gray-700' : 'text-emerald-600'}`}>
              {formatBRL(Math.max(0, totalMeta - totalAportadoGeral))}
            </p>
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1.5">
            <span>Progresso de aportes</span>
            <span className="font-bold text-violet-600 tabular-nums">{progressoGeralPct.toFixed(0)}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
            <div
              key={Math.round(progressoGeralPct)}
              className="h-1.5 rounded-full bg-gradient-to-r from-violet-500 to-violet-600 bar-enter"
              style={{ '--bar-w': `${progressoGeralPct}%` } as React.CSSProperties}
            />
          </div>
          <div className="flex justify-between text-[10px] text-gray-400 mt-1.5 tabular-nums">
            <span>Alocação: {totalPercentual.toFixed(1)}%</span>
            <span>{Math.max(0, 100 - totalPercentual).toFixed(1)}% disponível para alocar</span>
          </div>
        </div>

        {/* Filtros compactos */}
        <div className="flex gap-1.5 pt-3 border-t border-gray-100">
          {(['', 'concluido', 'andamento'] as const).map((f) => {
            const label = f === '' ? 'Todos' : f === 'concluido' ? 'Concluídos' : 'Em andamento'
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

      {/* Botões */}
      {isOnline && (
        <PageActionButtons
          onAdd={() => {
            setUltimoCampo('percentual')
            setAplicarFuturos(false)
            setQuantidadeMesesFuturos(String(MESES_FUTUROS_PADRAO))
            setModalAberto('adicionar')
          }}
          onImport={abrirModalImportar}
          addDisabled={totalPercentual >= 100}
          addColorClass="bg-violet-600 text-white hover:bg-violet-700"
          importColorClass="bg-gray-100 text-gray-600 hover:bg-gray-200"
        />
      )}

      {/* Lista */}
      <div className="bg-white rounded-3xl shadow-card border border-gray-100 overflow-hidden divide-y divide-gray-100">
        {itensFiltrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 gap-3">
            <div className="w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center">
              <PiggyBank className="w-6 h-6 text-violet-300" strokeWidth={1.5} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-500">
                {filtroStatus ? 'Nenhum item neste filtro' : 'Nenhum investimento cadastrado'}
              </p>
              {!filtroStatus && (
                <p className="text-xs text-gray-400 mt-0.5">Toque em + Adicionar para começar</p>
              )}
            </div>
          </div>
        ) : (
          itensFiltrados.map((item) => {
            const meta = saldo > 0 ? saldo * item.percentual / 100 : 0
            const metaPrevista = saldoPrevisto > 0 ? saldoPrevisto * item.percentual / 100 : 0
            const aportado = totalAportado(item.id)
            const saldoAtualItem = ultimoSaldoAtual(item.id)
            const progresso = meta > 0 ? Math.min((aportado / meta) * 100, 100) : 0
            const concluido = aportado >= meta && meta > 0

            return (
              <SwipeableItem
                key={item.id}
                onDelete={() => { setItemSelecionado(item); setAplicarFuturos(false); setModalAberto('excluir') }}
                disabled={!isOnline}
              >
                <div
                  className={`px-4 py-3 transition-[background-color,color,opacity] duration-200 ${concluido ? 'bg-green-50/40 dark:bg-green-900/20' : ''} ${isOnline ? 'cursor-pointer active:bg-gray-50 dark:active:bg-white/[0.06] hover:bg-gray-50/50 dark:hover:bg-white/[0.06]' : ''} ${exitingIds.has(item.id) ? 'item-exit' : newItemId === item.id ? 'item-new' : ''}`}
                  onClick={() => { if (isOnline) abrirEditar(item) }}
                  role={isOnline ? 'button' : undefined}
                  tabIndex={isOnline ? 0 : undefined}
                  onKeyDown={isOnline ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirEditar(item) } } : undefined}
                  aria-label={isOnline ? `Editar ${item.descricao}` : undefined}
                >
                  {/* Linha principal */}
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${concluido ? 'bg-green-500' : 'bg-violet-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{item.descricao}</p>
                      <p className="text-xs text-gray-400">{item.percentual.toFixed(2)}% do saldo</p>
                    </div>
                    <div className="text-right shrink-0 mr-1">
                      <p className={`text-sm font-bold ${concluido ? 'text-green-600' : 'text-violet-700'}`}>
                        {formatBRL(aportado)}
                      </p>
                      <p className="text-xs font-medium text-gray-500">
                        Calculado {formatBRL(meta)}
                      </p>
                      {metaPrevista !== meta && metaPrevista > 0 && (
                        <p className="text-xs text-violet-400">
                          Previsto {formatBRL(metaPrevista)}
                        </p>
                      )}
                      {saldoAtualItem !== null && (
                        <p className="text-xs text-gray-400">Saldo atual {formatBRL(saldoAtualItem)}</p>
                      )}
                    </div>
                    {/* Ações rápidas */}
                    <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {(aportes[item.id] || []).length > 0 && (
                        <button
                          onClick={() => setModalHistorico(item)}
                          className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition"
                          title="Histórico de aportes"
                        >
                          <History className="w-4 h-4" />
                        </button>
                      )}
                      {isOnline && (
                        <button
                          onClick={() => {
                            setModalAporte(item)
                            setFormAporte({
                              valor: '',
                              saldo_atual: ultimoSaldoAtual(item.id)?.toFixed(2) || '',
                              data_aporte: format(new Date(), 'yyyy-MM-dd'),
                              observacao: '',
                            })
                          }}
                          className="p-1.5 rounded-lg text-violet-600 hover:bg-violet-100 transition"
                          title="Registrar aporte"
                        >
                          <CirclePlus className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Barra de progresso do item */}
                  <div className="pl-5">
                    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full transition-[width] duration-500 ease-smooth ${concluido ? 'bg-green-500' : 'bg-violet-400'}`}
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

      {/* ── Modal: registrar aporte ── */}
      {modalAporte && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-float">
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-lg font-bold">Registrar Aporte</h3>
              <button onClick={() => setModalAporte(null)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">{modalAporte.descricao}</p>

            {/* Progresso atual */}
            {(() => {
              const meta = saldo > 0 ? saldo * modalAporte.percentual / 100 : 0
              const aportado = totalAportado(modalAporte.id)
              const restante = Math.max(0, meta - aportado)
              return (
                <div className="bg-violet-50 rounded-xl px-3 py-2 mb-4 text-xs text-gray-600 flex justify-between">
                  <span>Aportado: <strong className="text-violet-700">{formatBRL(aportado)}</strong></span>
                  <span>Meta: <strong>{formatBRL(meta)}</strong></span>
                  <span>Falta: <strong className="text-gray-800">{formatBRL(restante)}</strong></span>
                </div>
              )
            })()}

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Valor do aporte (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="w-full border border-gray-200 rounded-xl p-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-violet-400"
                  placeholder="0,00"
                  value={formAporte.valor}
                  onChange={(e) => setFormAporte(f => ({ ...f, valor: numericOnly(e.target.value) }))}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Data do aporte</label>
                <input
                  type="date"
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  value={formAporte.data_aporte}
                  onChange={(e) => setFormAporte(f => ({ ...f, data_aporte: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Saldo atual (R$) — apenas consulta</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  placeholder="Ex: 1500,00"
                  value={formAporte.saldo_atual}
                  onChange={(e) => setFormAporte(f => ({ ...f, saldo_atual: numericOnly(e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Observação (opcional)</label>
                <input
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  placeholder="Ex: Aporte parcial, aguardando próximo salário…"
                  value={formAporte.observacao}
                  onChange={(e) => setFormAporte(f => ({ ...f, observacao: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setModalAporte(null)} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600">
                Cancelar
              </button>
              <button onClick={salvarAporte} className="flex-1 py-3 rounded-xl bg-violet-600 text-white font-semibold">
                Confirmar
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* ── Modal: histórico de aportes ── */}
      {modalHistorico && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-float">
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-lg font-bold">Histórico de Aportes</h3>
              <button onClick={() => { setModalHistorico(null); setAportePendingDelete(null) }} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">{modalHistorico.descricao}</p>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {(aportes[modalHistorico.id] || []).map((a) => (
                <div key={a.id} className={`rounded-xl overflow-hidden transition-all ${
                  aportePendingDelete === a.id ? 'ring-2 ring-red-300' : ''
                }`}>
                  <div className="flex items-center gap-3 bg-gray-50 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{formatBRL(a.valor)}</p>
                      <p className="text-xs text-gray-400">
                        {format(new Date(a.data_aporte + 'T12:00:00'), "dd 'de' MMMM", { locale: ptBR })}
                        {a.observacao && <span className="ml-1">· {a.observacao}</span>}
                      </p>
                      {a.saldo_atual !== null && (
                        <p className="text-xs text-gray-500">Saldo atual no aporte: {formatBRL(a.saldo_atual)}</p>
                      )}
                    </div>
                    {aportePendingDelete === a.id ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => setAportePendingDelete(null)}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-200 text-gray-600 hover:bg-gray-300 transition"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => { excluirAporte(a); setAportePendingDelete(null) }}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition"
                        >
                          Excluir
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAportePendingDelete(a.id)}
                        className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t mt-3 pt-3 flex justify-between text-sm font-medium text-gray-600">
              <span>Total aportado</span>
              <span className="text-violet-700 font-bold">
                {formatBRL(totalAportado(modalHistorico.id))}
              </span>
            </div>
            <button
              onClick={() => {
                setModalHistorico(null)
                setModalAporte(modalHistorico)
                setFormAporte({
                  valor: '',
                  saldo_atual: ultimoSaldoAtual(modalHistorico.id)?.toFixed(2) || '',
                  data_aporte: format(new Date(), 'yyyy-MM-dd'),
                  observacao: '',
                })
              }}
              className="w-full mt-4 py-3 rounded-xl bg-violet-600 text-white font-semibold flex items-center justify-center gap-2"
            >
              <CirclePlus className="w-4 h-4" />
              Novo aporte
            </button>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* ── Modal: adicionar / editar investimento ── */}
      {(modalAberto === 'adicionar' || modalAberto === 'editar') && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-float">
            <h3 className="text-lg font-bold mb-5">
              {modalAberto === 'adicionar' ? 'Novo Investimento' : 'Editar Investimento'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Descrição</label>
                <input
                  type="text"
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  placeholder="Ex: Tesouro Direto, Renda Fixa…"
                  value={formData.descricao}
                  onChange={(e) => setFormData(f => ({ ...f, descricao: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  Percentual do saldo (%)
                  <span className="ml-1 text-gray-400 font-normal">
                    — disponível: {percentualDisponivel(itemSelecionado?.id).toFixed(2)}%
                  </span>
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  placeholder="Ex: 20"
                  value={formData.percentual}
                  onChange={(e) => handlePercentualChange(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  Valor em R$
                  <span className="ml-1 text-gray-400 font-normal">— saldo: {formatBRL(saldo)}</span>
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  placeholder="0,00"
                  value={formData.valor}
                  onChange={(e) => handleValorChange(e.target.value)}
                />
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={aplicarFuturos}
                    onChange={(e) => setAplicarFuturos(e.target.checked)}
                    className="w-4 h-4 rounded accent-violet-600"
                  />
                  {modalAberto === 'adicionar' ? 'Repetir nos meses futuros' : 'Aplicar também aos meses futuros'}
                </label>
                {modalAberto === 'adicionar' && aplicarFuturos && (
                  <div className="mt-2">
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Por quantos meses</label>
                    <input
                      type="number"
                      min={1}
                      max={MESES_FUTUROS_MAXIMO}
                      value={quantidadeMesesFuturos}
                      onChange={(e) => setQuantidadeMesesFuturos(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl p-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={fecharModal} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600">
                Cancelar
              </button>
              <button onClick={salvar} className="flex-1 py-3 rounded-xl bg-violet-600 text-white font-semibold">
                Salvar
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* ── Modal: excluir investimento ── */}
      {modalAberto === 'excluir' && itemSelecionado && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-float">
            <h3 className="text-lg font-bold mb-2">Excluir investimento</h3>
            <p className="text-sm text-gray-500 mb-2">
              Tem certeza que deseja excluir{' '}
              <span className="font-semibold text-gray-800">&quot;{itemSelecionado.descricao}&quot;</span>?
            </p>
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-4">
              Todos os aportes registrados também serão excluídos.
            </p>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer bg-gray-50 rounded-xl p-3 mb-6">
              <input
                type="checkbox"
                checked={aplicarFuturos}
                onChange={(e) => setAplicarFuturos(e.target.checked)}
                className="w-4 h-4 rounded accent-red-500"
              />
              Excluir também dos meses futuros
            </label>
            <div className="flex gap-3">
              <button onClick={fecharModal} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600">
                Cancelar
              </button>
              <button onClick={() => excluir(itemSelecionado.id, aplicarFuturos)} className="flex-1 py-3 rounded-xl bg-red-500 text-white font-semibold">
                Excluir
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* ── Modal: importar mês anterior ── */}
      {modalAberto === 'importar' && previewImport && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-float">
            <h3 className="text-lg font-bold mb-1">Importar mês anterior</h3>
            <p className="text-sm text-gray-500 mb-4">
              Investimentos de <span className="font-semibold capitalize">{previewImport.mesOrigem}</span>
            </p>
            {previewImport.itens.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Nenhum investimento no mês anterior</p>
            ) : (
              <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
                {previewImport.itens.map((i) => (
                  <div key={i.id} className="flex justify-between text-sm bg-gray-50 rounded-xl px-3 py-2">
                    <span className="text-gray-700">{i.descricao}</span>
                    <span className="text-violet-700 font-medium">
                      {i.percentual.toFixed(2)}% · {formatBRL(saldo > 0 ? saldo * i.percentual / 100 : 0)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-4">
              Os investimentos do mês atual e seus aportes serão substituídos.
            </p>
            <div className="flex gap-3">
              <button onClick={fecharModal} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600">
                Cancelar
              </button>
              <button
                onClick={confirmarImportar}
                disabled={importando || previewImport.itens.length === 0}
                className="flex-1 py-3 rounded-xl bg-violet-600 text-white font-semibold disabled:opacity-50"
              >
                {importando ? 'Importando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  )
}
