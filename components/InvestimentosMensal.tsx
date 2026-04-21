'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { PiggyBank, Pencil, Trash2, Plus, Download, CirclePlus, History, X } from 'lucide-react'
import { log, numericOnly } from '@/lib/logger'

interface Investimento {
  id: string
  descricao: string
  percentual: number
  saldo_atual: number | null
  mes_referencia: string
  created_at: string
}

interface Aporte {
  id: string
  investimento_id: string
  valor: number
  data_aporte: string
  observacao: string | null
  created_at: string
}

interface Props {
  mesSelecionado: Date
  saldo: number
}

export default function InvestimentosMensal({ mesSelecionado, saldo }: Props) {
  const [itens, setItens] = useState<Investimento[]>([])
  const [aportes, setAportes] = useState<Record<string, Aporte[]>>({})

  // Modais de investimento
  const [modalAberto, setModalAberto] = useState<string | null>(null)
  const [itemSelecionado, setItemSelecionado] = useState<Investimento | null>(null)
  const [formData, setFormData] = useState({ descricao: '', percentual: '', valor: '' })
  const [ultimoCampo, setUltimoCampo] = useState<'percentual' | 'valor'>('percentual')

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

  useEffect(() => { carregarItens() }, [mesSelecionado])

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

  async function carregarItens() {
    const mesRef = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')
    const { data: invData } = await supabase
      .from('investimentos')
      .select('*')
      .eq('mes_referencia', mesRef)
      .order('created_at', { ascending: true })

    const ids = (invData || []).map(i => i.id)
    let aportesMap: Record<string, Aporte[]> = {}

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

    setItens(invData || [])
    setAportes(aportesMap)
  }

  function totalAportado(id: string) {
    return (aportes[id] || []).reduce((acc, a) => acc + a.valor, 0)
  }

  const totalMeta = useMemo(() => saldo > 0 ? saldo * itens.reduce((acc, i) => acc + i.percentual, 0) / 100 : 0, [saldo, itens])
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

    if (modalAberto === 'adicionar') {
      const { error } = await supabase.from('investimentos').insert([{
        descricao: formData.descricao.trim(), percentual: pct, mes_referencia: mesRef,
      }])
      if (error) { showToast('Erro ao adicionar', 'erro'); return }
      log('inserir', 'investimentos', `Novo investimento: ${formData.descricao.trim()} — ${pct}%`)
      showToast('Investimento adicionado!')
    } else if (itemSelecionado) {
      const { error } = await supabase.from('investimentos')
        .update({ descricao: formData.descricao.trim(), percentual: pct })
        .eq('id', itemSelecionado.id)
      if (error) { showToast('Erro ao salvar', 'erro'); return }
      log('editar', 'investimentos', `Editado: ${formData.descricao.trim()} — ${pct}%`)
      showToast('Atualizado!')
    }

    fecharModal()
    carregarItens()
  }

  async function excluir(id: string) {
    const item = itens.find(i => i.id === id)
    const { error } = await supabase.from('investimentos').delete().eq('id', id)
    if (!error) {
      log('excluir', 'investimentos', `Excluído: ${item?.descricao ?? id}`)
      fecharModal(); carregarItens(); showToast('Excluído')
    } else showToast('Erro ao excluir', 'erro')
  }

  function abrirEditar(item: Investimento) {
    setItemSelecionado(item)
    setFormData({
      descricao: item.descricao,
      percentual: String(item.percentual),
      valor: saldo > 0 ? (saldo * item.percentual / 100).toFixed(2) : '',
    })
    setUltimoCampo('percentual')
    setModalAberto('editar')
  }

  function fecharModal() {
    setModalAberto(null)
    setItemSelecionado(null)
    setFormData({ descricao: '', percentual: '', valor: '' })
  }

  // ── Aportes ──────────────────────────────────────────────────
  async function salvarAporte() {
    if (!modalAporte) return
    const valor = parseFloat(formAporte.valor.replace(',', '.'))
    if (isNaN(valor) || valor <= 0) return

    const { error } = await supabase.from('investimentos_aportes').insert([{
      investimento_id: modalAporte.id,
      valor,
      data_aporte: formAporte.data_aporte,
      observacao: formAporte.observacao.trim() || null,
    }])

    if (error) { showToast('Erro ao registrar aporte', 'erro'); return }
    const saldoAtualInformado = parseFloat(formAporte.saldo_atual.replace(',', '.'))
    if (!isNaN(saldoAtualInformado) && saldoAtualInformado >= 0) {
      const { error: saldoError } = await supabase
        .from('investimentos')
        .update({ saldo_atual: saldoAtualInformado })
        .eq('id', modalAporte.id)
      if (saldoError) { showToast('Aporte salvo, mas houve erro ao atualizar saldo atual', 'erro'); return }
    }
    log('aporte', 'investimentos', `Aporte em ${modalAporte.descricao} — R$ ${valor.toFixed(2)}`, valor)
    showToast(`Aporte de R$ ${valor.toFixed(2)} registrado!`)
    setModalAporte(null)
    setFormAporte({ valor: '', saldo_atual: '', data_aporte: format(new Date(), 'yyyy-MM-dd'), observacao: '' })
    carregarItens()
  }

  async function excluirAporte(aporte: Aporte) {
    const inv = itens.find(i => i.id === aporte.investimento_id)
    const { error } = await supabase.from('investimentos_aportes').delete().eq('id', aporte.id)
    if (!error) {
      log('excluir', 'investimentos', `Aporte removido de ${inv?.descricao ?? 'investimento'} — R$ ${aporte.valor.toFixed(2)}`, aporte.valor)
      carregarItens(); showToast('Aporte removido')
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
    await supabase.from('investimentos').delete().eq('mes_referencia', mesAtualStr)
    const novos = previewImport.itens.map(i => ({
      descricao: i.descricao, percentual: i.percentual, mes_referencia: mesAtualStr,
    }))
    if (novos.length > 0) await supabase.from('investimentos').insert(novos)
    log('importar', 'investimentos', `Importados ${novos.length} investimento(s) de ${previewImport.mesOrigem}`)
    setImportando(false)
    fecharModal()
    setPreviewImport(null)
    carregarItens()
    showToast(`${novos.length} investimento(s) importado(s)!`)
  }

  const pctBar = Math.min(totalPercentual, 100)
  const progressoGeralPct = totalMeta > 0 ? Math.min((totalAportadoGeral / totalMeta) * 100, 100) : 0

  return (
    <div className="space-y-3">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg ${
          toast.tipo === 'ok' ? 'bg-green-600 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Resumo */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center gap-2 mb-3">
          <PiggyBank className="w-5 h-5 text-violet-600" />
          <span className="font-semibold text-gray-800">Resumo de Investimentos</span>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-500 mb-0.5">Saldo disponível</p>
            <p className={`text-lg font-bold ${saldo >= 0 ? 'text-gray-800' : 'text-red-600'}`}>
              R$ {saldo.toFixed(2)}
            </p>
          </div>
          <div className="bg-violet-50 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-500 mb-0.5">Meta do mês</p>
            <p className="text-lg font-bold text-violet-700">R$ {totalMeta.toFixed(2)}</p>
            <p className="text-xs text-violet-400">{totalPercentual.toFixed(1)}% do saldo</p>
          </div>
          <div className="bg-green-50 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-500 mb-0.5">Total aportado</p>
            <p className="text-lg font-bold text-green-700">R$ {totalAportadoGeral.toFixed(2)}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-500 mb-0.5">Restante</p>
            <p className={`text-lg font-bold ${totalMeta - totalAportadoGeral > 0 ? 'text-gray-700' : 'text-green-600'}`}>
              R$ {Math.max(0, totalMeta - totalAportadoGeral).toFixed(2)}
            </p>
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Progresso de aportes</span>
            <span className="font-semibold text-violet-700">{progressoGeralPct.toFixed(0)}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 rounded-full bg-violet-500 transition-all duration-700"
              style={{ width: `${progressoGeralPct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>Alocação: {totalPercentual.toFixed(1)}%</span>
            <span>{Math.max(0, 100 - totalPercentual).toFixed(1)}% do saldo disponível para alocar</span>
          </div>
        </div>
      </div>

      {/* Lista */}
      <div className="bg-white rounded-2xl shadow overflow-hidden divide-y divide-gray-100">
        {itens.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-gray-300">
            <PiggyBank className="w-10 h-10" />
            <p className="text-sm">Nenhum investimento cadastrado</p>
          </div>
        ) : (
          itens.map((item) => {
            const meta = saldo > 0 ? saldo * item.percentual / 100 : 0
            const aportado = totalAportado(item.id)
            const progresso = meta > 0 ? Math.min((aportado / meta) * 100, 100) : 0
            const concluido = aportado >= meta && meta > 0

            return (
              <div key={item.id} className={`px-4 py-3 ${concluido ? 'bg-green-50/40' : ''}`}>
                {/* Linha principal */}
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${concluido ? 'bg-green-500' : 'bg-violet-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{item.descricao}</p>
                    <p className="text-xs text-gray-400">{item.percentual.toFixed(2)}% do saldo</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-bold ${concluido ? 'text-green-600' : 'text-violet-700'}`}>
                      R$ {aportado.toFixed(2)}
                    </p>
                    <p className="text-xs font-medium text-gray-500">
                      Meta R$ {meta.toFixed(2)}
                    </p>
                    {item.saldo_atual !== null && (
                      <p className="text-xs text-gray-400">Saldo atual R$ {item.saldo_atual.toFixed(2)}</p>
                    )}
                  </div>
                </div>

                {/* Barra de progresso do item */}
                <div className="mb-2.5 pl-5">
                  <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full transition-all duration-500 ${concluido ? 'bg-green-500' : 'bg-violet-400'}`}
                      style={{ width: `${progresso}%` }}
                    />
                  </div>
                </div>

                {/* Ações */}
                <div className="flex items-center gap-1 pl-5">
                  <button
                    onClick={() => {
                      setModalAporte(item)
                      setFormAporte({
                        valor: '',
                        saldo_atual: item.saldo_atual !== null ? item.saldo_atual.toFixed(2) : '',
                        data_aporte: format(new Date(), 'yyyy-MM-dd'),
                        observacao: '',
                      })
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 transition"
                  >
                    <CirclePlus className="w-3.5 h-3.5" />
                    Aportar
                  </button>
                  {(aportes[item.id] || []).length > 0 && (
                    <button
                      onClick={() => setModalHistorico(item)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 bg-gray-50 hover:bg-gray-100 transition"
                    >
                      <History className="w-3.5 h-3.5" />
                      {(aportes[item.id] || []).length} aporte(s)
                    </button>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={() => abrirEditar(item)}
                    className="p-1.5 rounded-lg text-blue-500 hover:bg-blue-50 transition"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { setItemSelecionado(item); setModalAberto('excluir') }}
                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Botões */}
      <div className="flex gap-2">
        <button
          onClick={abrirModalImportar}
          className="bg-gray-100 text-gray-600 py-3 px-4 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-gray-200 transition"
        >
          <Download className="w-4 h-4" />
          Mês anterior
        </button>
        <button
          onClick={() => { setUltimoCampo('percentual'); setModalAberto('adicionar') }}
          disabled={totalPercentual >= 100}
          className="flex-1 bg-violet-600 text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-violet-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-5 h-5" />
          Adicionar investimento
        </button>
      </div>

      {/* ── Modal: registrar aporte ── */}
      {modalAporte && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
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
                  <span>Aportado: <strong className="text-violet-700">R$ {aportado.toFixed(2)}</strong></span>
                  <span>Meta: <strong>R$ {meta.toFixed(2)}</strong></span>
                  <span>Falta: <strong className="text-gray-800">R$ {restante.toFixed(2)}</strong></span>
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
      )}

      {/* ── Modal: histórico de aportes ── */}
      {modalHistorico && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
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
                      <p className="text-sm font-semibold text-gray-800">R$ {a.valor.toFixed(2)}</p>
                      <p className="text-xs text-gray-400">
                        {format(new Date(a.data_aporte + 'T12:00:00'), "dd 'de' MMMM", { locale: ptBR })}
                        {a.observacao && <span className="ml-1">· {a.observacao}</span>}
                      </p>
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
                R$ {totalAportado(modalHistorico.id).toFixed(2)}
              </span>
            </div>
            <button
              onClick={() => {
                setModalHistorico(null)
                setModalAporte(modalHistorico)
                setFormAporte({
                  valor: '',
                  saldo_atual: modalHistorico.saldo_atual !== null ? modalHistorico.saldo_atual.toFixed(2) : '',
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
      )}

      {/* ── Modal: adicionar / editar investimento ── */}
      {(modalAberto === 'adicionar' || modalAberto === 'editar') && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
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
                  <span className="ml-1 text-gray-400 font-normal">— saldo: R$ {saldo.toFixed(2)}</span>
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
      )}

      {/* ── Modal: excluir investimento ── */}
      {modalAberto === 'excluir' && itemSelecionado && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold mb-2">Excluir investimento</h3>
            <p className="text-sm text-gray-500 mb-2">
              Tem certeza que deseja excluir{' '}
              <span className="font-semibold text-gray-800">"{itemSelecionado.descricao}"</span>?
            </p>
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-6">
              Todos os aportes registrados também serão excluídos.
            </p>
            <div className="flex gap-3">
              <button onClick={fecharModal} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600">
                Cancelar
              </button>
              <button onClick={() => excluir(itemSelecionado.id)} className="flex-1 py-3 rounded-xl bg-red-500 text-white font-semibold">
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: importar mês anterior ── */}
      {modalAberto === 'importar' && previewImport && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
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
                      {i.percentual.toFixed(2)}% · R$ {(saldo > 0 ? saldo * i.percentual / 100 : 0).toFixed(2)}
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
      )}
    </div>
  )
}
