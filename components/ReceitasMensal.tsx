'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth } from 'date-fns'
import { CheckCircle, Pencil, Trash2, Plus } from 'lucide-react'

interface ItemReceita {
  id: string
  item: string
  responsavel: string
  valor_previsto: number
  valor_real: number | null
  pago: boolean
  mes_referencia: string
}

export default function ReceitasMensal({ mesSelecionado }: { mesSelecionado: Date }) {
  const [itens, setItens] = useState<ItemReceita[]>([])
  const [modalAberto, setModalAberto] = useState<string | null>(null)
  const [itemSelecionado, setItemSelecionado] = useState<ItemReceita | null>(null)
  const [valorRecebido, setValorRecebido] = useState('')
  const [formData, setFormData] = useState({ item: '', responsavel: 'Matheus', valor_previsto: '' })

  useEffect(() => { carregarItens() }, [mesSelecionado])

  async function carregarItens() {
    const mesRef = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('planejamento')
      .select('*')
      .eq('mes_referencia', mesRef)
      .eq('categoria', 'Receita')
      .order('item', { ascending: true })

    setItens(data || [])
  }

  async function salvarRecebimento(id: string) {
    const valor = parseFloat(valorRecebido.replace(',', '.'))
    if (!valor) return
    await supabase.from('planejamento').update({ pago: true, valor_real: valor }).eq('id', id)
    setModalAberto(null)
    setValorRecebido('')
    carregarItens()
  }

  async function excluir(id: string) {
    await supabase.from('planejamento').delete().eq('id', id)
    setModalAberto(null)
    carregarItens()
  }

  async function salvar() {
    const payload = {
      item: formData.item,
      responsavel: formData.responsavel,
      valor_previsto: parseFloat(formData.valor_previsto.replace(',', '.')),
    }

    if (modalAberto === 'adicionar') {
      const mesRef = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')
      await supabase.from('planejamento').insert([{ ...payload, categoria: 'Receita', mes_referencia: mesRef, pago: false, valor_real: null }])
    } else if (itemSelecionado) {
      await supabase.from('planejamento').update(payload).eq('id', itemSelecionado.id)
    }

    setModalAberto(null)
    setItemSelecionado(null)
    setFormData({ item: '', responsavel: 'Matheus', valor_previsto: '' })
    carregarItens()
  }

  const totalPrevisto = useMemo(() => itens.reduce((acc, i) => acc + i.valor_previsto, 0), [itens])
  const totalRecebido = useMemo(() => itens.reduce((acc, i) => acc + (i.pago ? (i.valor_real ?? i.valor_previsto) : 0), 0), [itens])

  return (
    <div className="space-y-3">
      <button onClick={() => setModalAberto('adicionar')} className="w-full bg-green-600 text-white py-2 rounded-lg font-medium flex items-center justify-center gap-2">
        <Plus className="w-5 h-5" /> Adicionar receita
      </button>

      <div className="bg-white rounded-xl shadow p-3 grid grid-cols-2 gap-3">
        <div><p className="text-xs text-gray-500">Total previsto</p><p className="text-lg font-bold">R$ {totalPrevisto.toFixed(2)}</p></div>
        <div><p className="text-xs text-gray-500">Total recebido</p><p className="text-lg font-bold text-green-700">R$ {totalRecebido.toFixed(2)}</p></div>
      </div>

      <div className="bg-white rounded-xl shadow divide-y">
        {itens.map((item) => (
          <div key={item.id} className="p-3 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{item.item}</p>
              <p className="text-xs text-gray-500">{item.responsavel}</p>
            </div>
            <div className="text-right text-xs">
              <p>Prev: R$ {item.valor_previsto.toFixed(2)}</p>
              <p className={item.pago ? 'text-green-700 font-semibold' : 'text-gray-400'}>Rec: R$ {(item.valor_real ?? 0).toFixed(2)}</p>
            </div>
            <div className="flex gap-1">
              {!item.pago && <button onClick={() => { setItemSelecionado(item); setModalAberto('receber') }} className="text-green-600"><CheckCircle className="w-5 h-5" /></button>}
              <button onClick={() => { setItemSelecionado(item); setFormData({ item: item.item, responsavel: item.responsavel, valor_previsto: String(item.valor_previsto) }); setModalAberto('editar') }} className="text-blue-600"><Pencil className="w-4 h-4" /></button>
              <button onClick={() => { setItemSelecionado(item); setModalAberto('excluir') }} className="text-red-600"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        ))}
      </div>

      {modalAberto === 'receber' && itemSelecionado && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl max-w-sm w-full p-6"><h3 className="text-lg font-bold mb-4">Registrar Recebimento</h3><input className="w-full border rounded-lg p-3 mb-4" value={valorRecebido} onChange={(e) => setValorRecebido(e.target.value)} placeholder="Valor recebido" /><div className="flex gap-3"><button onClick={() => setModalAberto(null)} className="flex-1 py-2 rounded-lg bg-gray-200">Cancelar</button><button onClick={() => salvarRecebimento(itemSelecionado.id)} className="flex-1 py-2 rounded-lg bg-green-600 text-white">Confirmar</button></div></div></div>
      )}

      {(modalAberto === 'adicionar' || modalAberto === 'editar') && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl max-w-sm w-full p-6"><h3 className="text-lg font-bold mb-4">{modalAberto === 'adicionar' ? 'Nova Receita' : 'Editar Receita'}</h3><div className="space-y-3"><input className="w-full border rounded-lg p-3" placeholder="Descrição" value={formData.item} onChange={(e) => setFormData({ ...formData, item: e.target.value })} /><select className="w-full border rounded-lg p-3" value={formData.responsavel} onChange={(e) => setFormData({ ...formData, responsavel: e.target.value })}><option value="Matheus">Matheus</option><option value="Jeniffer">Jeniffer</option></select><input className="w-full border rounded-lg p-3" placeholder="Valor previsto" value={formData.valor_previsto} onChange={(e) => setFormData({ ...formData, valor_previsto: e.target.value })} /><div className="flex gap-3"><button onClick={() => setModalAberto(null)} className="flex-1 py-2 rounded-lg bg-gray-200">Cancelar</button><button onClick={salvar} className="flex-1 py-2 rounded-lg bg-blue-600 text-white">Salvar</button></div></div></div></div>
      )}

      {modalAberto === 'excluir' && itemSelecionado && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl max-w-sm w-full p-6"><h3 className="text-lg font-bold mb-4">Confirmar exclusão</h3><p className="mb-4">Excluir "{itemSelecionado.item}"?</p><div className="flex gap-3"><button onClick={() => setModalAberto(null)} className="flex-1 py-2 rounded-lg bg-gray-200">Cancelar</button><button onClick={() => excluir(itemSelecionado.id)} className="flex-1 py-2 rounded-lg bg-red-600 text-white">Excluir</button></div></div></div>
      )}
    </div>
  )
}
