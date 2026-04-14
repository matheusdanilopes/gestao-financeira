'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth } from 'date-fns'
import { CheckCircle2, Pencil, Trash2, Plus, TrendingUp } from 'lucide-react'
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

function paraNomeInterno(nome: string) {
  return `${RECEITA_PREFIXO}${nome}`
}

function paraNomeExibicao(nome: string) {
  return nome.startsWith(RECEITA_PREFIXO) ? nome.replace(RECEITA_PREFIXO, '') : nome
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
      .ilike('item', '[RECEITA]%')
      .order('item', { ascending: true })
    setItens(data || [])
  }

  async function salvarRecebimento(id: string) {
    const valor = parseFloat(valorRecebido.replace(',', '.'))
    if (!valor) return
    const item = itens.find(i => i.id === id)
    await supabase.from('planejamento').update({ pago: true, valor_real: valor }).eq('id', id)
    log('receber', 'receitas', `Recebido: ${item ? paraNomeExibicao(item.item) : id} — R$ ${valor.toFixed(2)}`, valor)
    setModalAberto(null)
    setValorRecebido('')
    carregarItens()
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
    () => itens.reduce((acc, i) => acc + (i.pago ? (i.valor_real ?? i.valor_previsto) : 0), 0),
    [itens]
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
            const recebidoValor = item.pago ? (item.valor_real ?? item.valor_previsto) : 0
            return (
              <div
                key={item.id}
                className={`px-4 py-3 flex items-center gap-3 transition-colors ${
                  item.pago ? 'bg-green-50/60' : 'bg-white'
                }`}
              >
                {/* Status dot */}
                <div className={`w-2 h-2 rounded-full shrink-0 ${item.pago ? 'bg-green-500' : 'bg-gray-300'}`} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {paraNomeExibicao(item.item)}
                  </p>
                  <p className="text-xs text-gray-400">{item.responsavel}</p>
                </div>

                {/* Valores */}
                <div className="text-right shrink-0 mr-2">
                  <p className="text-sm font-semibold text-gray-800">
                    R$ {item.valor_previsto.toFixed(2)}
                  </p>
                  {item.pago && (
                    <p className="text-xs text-green-600 font-medium">
                      ✓ R$ {recebidoValor.toFixed(2)}
                    </p>
                  )}
                </div>

                {/* Ações */}
                <div className="flex items-center gap-1 shrink-0">
                  {!item.pago && (
                    <button
                      onClick={() => { setItemSelecionado(item); setModalAberto('receber') }}
                      className="p-1.5 rounded-lg text-green-600 hover:bg-green-100 transition"
                    >
                      <CheckCircle2 className="w-5 h-5" />
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

      {/* Modal: registrar recebimento */}
      {modalAberto === 'receber' && itemSelecionado && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold mb-1">Registrar Recebimento</h3>
            <p className="text-sm text-gray-500 mb-4">{paraNomeExibicao(itemSelecionado.item)}</p>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Valor recebido (R$)</label>
            <input
              type="text"
              inputMode="decimal"
              className="w-full border border-gray-200 rounded-xl p-3 text-lg font-semibold mb-5 focus:outline-none focus:ring-2 focus:ring-green-400"
              value={valorRecebido}
              onChange={(e) => setValorRecebido(numericOnly(e.target.value))}
              placeholder={`Previsto: R$ ${itemSelecionado.valor_previsto.toFixed(2)}`}
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={() => setModalAberto(null)} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600">
                Cancelar
              </button>
              <button onClick={() => salvarRecebimento(itemSelecionado.id)} className="flex-1 py-3 rounded-xl bg-green-600 text-white font-semibold">
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: adicionar / editar */}
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

      {/* Modal: excluir */}
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
