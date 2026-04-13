'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth } from 'date-fns'
import { CheckCircle, AlertCircle, Pencil, Trash2, Plus } from 'lucide-react'

interface ItemPlanejamento {
  id: string
  item: string
  responsavel: string
  valor_previsto: number
  valor_real: number | null
  pago: boolean
  categoria: string
  mes_referencia: string
}

interface Props {
  mesSelecionado: Date
}

export default function ChecklistMensal({ mesSelecionado }: Props) {
  const [itens, setItens] = useState<ItemPlanejamento[]>([])
  const [apenasPendentes, setApenasPendentes] = useState(false)
  const [modalAberto, setModalAberto] = useState<string | null>(null)
  const [itemSelecionado, setItemSelecionado] = useState<ItemPlanejamento | null>(null)
  const [valorReal, setValorReal] = useState('')
  const [formData, setFormData] = useState({
    item: '',
    responsavel: 'Matheus',
    categoria: 'Fixa',
    valor_previsto: '',
  })

  useEffect(() => {
    carregarItens()
  }, [mesSelecionado, apenasPendentes])

  async function carregarItens() {
    const primeiroDia = startOfMonth(mesSelecionado)
    let query = supabase
      .from('planejamento')
      .select('*')
      .eq('mes_referencia', format(primeiroDia, 'yyyy-MM-dd'))
      .order('categoria', { ascending: false })

    if (apenasPendentes) {
      query = query.eq('pago', false)
    }

    const { data } = await query
    setItens(data || [])
  }

  async function marcarComoPago(id: string) {
    if (!valorReal) return
    const valorNumerico = parseFloat(valorReal.replace(',', '.'))
    const item = itens.find(i => i.id === id)
    const temDiferenca = item && Math.abs(valorNumerico - item.valor_previsto) > 0.01

    const { error } = await supabase
      .from('planejamento')
      .update({ pago: true, valor_real: valorNumerico })
      .eq('id', id)

    if (!error) {
      setModalAberto(null)
      setValorReal('')
      carregarItens()
      if (temDiferenca) {
        alert(`⚠️ Diferença de R$ ${Math.abs(valorNumerico - item!.valor_previsto).toFixed(2)} detectada!`)
      }
    }
  }

  async function excluirItem(id: string) {
    const { error } = await supabase.from('planejamento').delete().eq('id', id)
    if (!error) {
      setModalAberto(null)
      carregarItens()
    } else {
      alert('Erro ao excluir')
    }
  }

  async function editarItem() {
    if (!itemSelecionado) return
    const updates = {
      item: formData.item,
      responsavel: formData.responsavel,
      categoria: formData.categoria,
      valor_previsto: parseFloat(formData.valor_previsto.replace(',', '.')),
    }
    const { error } = await supabase.from('planejamento').update(updates).eq('id', itemSelecionado.id)
    if (!error) {
      setModalAberto(null)
      setItemSelecionado(null)
      carregarItens()
    } else {
      alert('Erro ao editar')
    }
  }

  async function adicionarItem() {
    const primeiroDia = startOfMonth(mesSelecionado)
    const novoItem = {
      mes_referencia: format(primeiroDia, 'yyyy-MM-dd'),
      item: formData.item,
      responsavel: formData.responsavel,
      categoria: formData.categoria,
      valor_previsto: parseFloat(formData.valor_previsto.replace(',', '.')),
      pago: false,
      valor_real: null,
    }
    const { error } = await supabase.from('planejamento').insert([novoItem])
    if (!error) {
      setModalAberto(null)
      setFormData({ item: '', responsavel: 'Matheus', categoria: 'Fixa', valor_previsto: '' })
      carregarItens()
    } else {
      alert('Erro ao adicionar')
    }
  }

  function abrirModalEditar(item: ItemPlanejamento) {
    setItemSelecionado(item)
    setFormData({
      item: item.item,
      responsavel: item.responsavel,
      categoria: item.categoria,
      valor_previsto: item.valor_previsto.toString(),
    })
    setModalAberto('editar')
  }

  const totalPrevisto = useMemo(
    () => itens.reduce((acc, item) => acc + item.valor_previsto, 0),
    [itens]
  )

  const totalPago = useMemo(
    () => itens.reduce((acc, item) => acc + (item.pago ? (item.valor_real ?? item.valor_previsto) : 0), 0),
    [itens]
  )

  return (
    <div className="space-y-3">
      <button
        onClick={() => {
          setFormData({ item: '', responsavel: 'Matheus', categoria: 'Fixa', valor_previsto: '' })
          setModalAberto('adicionar')
        }}
        className="w-full bg-green-600 text-white py-2 rounded-lg font-medium flex items-center justify-center gap-2"
      >
        <Plus className="w-5 h-5" /> Adicionar item
      </button>

      <button
        onClick={() => setApenasPendentes(!apenasPendentes)}
        className={`w-full py-2 rounded-lg font-medium transition ${
          apenasPendentes ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
        }`}
      >
        {apenasPendentes ? '✓ Mostrando apenas pendentes' : '🔘 Ver apenas pendentes'}
      </button>

      <div className="bg-white rounded-xl shadow p-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-gray-500">Total previsto</p>
          <p className="text-lg font-bold text-gray-800">R$ {totalPrevisto.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Total pago</p>
          <p className="text-lg font-bold text-green-700">R$ {totalPago.toFixed(2)}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow divide-y">
        {itens.map((item) => (
          <div key={item.id} className={`p-3 ${item.pago ? 'bg-gray-50' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 truncate">{item.item}</p>
                <p className="text-xs text-gray-500">{item.categoria} · {item.responsavel}</p>
              </div>

              <div className="text-right shrink-0">
                <p className="text-xs text-gray-500">Prev: R$ {item.valor_previsto.toFixed(2)}</p>
                <p className={`text-xs font-semibold ${item.pago ? 'text-green-700' : 'text-gray-400'}`}>
                  Pago: R$ {(item.valor_real ?? 0).toFixed(2)}
                </p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {!item.pago && (
                  <button onClick={() => { setItemSelecionado(item); setModalAberto('pagar') }} className="text-green-600">
                    <CheckCircle className="w-5 h-5" />
                  </button>
                )}
                <button onClick={() => abrirModalEditar(item)} className="text-blue-600">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => { setItemSelecionado(item); setModalAberto('excluir') }} className="text-red-600">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            {item.pago && item.valor_real !== null && Math.abs(item.valor_real - item.valor_previsto) > 0.01 && (
              <div className="mt-1 flex items-center gap-1 text-xs text-red-500">
                <AlertCircle className="w-3.5 h-3.5" />
                Diferença: R$ {Math.abs(item.valor_real - item.valor_previsto).toFixed(2)}
              </div>
            )}
          </div>
        ))}
      </div>

      {modalAberto === 'pagar' && itemSelecionado && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold mb-4">Registrar Pagamento</h3>
            <input type="text" placeholder="Valor real pago (R$)" value={valorReal} onChange={(e) => setValorReal(e.target.value)} className="w-full border rounded-lg p-3 mb-4" autoFocus />
            <div className="flex gap-3">
              <button onClick={() => setModalAberto(null)} className="flex-1 py-2 rounded-lg bg-gray-200">Cancelar</button>
              <button onClick={() => marcarComoPago(itemSelecionado.id)} className="flex-1 py-2 rounded-lg bg-green-600 text-white">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {(modalAberto === 'adicionar' || modalAberto === 'editar') && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold mb-4">{modalAberto === 'adicionar' ? 'Novo Item' : 'Editar Item'}</h3>
            <div className="space-y-3">
              <input type="text" placeholder="Descrição" value={formData.item} onChange={(e) => setFormData({ ...formData, item: e.target.value })} className="w-full border rounded-lg p-3" />
              <select value={formData.responsavel} onChange={(e) => setFormData({ ...formData, responsavel: e.target.value })} className="w-full border rounded-lg p-3">
                <option value="Matheus">Matheus</option>
                <option value="Jeniffer">Jeniffer</option>
              </select>
              <select value={formData.categoria} onChange={(e) => setFormData({ ...formData, categoria: e.target.value })} className="w-full border rounded-lg p-3">
                <option value="Fixa">Fixa</option>
                <option value="Extra">Extra</option>
              </select>
              <input type="text" placeholder="Valor previsto (R$)" value={formData.valor_previsto} onChange={(e) => setFormData({ ...formData, valor_previsto: e.target.value })} className="w-full border rounded-lg p-3" />
              <div className="flex gap-3">
                <button onClick={() => setModalAberto(null)} className="flex-1 py-2 rounded-lg bg-gray-200">Cancelar</button>
                <button onClick={modalAberto === 'adicionar' ? adicionarItem : editarItem} className="flex-1 py-2 rounded-lg bg-blue-600 text-white">Salvar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalAberto === 'excluir' && itemSelecionado && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold mb-4">Confirmar exclusão</h3>
            <p className="mb-4">Tem certeza que deseja excluir "{itemSelecionado.item}"?</p>
            <div className="flex gap-3">
              <button onClick={() => setModalAberto(null)} className="flex-1 py-2 rounded-lg bg-gray-200">Cancelar</button>
              <button onClick={() => excluirItem(itemSelecionado.id)} className="flex-1 py-2 rounded-lg bg-red-600 text-white">Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
