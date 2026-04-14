'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth } from 'date-fns'
import { Pencil, Trash2, Plus, TrendingUp, CirclePlus, History, X } from 'lucide-react'
import { log, numericOnly } from '@/lib/logger'

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

export default function ReceitasMensal({ mesSelecionado }: { mesSelecionado: Date }) {
  const [itens, setItens] = useState<ItemReceita[]>([])
  const [recebimentos, setRecebimentos] = useState<Record<string, Recebimento[]>>({})

  // Modais de item (adicionar/editar/excluir)
  const [modalAberto, setModalAberto] = useState<string | null>(null)
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
  const [recebimentoPendingDelete, setRecebimentoPendingDelete] = useState<string | null>(null)

  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null)

  useEffect(() => { carregarItens() }, [mesSelecionado])

  function showToast(msg: string, tipo: 'ok' | 'erro' = 'ok') {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  async function carregarItens() {
    const mesRef = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('planejamento')
      .select('*')
      .eq('mes_referencia', mesRef)
      .ilike('item', '[RECEITA]%')
      .order('item', { ascending: true })

    const itensList = data || []
    setItens(itensList)

    const ids = itensList.map(i => i.id)
    if (ids.length > 0) {
      const { data: recs } = await supabase
        .from('receitas_recebimentos')
        .select('*')
        .in('planejamento_id', ids)
        .order('data_recebimento', { ascending: true })

      const recsMap: Record<string, Recebimento[]> = {}
      for (const r of (recs || [])) {
        if (!recsMap[r.planejamento_id]) recsMap[r.planejamento_id] = []
        recsMap[r.planejamento_id].push(r)
      }
      setRecebimentos(recsMap)
    } else {
      setRecebimentos({})
    }
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

    log('receber', 'receitas', `Recebimento: ${paraNomeExibicao(modalRecebimento.item)} — R$ ${valor.toFixed(2)}`, valor)
    showToast(`R$ ${valor.toFixed(2)} registrado!`)
    setModalRecebimento(null)
    setFormRecebimento({ valor: '', data_recebimento: format(new Date(), 'yyyy-MM-dd'), observacao: '' })
    carregarItens()
  }

  async function excluirRecebimento(r: Recebimento) {
    const item = itens.find(i => i.id === r.planejamento_id)
    const { error } = await supabase.from('receitas_recebimentos').delete().eq('id', r.id)
    if (!error) {
      const remaining = (recebimentos[r.planejamento_id] || []).filter(x => x.id !== r.id)
      const novoTotal = remaining.reduce((acc, x) => acc + x.valor, 0)
      if (item && novoTotal < item.valor_previsto) {
        await supabase.from('planejamento').update({ pago: false, valor_real: null }).eq('id', r.planejamento_id)
      }
      log('excluir', 'receitas', `Recebimento excluído: ${item ? paraNomeExibicao(item.item) : ''}`, r.valor)
      showToast('Recebimento excluído')
      carregarItens()
    }
    setRecebimentoPendingDelete(null)
  }

  async function excluir(id: string) {
    const item = itens.find(i => i.id === id)
    await supabase.from('planejamento').delete().eq('id', id)
    log('excluir', 'receitas', `Excluída: ${item ? paraNomeExibicao(item.item) : id}`)
    setModalAberto(null)
    carregarItens()
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
      await supabase.from('planejamento').insert([{
        ...payload,
        categoria: 'Extra',
        mes_referencia: mesRef,
        pago: false,
        valor_real: null,
      }])
      log('inserir', 'receitas', `Nova receita: ${formData.item} — R$ ${valor.toFixed(2)}`, valor)
    } else if (itemSelecionado) {
      await supabase.from('planejamento').update(payload).eq('id', itemSelecionado.id)
      log('editar', 'receitas', `Editada: ${formData.item} — R$ ${valor.toFixed(2)}`, valor)
    }
    setModalAberto(null)
    setItemSelecionado(null)
    setFormData({ item: '', responsavel: 'Matheus', valor_previsto: '' })
    carregarItens()
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

  const totalPrevisto = useMemo(() => itens.reduce((acc, i) => acc + i.valor_previsto, 0), [itens])
  const totalRecebido = useMemo(
    () => itens.reduce((acc, i) => acc + totalRecebidoItem(i), 0),
    [itens, recebimentos]
  )
  const percentual = totalPrevisto > 0 ? Math.min((totalRecebido / totalPrevisto) * 100, 100) : 0

  return (
    <div className="space-y-3">

      {/* Resumo */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-5 h-5 text-green-600" />
          <span className="font-semibold text-gray-800">Resumo de Receitas</span>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-500 mb-0.5">Previsto</p>
            <p className="text-lg font-bold text-gray-800">R$ {totalPrevisto.toFixed(2)}</p>
          </div>
          <div className="bg-green-50 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-500 mb-0.5">Recebido</p>
            <p className="text-lg font-bold text-green-700">R$ {totalRecebido.toFixed(2)}</p>
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Progresso do mês</span>
            <span className="font-semibold text-green-700">{percentual.toFixed(0)}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 rounded-full bg-green-500 transition-all duration-700"
              style={{ width: `${percentual}%` }}
            />
          </div>
        </div>
      </div>

      {/* Lista */}
      <div className="bg-white rounded-2xl shadow overflow-hidden divide-y divide-gray-100">
        {itens.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-gray-300">
            <TrendingUp className="w-10 h-10" />
            <p className="text-sm">Nenhuma receita cadastrada</p>
          </div>
        ) : (
          itens.map((item) => {
            const recebido = totalRecebidoItem(item)
            const progresso = item.valor_previsto > 0 ? Math.min((recebido / item.valor_previsto) * 100, 100) : 0
            const concluido = recebido > 0 && recebido >= item.valor_previsto
            const parcial = recebido > 0 && !concluido
            const hasRecs = (recebimentos[item.id] || []).length > 0

            return (
              <div key={item.id} className={`px-4 py-3 transition-colors ${concluido ? 'bg-green-50/60' : 'bg-white'}`}>
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
                      R$ {item.valor_previsto.toFixed(2)}
                    </p>
                    {recebido > 0 && (
                      <p className={`text-xs font-medium ${concluido ? 'text-green-600' : 'text-yellow-600'}`}>
                        ✓ R$ {recebido.toFixed(2)}
                      </p>
                    )}
                  </div>

                  {/* Ações */}
                  <div className="flex items-center gap-0.5 shrink-0">
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
                    {hasRecs && (
                      <button
                        onClick={() => { setModalHistorico(item); setRecebimentoPendingDelete(null) }}
                        className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition"
                        title="Histórico"
                      >
                        <History className="w-4 h-4" />
                      </button>
                    )}
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

                {/* Barra de progresso por item */}
                <div className="mt-2 ml-4">
                  <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full transition-all duration-500 ${
                        concluido ? 'bg-green-500' : parcial ? 'bg-yellow-400' : 'bg-gray-200'
                      }`}
                      style={{ width: `${progresso}%` }}
                    />
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Botão adicionar */}
      <button
        onClick={() => setModalAberto('adicionar')}
        className="w-full bg-green-600 text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-green-700 transition"
      >
        <Plus className="w-5 h-5" />
        Adicionar receita
      </button>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl shadow-lg text-sm font-semibold text-white z-[60] ${
          toast.tipo === 'ok' ? 'bg-green-600' : 'bg-red-500'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* ── Modal: registrar recebimento parcial ── */}
      {modalRecebimento && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
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
                  <span>Recebido: <strong>R$ {recebido.toFixed(2)}</strong></span>
                  <span>Restante: <strong className="text-green-700">R$ {restante.toFixed(2)}</strong></span>
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
      )}

      {/* ── Modal: histórico de recebimentos ── */}
      {modalHistorico && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-lg font-bold">Histórico</h3>
              <button onClick={() => setModalHistorico(null)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">{paraNomeExibicao(modalHistorico.item)}</p>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {(recebimentos[modalHistorico.id] || []).map((r) => (
                <div key={r.id} className={`rounded-xl overflow-hidden transition-all ${
                  recebimentoPendingDelete === r.id ? 'ring-2 ring-red-300' : ''
                }`}>
                  <div className="flex items-center gap-3 bg-gray-50 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">R$ {r.valor.toFixed(2)}</p>
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
            </div>
            <div className="border-t mt-3 pt-3 flex justify-between text-sm font-medium text-gray-600">
              <span>Total recebido</span>
              <span className="text-green-700 font-bold">
                R$ {(recebimentos[modalHistorico.id] || []).reduce((a, r) => a + r.valor, 0).toFixed(2)}
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
      )}

      {/* ── Modal: adicionar / editar ── */}
      {(modalAberto === 'adicionar' || modalAberto === 'editar') && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
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
      )}

      {/* ── Modal: excluir ── */}
      {modalAberto === 'excluir' && itemSelecionado && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold mb-2">Excluir receita</h3>
            <p className="text-sm text-gray-500 mb-6">
              Tem certeza que deseja excluir <span className="font-semibold text-gray-800">"{paraNomeExibicao(itemSelecionado.item)}"</span>?
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
      )}
    </div>
  )
}
