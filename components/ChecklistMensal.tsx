'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CheckCircle2, AlertCircle, Pencil, Trash2, Plus, CreditCard, Download, ListFilter, X, RotateCcw } from 'lucide-react'
import { log, numericOnly } from '@/lib/logger'

const PREFIXO_CARTAO_1 = '[CARTAO1] '
const PREFIXO_CARTAO_2 = '[CARTAO2] '

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

function tipoCartaoPorItem(item: string): '' | 'cartao1' | 'cartao2' {
  if (item.startsWith(PREFIXO_CARTAO_1)) return 'cartao1'
  if (item.startsWith(PREFIXO_CARTAO_2)) return 'cartao2'
  return ''
}

function removerPrefixoCartao(item: string) {
  return item.replace(PREFIXO_CARTAO_1, '').replace(PREFIXO_CARTAO_2, '')
}

function aplicarPrefixoCartao(item: string, tipo: '' | 'cartao1' | 'cartao2') {
  if (tipo === 'cartao1') return `${PREFIXO_CARTAO_1}${item}`
  if (tipo === 'cartao2') return `${PREFIXO_CARTAO_2}${item}`
  return item
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
    tipo_cartao: '' as '' | 'cartao1' | 'cartao2',
    valor_previsto: '',
  })
  const [importandoMesAnterior, setImportandoMesAnterior] = useState(false)
  const [previewImport, setPreviewImport] = useState<{ itens: any[]; mesOrigem: string } | null>(null)
  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null)

  useEffect(() => { carregarItens() }, [mesSelecionado, apenasPendentes])

  function showToast(msg: string, tipo: 'ok' | 'erro' = 'ok') {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  async function carregarItens() {
    const primeiroDia = startOfMonth(mesSelecionado)
    let query = supabase
      .from('planejamento')
      .select('*')
      .eq('mes_referencia', format(primeiroDia, 'yyyy-MM-dd'))
      .in('categoria', ['Fixa', 'Extra'])
      .not('item', 'ilike', '[RECEITA]%')
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
    const diff = item ? Math.abs(valorNumerico - item.valor_previsto) : 0

    const { error } = await supabase
      .from('planejamento')
      .update({ pago: true, valor_real: valorNumerico })
      .eq('id', id)

    if (!error) {
      setModalAberto(null)
      setValorReal('')
      carregarItens()
      log('pagar', 'planejamento', `Pago: ${item ? removerPrefixoCartao(item.item) : id} — R$ ${valorNumerico.toFixed(2)}`, valorNumerico)
      if (diff > 0.01) {
        showToast(`Diferença de R$ ${diff.toFixed(2)} em relação ao previsto`, 'erro')
      } else {
        showToast('Pagamento registrado!')
      }
    } else {
      showToast('Erro ao registrar pagamento', 'erro')
    }
  }

  async function desfazerPagamento(id: string) {
    const item = itens.find(i => i.id === id)
    const { error } = await supabase
      .from('planejamento')
      .update({ pago: false, valor_real: null })
      .eq('id', id)

    if (!error) {
      setModalAberto(null)
      carregarItens()
      log('editar', 'planejamento', `Pagamento desfeito: ${item ? removerPrefixoCartao(item.item) : id}`)
      showToast('Pagamento removido')
    } else {
      showToast('Erro ao desfazer pagamento', 'erro')
    }
  }

  async function excluirItem(id: string) {
    const item = itens.find(i => i.id === id)
    const { error } = await supabase.from('planejamento').delete().eq('id', id)
    if (!error) {
      setModalAberto(null)
      carregarItens()
      log('excluir', 'planejamento', `Excluído: ${item ? removerPrefixoCartao(item.item) : id}`)
      showToast('Item excluído')
    } else {
      showToast('Erro ao excluir', 'erro')
    }
  }

  async function editarItem() {
    if (!itemSelecionado) return
    const valor = parseFloat(formData.valor_previsto.replace(',', '.'))
    const updates = {
      item: aplicarPrefixoCartao(formData.item, formData.tipo_cartao),
      responsavel: formData.responsavel,
      categoria: formData.categoria,
      valor_previsto: valor,
    }
    const { error } = await supabase.from('planejamento').update(updates).eq('id', itemSelecionado.id)
    if (!error) {
      setModalAberto(null)
      setItemSelecionado(null)
      carregarItens()
      log('editar', 'planejamento', `Editado: ${formData.item} — R$ ${valor.toFixed(2)}`, valor)
    } else {
      showToast('Erro ao editar', 'erro')
    }
  }

  async function adicionarItem() {
    const valor = parseFloat(formData.valor_previsto.replace(',', '.'))
    const primeiroDia = startOfMonth(mesSelecionado)
    const novoItem = {
      mes_referencia: format(primeiroDia, 'yyyy-MM-dd'),
      item: aplicarPrefixoCartao(formData.item, formData.tipo_cartao),
      responsavel: formData.responsavel,
      categoria: formData.categoria,
      valor_previsto: valor,
      pago: false,
      valor_real: null,
    }
    const { error } = await supabase.from('planejamento').insert([novoItem])
    if (!error) {
      setModalAberto(null)
      setFormData({ item: '', responsavel: 'Matheus', categoria: 'Fixa', tipo_cartao: '', valor_previsto: '' })
      carregarItens()
      log('inserir', 'planejamento', `Novo item: ${formData.item} — R$ ${valor.toFixed(2)}`, valor)
    } else {
      showToast('Erro ao adicionar', 'erro')
    }
  }

  async function abrirModalImportar() {
    const mesAnterior = startOfMonth(subMonths(mesSelecionado, 1))
    const mesAnteriorStr = format(mesAnterior, 'yyyy-MM-dd')

    const { data: itensAnteriores } = await supabase
      .from('planejamento')
      .select('*')
      .eq('mes_referencia', mesAnteriorStr)
      .in('categoria', ['Fixa', 'Extra'])
      .not('item', 'ilike', '[RECEITA]%')

    const candidatos = (itensAnteriores || []).filter(i => {
      // Remove parcelas que encerraram no mês anterior
      if (i.parcela_atual && i.total_parcelas) {
        return i.parcela_atual < i.total_parcelas
      }
      return true
    })

    setPreviewImport({
      itens: candidatos,
      mesOrigem: format(mesAnterior, 'MMMM yyyy', { locale: ptBR }),
    })
    setModalAberto('importar')
  }

  async function confirmarImportarMesAnterior() {
    if (!previewImport) return
    setImportandoMesAnterior(true)
    try {
      const mesAtualStr = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')

      // 1. Busca os IDs dos itens que serão substituídos (antes de apagar)
      const { data: existentes } = await supabase
        .from('planejamento')
        .select('id')
        .eq('mes_referencia', mesAtualStr)
        .in('categoria', ['Fixa', 'Extra'])
        .not('item', 'ilike', '[RECEITA]%')
      const idsExistentes = (existentes || []).map(i => i.id)

      // 2. Insere os itens do mês anterior primeiro — se falhar, os dados existentes são preservados
      const novosItens = previewImport.itens.map(({ id, mes_referencia, pago, valor_real, parcela_atual, total_parcelas, ...resto }) => ({
        ...resto,
        mes_referencia: mesAtualStr,
        pago: false,
        valor_real: null,
        parcela_atual: parcela_atual ? parcela_atual + 1 : null,
        total_parcelas: total_parcelas ?? null,
      }))

      if (novosItens.length > 0) {
        const { error: insertError } = await supabase.from('planejamento').insert(novosItens)
        if (insertError) throw insertError
      }

      // 3. Só apaga os itens antigos pelos IDs coletados após o insert ser bem-sucedido
      if (idsExistentes.length > 0) {
        await supabase.from('planejamento').delete().in('id', idsExistentes)
      }

      log('importar', 'planejamento', `Importados ${novosItens.length} item(ns) de ${previewImport.mesOrigem}`)
      setModalAberto(null)
      setPreviewImport(null)
      carregarItens()
      showToast('Importação concluída!')
    } catch (e) {
      console.error('Erro ao importar mês anterior:', e)
      showToast('Erro ao importar. Os dados existentes foram preservados.', 'erro')
    } finally {
      setImportandoMesAnterior(false)
    }
  }

  function abrirModalEditar(item: ItemPlanejamento) {
    setItemSelecionado(item)
    setFormData({
      item: removerPrefixoCartao(item.item),
      responsavel: item.responsavel,
      categoria: item.categoria,
      tipo_cartao: tipoCartaoPorItem(item.item),
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

  const percentualPago = totalPrevisto > 0 ? Math.min((totalPago / totalPrevisto) * 100, 100) : 0
  const itensPagos = itens.filter(i => i.pago).length

  return (
    <div className="space-y-3">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium transition-all ${
          toast.tipo === 'ok' ? 'bg-gray-900 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.tipo === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {toast.msg}
        </div>
      )}

      {/* Resumo */}
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-500 mb-0.5">Previsto</p>
            <p className="text-lg font-bold text-gray-800">R$ {totalPrevisto.toFixed(2)}</p>
          </div>
          <div className="bg-blue-50 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-500 mb-0.5">Pago</p>
            <p className="text-lg font-bold text-blue-700">R$ {totalPago.toFixed(2)}</p>
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{itensPagos}/{itens.length} itens pagos</span>
            <span className="font-semibold text-blue-700">{percentualPago.toFixed(0)}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 rounded-full bg-blue-500 transition-all duration-700"
              style={{ width: `${percentualPago}%` }}
            />
          </div>
        </div>
      </div>

      {/* Ações */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            setFormData({ item: '', responsavel: 'Matheus', categoria: 'Fixa', tipo_cartao: '', valor_previsto: '' })
            setModalAberto('adicionar')
          }}
          className="flex-1 bg-green-600 text-white py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-green-700 transition"
        >
          <Plus className="w-4 h-4" /> Adicionar
        </button>
        <button
          onClick={abrirModalImportar}
          className="flex-1 bg-orange-500 text-white py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-orange-600 transition"
        >
          <Download className="w-4 h-4" /> Mês anterior
        </button>
        <button
          onClick={() => setApenasPendentes(!apenasPendentes)}
          className={`px-3 py-2.5 rounded-xl transition flex items-center gap-1.5 font-semibold text-sm ${
            apenasPendentes ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
          title={apenasPendentes ? 'Mostrar todos' : 'Só pendentes'}
        >
          <ListFilter className="w-4 h-4" />
          {apenasPendentes ? <X className="w-3 h-3" /> : null}
        </button>
      </div>

      {/* Lista */}
      <div className="bg-white rounded-2xl shadow overflow-hidden divide-y divide-gray-100">
        {itens.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-gray-300">
            <CheckCircle2 className="w-10 h-10" />
            <p className="text-sm">Nenhum item encontrado</p>
          </div>
        ) : (
          itens.map((item) => {
            const tipoCartao = tipoCartaoPorItem(item.item)
            const diff = item.pago && item.valor_real !== null ? Math.abs(item.valor_real - item.valor_previsto) : 0
            return (
              <div key={item.id} className={`px-4 py-3 transition-colors ${item.pago ? 'bg-gray-50/70' : 'bg-white'}`}>
                <div className="flex items-center gap-3">
                  {/* Status dot */}
                  <div className={`w-2 h-2 rounded-full shrink-0 ${item.pago ? 'bg-green-500' : 'bg-gray-300'}`} />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${item.pago ? 'text-gray-500 line-through' : 'text-gray-800'}`}>
                      {removerPrefixoCartao(item.item)}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        item.categoria === 'Extra' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                      }`}>{item.categoria}</span>
                      <span className="text-[10px] text-gray-400">{item.responsavel}</span>
                      {tipoCartao && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">
                          <CreditCard className="w-2.5 h-2.5" /> {tipoCartao === 'cartao1' ? 'Cartão 1' : 'Cartão 2'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Valores */}
                  <div className="text-right shrink-0 mr-1">
                    <p className="text-sm font-semibold text-gray-800">R$ {item.valor_previsto.toFixed(2)}</p>
                    {item.pago && (
                      <p className={`text-xs font-medium ${diff > 0.01 ? 'text-red-500' : 'text-green-600'}`}>
                        ✓ R$ {(item.valor_real ?? item.valor_previsto).toFixed(2)}
                      </p>
                    )}
                  </div>

                  {/* Ações */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    {!item.pago ? (
                      <button
                        onClick={() => { setItemSelecionado(item); setModalAberto('pagar') }}
                        className="p-1.5 rounded-lg text-green-600 hover:bg-green-100 transition"
                      >
                        <CheckCircle2 className="w-5 h-5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => { setItemSelecionado(item); setModalAberto('desfazer') }}
                        className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-50 transition"
                        title="Desfazer pagamento"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => abrirModalEditar(item)}
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

                {/* Alerta de diferença */}
                {diff > 0.01 && (
                  <div className="mt-1.5 ml-5 flex items-center gap-1 text-xs text-red-500">
                    <AlertCircle className="w-3 h-3" />
                    Diferença de R$ {diff.toFixed(2)} em relação ao previsto
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {modalAberto === 'pagar' && itemSelecionado && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold mb-1">Registrar Pagamento</h3>
            <p className="text-sm text-gray-500 mb-4">{removerPrefixoCartao(itemSelecionado.item)}</p>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Valor pago (R$)</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder={`Previsto: R$ ${itemSelecionado.valor_previsto.toFixed(2)}`}
              value={valorReal}
              onChange={(e) => setValorReal(numericOnly(e.target.value))}
              className="w-full border border-gray-200 rounded-xl p-3 text-lg font-semibold mb-5 focus:outline-none focus:ring-2 focus:ring-green-400"
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={() => setModalAberto(null)} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600">Cancelar</button>
              <button onClick={() => marcarComoPago(itemSelecionado.id)} className="flex-1 py-3 rounded-xl bg-green-600 text-white font-semibold">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {(modalAberto === 'adicionar' || modalAberto === 'editar') && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold mb-5">{modalAberto === 'adicionar' ? 'Novo Item' : 'Editar Item'}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Descrição</label>
                <input type="text" value={formData.item} onChange={(e) => setFormData({ ...formData, item: e.target.value })} className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Responsável</label>
                <select value={formData.responsavel} onChange={(e) => setFormData({ ...formData, responsavel: e.target.value })} className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="Matheus">Matheus</option>
                  <option value="Jeniffer">Jeniffer</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Categoria</label>
                <select value={formData.categoria} onChange={(e) => setFormData({ ...formData, categoria: e.target.value })} className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="Fixa">Fixa</option>
                  <option value="Extra">Extra</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Cartão</label>
                <select value={formData.tipo_cartao} onChange={(e) => setFormData({ ...formData, tipo_cartao: e.target.value as '' | 'cartao1' | 'cartao2' })} className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">Nenhum</option>
                  <option value="cartao1">Cartão 1</option>
                  <option value="cartao2">Cartão 2</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Valor previsto (R$)</label>
                <input type="text" inputMode="decimal" value={formData.valor_previsto} onChange={(e) => setFormData({ ...formData, valor_previsto: numericOnly(e.target.value) })} className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-400" placeholder="0,00" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setModalAberto(null)} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600">Cancelar</button>
              <button onClick={modalAberto === 'adicionar' ? adicionarItem : editarItem} className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold">Salvar</button>
            </div>
          </div>
        </div>
      )}

      {modalAberto === 'importar' && previewImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-6 max-h-[80vh] flex flex-col">
            <h3 className="text-lg font-bold mb-1">Importar do mês anterior</h3>
            <p className="text-sm text-gray-500 mb-3">
              Origem: <span className="font-semibold capitalize">{previewImport.mesOrigem}</span>
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 text-xs text-amber-800 space-y-1">
              <p className="font-semibold">⚠️ Atenção — esta ação irá:</p>
              <p>• Apagar todos os itens Fixa/Extra do mês atual</p>
              <p>• Copiar {previewImport.itens.length} item(ns) do mês anterior</p>
              <p>• Parcelas serão avançadas em +1 automaticamente</p>
              <p>• Parcelas encerradas não serão copiadas</p>
            </div>

            <div className="overflow-y-auto flex-1 mb-4 space-y-1">
              {previewImport.itens.map((i, idx) => {
                const parcelaLabel = i.parcela_atual && i.total_parcelas
                  ? ` (${i.parcela_atual + 1}/${i.total_parcelas})`
                  : ''
                return (
                  <div key={idx} className="text-xs flex justify-between bg-gray-50 px-2 py-1.5 rounded">
                    <span className="truncate max-w-[180px] text-gray-700">
                      {removerPrefixoCartao(i.item)}{parcelaLabel}
                    </span>
                    <span className="text-gray-500 shrink-0 ml-2">R$ {i.valor_previsto.toFixed(2)}</span>
                  </div>
                )
              })}
              {previewImport.itens.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Nenhum item encontrado no mês anterior.</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setModalAberto(null); setPreviewImport(null) }}
                className="flex-1 py-2 rounded-lg bg-gray-200 font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarImportarMesAnterior}
                disabled={importandoMesAnterior || previewImport.itens.length === 0}
                className="flex-1 py-2 rounded-lg bg-orange-500 text-white font-medium disabled:opacity-50"
              >
                {importandoMesAnterior ? 'Importando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalAberto === 'excluir' && itemSelecionado && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold mb-2">Excluir item</h3>
            <p className="text-sm text-gray-500 mb-6">
              Tem certeza que deseja excluir <span className="font-semibold text-gray-800">"{removerPrefixoCartao(itemSelecionado.item)}"</span>?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setModalAberto(null)} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600">Cancelar</button>
              <button onClick={() => excluirItem(itemSelecionado.id)} className="flex-1 py-3 rounded-xl bg-red-500 text-white font-semibold">Excluir</button>
            </div>
          </div>
        </div>
      )}

      {modalAberto === 'desfazer' && itemSelecionado && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold mb-2">Desfazer pagamento</h3>
            <p className="text-sm text-gray-500 mb-1">
              <span className="font-semibold text-gray-800">{removerPrefixoCartao(itemSelecionado.item)}</span>
            </p>
            {itemSelecionado.valor_real !== null && (
              <p className="text-sm text-gray-400 mb-5">
                Valor registrado: R$ {itemSelecionado.valor_real.toFixed(2)}
              </p>
            )}
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-5">
              O item voltará para o status de pendente e o valor registrado será apagado.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setModalAberto(null)} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600">Cancelar</button>
              <button onClick={() => desfazerPagamento(itemSelecionado.id)} className="flex-1 py-3 rounded-xl bg-amber-500 text-white font-semibold">Desfazer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
