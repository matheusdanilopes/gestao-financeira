'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { PiggyBank, Pencil, Trash2, Plus, Download } from 'lucide-react'

interface Investimento {
  id: string
  descricao: string
  percentual: number
  mes_referencia: string
  created_at: string
}

interface Props {
  mesSelecionado: Date
  saldo: number
}

export default function InvestimentosMensal({ mesSelecionado, saldo }: Props) {
  const [itens, setItens] = useState<Investimento[]>([])
  const [modalAberto, setModalAberto] = useState<string | null>(null)
  const [itemSelecionado, setItemSelecionado] = useState<Investimento | null>(null)
  const [formData, setFormData] = useState({ descricao: '', percentual: '', valor: '' })
  const [ultimoCampo, setUltimoCampo] = useState<'percentual' | 'valor'>('percentual')
  const [previewImport, setPreviewImport] = useState<{ itens: Investimento[]; mesOrigem: string } | null>(null)
  const [importando, setImportando] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null)

  useEffect(() => { carregarItens() }, [mesSelecionado])

  // Recalculate the secondary field whenever saldo changes
  useEffect(() => {
    if (modalAberto !== 'adicionar' && modalAberto !== 'editar') return
    if (ultimoCampo === 'percentual') {
      const pct = parseFloat(formData.percentual.replace(',', '.'))
      if (!isNaN(pct) && saldo > 0) {
        setFormData(f => ({ ...f, valor: (saldo * pct / 100).toFixed(2) }))
      }
    } else {
      const val = parseFloat(formData.valor.replace(',', '.'))
      if (!isNaN(val) && saldo > 0) {
        setFormData(f => ({ ...f, percentual: (val / saldo * 100).toFixed(2) }))
      }
    }
  }, [saldo])

  function showToast(msg: string, tipo: 'ok' | 'erro' = 'ok') {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  async function carregarItens() {
    const mesRef = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('investimentos')
      .select('*')
      .eq('mes_referencia', mesRef)
      .order('created_at', { ascending: true })
    setItens(data || [])
  }

  const totalPercentual = useMemo(() => itens.reduce((acc, i) => acc + i.percentual, 0), [itens])
  const totalValor = useMemo(() => saldo > 0 ? saldo * totalPercentual / 100 : 0, [saldo, totalPercentual])

  function percentualDisponivel(excludeId?: string) {
    const usado = itens
      .filter(i => i.id !== excludeId)
      .reduce((acc, i) => acc + i.percentual, 0)
    return 100 - usado
  }

  function handlePercentualChange(v: string) {
    setUltimoCampo('percentual')
    const pct = parseFloat(v.replace(',', '.'))
    const valorCalc = !isNaN(pct) && saldo > 0 ? (saldo * pct / 100).toFixed(2) : ''
    setFormData(f => ({ ...f, percentual: v, valor: valorCalc }))
  }

  function handleValorChange(v: string) {
    setUltimoCampo('valor')
    const val = parseFloat(v.replace(',', '.'))
    const pctCalc = !isNaN(val) && saldo > 0 ? (val / saldo * 100).toFixed(2) : ''
    setFormData(f => ({ ...f, valor: v, percentual: pctCalc }))
  }

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
        descricao: formData.descricao.trim(),
        percentual: pct,
        mes_referencia: mesRef,
      }])
      if (error) { showToast('Erro ao adicionar', 'erro'); return }
      showToast('Investimento adicionado!')
    } else if (itemSelecionado) {
      const { error } = await supabase.from('investimentos')
        .update({ descricao: formData.descricao.trim(), percentual: pct })
        .eq('id', itemSelecionado.id)
      if (error) { showToast('Erro ao salvar', 'erro'); return }
      showToast('Atualizado!')
    }

    fecharModal()
    carregarItens()
  }

  async function excluir(id: string) {
    const { error } = await supabase.from('investimentos').delete().eq('id', id)
    if (!error) { fecharModal(); carregarItens(); showToast('Excluído') }
    else showToast('Erro ao excluir', 'erro')
  }

  function abrirEditar(item: Investimento) {
    setItemSelecionado(item)
    const valorCalc = saldo > 0 ? (saldo * item.percentual / 100).toFixed(2) : ''
    setFormData({ descricao: item.descricao, percentual: String(item.percentual), valor: valorCalc })
    setUltimoCampo('percentual')
    setModalAberto('editar')
  }

  function fecharModal() {
    setModalAberto(null)
    setItemSelecionado(null)
    setFormData({ descricao: '', percentual: '', valor: '' })
  }

  async function abrirModalImportar() {
    const mesAnterior = startOfMonth(subMonths(mesSelecionado, 1))
    const mesAnteriorStr = format(mesAnterior, 'yyyy-MM-dd')
    const { data } = await supabase
      .from('investimentos')
      .select('*')
      .eq('mes_referencia', mesAnteriorStr)
      .order('created_at', { ascending: true })
    setPreviewImport({
      itens: data || [],
      mesOrigem: format(mesAnterior, 'MMMM yyyy', { locale: ptBR }),
    })
    setModalAberto('importar')
  }

  async function confirmarImportar() {
    if (!previewImport) return
    setImportando(true)
    const mesAtualStr = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')
    await supabase.from('investimentos').delete().eq('mes_referencia', mesAtualStr)
    const novos = previewImport.itens.map(i => ({
      descricao: i.descricao,
      percentual: i.percentual,
      mes_referencia: mesAtualStr,
    }))
    if (novos.length > 0) await supabase.from('investimentos').insert(novos)
    setImportando(false)
    fecharModal()
    setPreviewImport(null)
    carregarItens()
    showToast(`${novos.length} investimento(s) importado(s)!`)
  }

  const pctBar = Math.min(totalPercentual, 100)

  return (
    <div className="space-y-3">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg transition-all ${
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
            <p className="text-xs text-gray-500 mb-0.5">Total investido</p>
            <p className="text-lg font-bold text-violet-700">R$ {totalValor.toFixed(2)}</p>
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Alocação do saldo</span>
            <span className={`font-semibold ${totalPercentual > 100 ? 'text-red-600' : 'text-violet-700'}`}>
              {totalPercentual.toFixed(1)}%
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className={`h-2 rounded-full transition-all duration-700 ${totalPercentual > 100 ? 'bg-red-500' : 'bg-violet-500'}`}
              style={{ width: `${pctBar}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-1 text-right">
            {Math.max(0, 100 - totalPercentual).toFixed(1)}% disponível para alocar
          </p>
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
            const valorItem = saldo > 0 ? saldo * item.percentual / 100 : 0
            return (
              <div key={item.id} className="px-4 py-3 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full shrink-0 bg-violet-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{item.descricao}</p>
                  <p className="text-xs text-gray-400">{item.percentual.toFixed(2)}% do saldo</p>
                </div>
                <div className="text-right shrink-0 mr-2">
                  <p className="text-sm font-semibold text-violet-700">R$ {valorItem.toFixed(2)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
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

      {/* Modal: adicionar / editar */}
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
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  placeholder="Ex: 20"
                  value={formData.percentual}
                  onChange={(e) => handlePercentualChange(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  Valor em R$
                  <span className="ml-1 text-gray-400 font-normal">— calculado sobre saldo de R$ {saldo.toFixed(2)}</span>
                </label>
                <input
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  placeholder="0,00"
                  value={formData.valor}
                  onChange={(e) => handleValorChange(e.target.value)}
                  inputMode="decimal"
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

      {/* Modal: excluir */}
      {modalAberto === 'excluir' && itemSelecionado && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold mb-2">Excluir investimento</h3>
            <p className="text-sm text-gray-500 mb-6">
              Tem certeza que deseja excluir{' '}
              <span className="font-semibold text-gray-800">"{itemSelecionado.descricao}"</span>?
            </p>
            <div className="flex gap-3">
              <button onClick={fecharModal} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600">
                Cancelar
              </button>
              <button
                onClick={() => excluir(itemSelecionado.id)}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-semibold"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: importar mês anterior */}
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
                {previewImport.itens.map((i) => {
                  const val = saldo > 0 ? saldo * i.percentual / 100 : 0
                  return (
                    <div key={i.id} className="flex justify-between text-sm bg-gray-50 rounded-xl px-3 py-2">
                      <span className="text-gray-700">{i.descricao}</span>
                      <span className="text-violet-700 font-medium">
                        {i.percentual.toFixed(2)}% · R$ {val.toFixed(2)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-4">
              Os investimentos do mês atual serão substituídos.
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
