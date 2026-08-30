'use client'

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, subMonths, addMonths, parseISO } from 'date-fns'
import { useGlobalSync } from '@/lib/useGlobalSync'
import { ptBR } from 'date-fns/locale'
import { CheckCircle2, AlertCircle, CreditCard, RotateCcw, WifiOff, Bell, Calendar, Receipt, ChevronDown } from 'lucide-react'
import PageActionButtons from '@/components/PageActionButtons'
import { SwipeableItem } from '@/components/SwipeableItem'
import { calcularStatusVencimento, verificarVencimentos, type StatusVencimento } from '@/lib/notificacoesVencimento'
import { log } from '@/lib/logger'
import { numericOnly, formatBRL } from '@/lib/format'
import {
  TIPOS_CARTAO,
  type TipoCartao,
  tipoCartaoPorItem,
  aplicarPrefixoCartao,
  removerPrefixoCartao,
} from '@/lib/tipoCartao'
import { CARTAO_TX_POR_TIPO } from '@/lib/faturaEfetiva'
import { cartaoLabelsDePlanejamento, type CartaoLabels } from '@/lib/cartaoLabels'
import { RESPONSAVEIS, estiloResponsavel } from '@/lib/responsavelStyle'
import {
  atualizarRegistrosFuturos,
  excluirRegistrosFuturos,
  criarRegistrosFuturos,
  MESES_FUTUROS_PADRAO,
  MESES_FUTUROS_MAXIMO,
} from '@/lib/registrosFuturos'

const CATEGORIAS_PLANEJAMENTO = [
  'Fixa', 'Extra', 'Cartão', 'Moradia', 'Alimentação',
  'Saúde', 'Transporte', 'Educação', 'Lazer', 'Pet', 'Seguros', 'Outros',
]

const CATEGORIA_CORES_PLAN: Record<string, string> = {
  Fixa:        'bg-gray-200 text-gray-600',
  Extra:       'bg-amber-100 text-amber-700',
  'Cartão':    'bg-purple-100 text-purple-700',
  Moradia:     'bg-blue-100 text-blue-700',
  'Alimentação': 'bg-orange-100 text-orange-700',
  'Saúde':     'bg-red-100 text-red-600',
  Transporte:  'bg-sky-100 text-sky-700',
  'Educação':  'bg-indigo-100 text-indigo-700',
  Lazer:       'bg-green-100 text-green-700',
  Pet:         'bg-lime-100 text-lime-700',
  Seguros:     'bg-teal-100 text-teal-700',
  Outros:      'bg-gray-100 text-gray-500',
}

interface ItemPlanejamento {
  id: string
  item: string
  responsavel: string
  valor_previsto: number
  valor_real: number | null
  pago: boolean
  categoria: string
  mes_referencia: string
  data_vencimento: string | null
  data_pagamento: string | null
  created_at: string | null
  parcela_atual?: number | null
  total_parcelas?: number | null
}

function StatusBadge({ status }: { status: StatusVencimento }) {
  if (status === 'Paga') return (
    <span className="inline-flex items-center text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
      Paga
    </span>
  )
  if (status === 'Atrasada') return (
    <span className="inline-flex items-center text-[10px] font-semibold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">
      Atrasada
    </span>
  )
  return null
}

interface Props {
  mesSelecionado: Date
  autoOpen?: boolean
}

/** "1.234,56" (como o usuário digita) → 1234.56. Devolve 0 para entrada vazia/inválida. */
function parseValor(texto: string | undefined | null): number {
  const limpo = String(texto ?? '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(limpo)
  return Number.isFinite(n) ? n : 0
}

function formatarValorInput(v: number): string {
  return v.toFixed(2).replace('.', ',')
}

/**
 * Distribui `total` entre as despesas proporcionalmente aos valores atuais delas,
 * garantindo que a soma bata exatamente com o total (sem centavo sobrando).
 *
 * A conta é feita em centavos e o resto é distribuído pelo método do maior resto —
 * arredondar cada parcela isoladamente deixaria a soma fora do total, e é
 * justamente isso que a tela precisa evitar: o que foi pago ao banco é o total.
 *
 * Quando não há base (todas as despesas zeradas), divide em partes iguais.
 */
function ratearTotal(total: number, bases: number[]): number[] {
  const n = bases.length
  if (n === 0) return []

  const totalCents = Math.round(Math.max(0, total) * 100)
  const basesCents = bases.map(b => Math.round(Math.max(0, b) * 100))
  const somaBases = basesCents.reduce((acc, b) => acc + b, 0)

  const pesos = somaBases > 0 ? basesCents : new Array(n).fill(1)
  const somaPesos = somaBases > 0 ? somaBases : n

  const exatos = pesos.map(p => (totalCents * p) / somaPesos)
  const cents = exatos.map(Math.floor)

  let resto = totalCents - cents.reduce((acc, c) => acc + c, 0)
  const porMaiorResto = exatos
    .map((valor, i) => ({ i, frac: valor - Math.floor(valor) }))
    .sort((a, b) => b.frac - a.frac)
  for (let k = 0; resto > 0; k++, resto--) {
    cents[porMaiorResto[k % n].i]++
  }

  return cents.map(c => c / 100)
}

function moverVencimentoParaMes(dataVencimento: string | null | undefined, novoMes: Date): string | null {
  if (!dataVencimento) return null
  try {
    const dia = parseISO(dataVencimento).getDate()
    const ano = novoMes.getFullYear()
    const mes = novoMes.getMonth()
    const diasNoMes = new Date(ano, mes + 1, 0).getDate()
    return format(new Date(ano, mes, Math.min(dia, diasNoMes)), 'yyyy-MM-dd')
  } catch {
    return null
  }
}

// Uma fatura de cartão é lançada como várias despesas — uma por cartão adicional —
// mas é paga de uma vez só no banco. Por isso a tela agrupa as despesas que
// compartilham o mesmo cartão, permitindo pagar todas com uma única ação sem perder
// o registro individual de cada uma.
type EntradaLista =
  | { tipo: 'individual'; item: ItemPlanejamento }
  | { tipo: 'cartao'; tipoCartao: TipoCartao; itens: ItemPlanejamento[] }

function agruparEntradasPorCartao(itens: ItemPlanejamento[]): EntradaLista[] {
  const porCartao = new Map<TipoCartao, ItemPlanejamento[]>()
  for (const item of itens) {
    const tipo = tipoCartaoPorItem(item.item)
    if (!tipo) continue
    const lista = porCartao.get(tipo)
    if (lista) lista.push(item)
    else porCartao.set(tipo, [item])
  }

  // Um cartão com uma despesa só não vira grupo — seria uma casca em volta de nada.
  const agrupaveis = new Set(
    TIPOS_CARTAO.filter(tipo => (porCartao.get(tipo)?.length ?? 0) >= 2)
  )
  if (agrupaveis.size === 0) return itens.map(item => ({ tipo: 'individual', item }))

  const entradas: EntradaLista[] = []
  const jaInserido = new Set<TipoCartao>()
  for (const item of itens) {
    const tipo = tipoCartaoPorItem(item.item)
    // O grupo entra na posição da primeira despesa dele, preservando a ordenação
    // (pendentes antes de pagos) que a lista já aplicou.
    if (tipo && agrupaveis.has(tipo)) {
      if (!jaInserido.has(tipo)) {
        jaInserido.add(tipo)
        entradas.push({ tipo: 'cartao', tipoCartao: tipo, itens: porCartao.get(tipo)! })
      }
      continue
    }
    entradas.push({ tipo: 'individual', item })
  }
  return entradas
}

export default function ChecklistMensal({ mesSelecionado, autoOpen }: Props) {
  const [itens, setItens] = useState<ItemPlanejamento[]>([])
  const [filtroStatus, setFiltroStatus] = useState<'' | 'pago' | 'pendente'>('')
  const [modalAberto, setModalAberto] = useState<string | null>(null)

  useEffect(() => {
    if (autoOpen) setModalAberto('adicionar')
  }, [autoOpen])
  const [itemSelecionado, setItemSelecionado] = useState<ItemPlanejamento | null>(null)
  const [valorReal, setValorReal] = useState('')
  const [formData, setFormData] = useState({
    item: '',
    responsavel: 'Matheus',
    categoria: 'Fixa',
    tipo_cartao: '' as '' | TipoCartao,
    valor_previsto: '',
    data_vencimento: '',
  })
  const [dataPagamento, setDataPagamento] = useState('')
  const [aplicarFuturos, setAplicarFuturos] = useState(false)
  const [quantidadeMesesFuturos, setQuantidadeMesesFuturos] = useState(String(MESES_FUTUROS_PADRAO))
  const [importandoMesAnterior, setImportandoMesAnterior] = useState(false)
  const [previewImport, setPreviewImport] = useState<{ itens: ItemPlanejamento[]; mesOrigem: string } | null>(null)
  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null)
  const [successId, setSuccessId] = useState<string | null>(null)
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set())
  const [newItemId, setNewItemId] = useState<string | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const pendingNewRef = useRef<string | null>(null)
  const [faturaExpandida, setFaturaExpandida] = useState<Set<string>>(new Set())
  const [grupoFatura, setGrupoFatura] = useState<{ tipoCartao: TipoCartao; itens: ItemPlanejamento[] } | null>(null)
  const [valoresFatura, setValoresFatura] = useState<Record<string, string>>({})
  const [totalFatura, setTotalFatura] = useState('')
  const [dataPagamentoFatura, setDataPagamentoFatura] = useState('')

  const mesRefStr = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')

  const fetcherItens = useCallback(async () => {
    const { data } = await supabase
      .from('planejamento')
      .select('*')
      .eq('mes_referencia', mesRefStr)
      .not('item', 'ilike', '[RECEITA]%')
      .order('categoria', { ascending: false })
    return data || []
  }, [mesRefStr])

  const { isOnline, refetch } = useGlobalSync({
    cacheKey: `checklist:${mesRefStr}`,
    tables: ['planejamento'],
    fetcher: fetcherItens,
    onData: (data: unknown) => {
      setItens(data as ItemPlanejamento[])
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

  async function marcarComoPago(id: string) {
    if (!valorReal) return
    const valorNumerico = parseFloat(valorReal.replace(',', '.'))
    const item = itens.find(i => i.id === id)
    const diff = item ? Math.abs(valorNumerico - item.valor_previsto) : 0
    const dpagamento = dataPagamento || format(new Date(), 'yyyy-MM-dd')

    setModalAberto(null)
    setValorReal('')
    setDataPagamento('')
    setItens(prev => prev.map(i => i.id === id ? { ...i, pago: true, valor_real: valorNumerico, data_pagamento: dpagamento } : i))
    setHighlightId(id)
    setTimeout(() => setHighlightId(null), 500)

    const { error } = await supabase
      .from('planejamento')
      .update({ pago: true, valor_real: valorNumerico, data_pagamento: dpagamento })
      .eq('id', id)

    if (!error) {
      log('pagar', 'planejamento', `Pago: ${item ? removerPrefixoCartao(item.item) : id} — ${formatBRL(valorNumerico)}`, valorNumerico)
      setSuccessId(id)
      setTimeout(() => setSuccessId(null), 400)
      if (diff > 0.01) {
        showToast(`Diferença de ${formatBRL(diff)} em relação ao previsto`, 'erro')
      } else {
        showToast('Pagamento registrado!')
      }
    } else {
      setItens(prev => prev.map(i => i.id === id ? { ...i, pago: false, valor_real: item?.valor_real ?? null, data_pagamento: item?.data_pagamento ?? null } : i))
      showToast('Erro ao registrar pagamento', 'erro')
    }
  }

  /**
   * Total já lançado no extrato para a fatura daquela despesa — usado para
   * pré-preencher o valor a pagar. Antes o responsável era adivinhado a partir do
   * nome do item ("NuBank Conjunto" → Conjunto) e só o cartão principal tinha esse
   * pré-preenchimento; agora sai da coluna `responsavel` e vale para os três cartões.
   */
  async function totalLancadoDaDespesa(item: ItemPlanejamento): Promise<number | null> {
    const tipo = tipoCartaoPorItem(item.item)
    if (!tipo || !item.responsavel) return null
    const mesRefFatura = format(startOfMonth(addMonths(mesSelecionado, 1)), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('transacoes_nubank')
      .select('valor')
      .eq('projeto_fatura', mesRefFatura)
      .eq('cartao', CARTAO_TX_POR_TIPO[tipo])
      .eq('responsavel', item.responsavel)
    if (!data || data.length === 0) return null
    return data.reduce((acc, t) => acc + t.valor, 0)
  }

  async function abrirModalPagamento(item: ItemPlanejamento) {
    setItemSelecionado(item)
    setValorReal('')
    setDataPagamento(format(new Date(), 'yyyy-MM-dd'))
    setModalAberto('pagar')

    const total = await totalLancadoDaDespesa(item)
    if (total !== null) setValorReal(total.toFixed(2).replace('.', ','))
  }

  async function abrirModalPagarFatura(tipoCartao: TipoCartao, grupo: ItemPlanejamento[]) {
    setGrupoFatura({ tipoCartao, itens: grupo })
    setDataPagamentoFatura(format(new Date(), 'yyyy-MM-dd'))

    const valoresIniciais: Record<string, string> = {}
    await Promise.all(grupo.map(async (item) => {
      const total = await totalLancadoDaDespesa(item)
      valoresIniciais[item.id] = formatarValorInput(total ?? item.valor_previsto)
    }))

    setValoresFatura(valoresIniciais)
    setTotalFatura(formatarValorInput(
      grupo.reduce((acc, item) => acc + parseValor(valoresIniciais[item.id]), 0)
    ))
    setModalAberto('pagarFatura')
  }

  /**
   * O total é o que de fato saiu da conta; os valores por cartão são um detalhamento
   * dele. Ao digitar o total, as despesas são rateadas proporcionalmente ao que o
   * extrato mostrou — o que corrige de uma vez diferenças de anuidade, juros ou IOF
   * que aparecem na fatura mas não em nenhuma compra.
   */
  function alterarTotalFatura(texto: string) {
    setTotalFatura(texto)
    if (!grupoFatura) return
    const bases = grupoFatura.itens.map(item => parseValor(valoresFatura[item.id]))
    const rateado = ratearTotal(parseValor(texto), bases)
    setValoresFatura(prev => {
      const proximo = { ...prev }
      grupoFatura.itens.forEach((item, i) => { proximo[item.id] = formatarValorInput(rateado[i]) })
      return proximo
    })
  }

  /** Editar um cartão específico é o caminho inverso: o total passa a ser a soma. */
  function alterarValorDespesaFatura(id: string, texto: string) {
    if (!grupoFatura) return
    const proximo = { ...valoresFatura, [id]: texto }
    setValoresFatura(proximo)
    setTotalFatura(formatarValorInput(
      grupoFatura.itens.reduce((acc, item) => acc + parseValor(proximo[item.id]), 0)
    ))
  }

  async function confirmarPagarFatura() {
    if (!grupoFatura) return
    const dpagamento = dataPagamentoFatura || format(new Date(), 'yyyy-MM-dd')
    const atualizacoes = grupoFatura.itens.map((item) => ({
      id: item.id,
      valorNumerico: parseValor(valoresFatura[item.id]),
    }))
    if (atualizacoes.some(a => a.valorNumerico < 0)) {
      showToast('Informe valores válidos para todos os cartões', 'erro')
      return
    }

    const grupoOriginal = grupoFatura.itens
    const nomeCartao = labelsCartao[grupoFatura.tipoCartao]
    const idsGrupo = new Set(atualizacoes.map(a => a.id))

    setModalAberto(null)
    setGrupoFatura(null)
    setValoresFatura({})
    setTotalFatura('')
    setItens(prev => prev.map(i => idsGrupo.has(i.id)
      ? { ...i, pago: true, valor_real: atualizacoes.find(a => a.id === i.id)!.valorNumerico, data_pagamento: dpagamento }
      : i
    ))

    const resultados = await Promise.all(atualizacoes.map(({ id, valorNumerico }) =>
      supabase.from('planejamento').update({ pago: true, valor_real: valorNumerico, data_pagamento: dpagamento }).eq('id', id)
    ))
    const totalPagoFatura = atualizacoes.reduce((acc, a) => acc + a.valorNumerico, 0)
    const algumErro = resultados.some(r => r.error)

    if (!algumErro) {
      log('pagar', 'planejamento', `Fatura ${nomeCartao} paga (${atualizacoes.length} cartões): ${formatBRL(totalPagoFatura)}`, totalPagoFatura)
      showToast(`Fatura paga! Total: ${formatBRL(totalPagoFatura)}`)
    } else {
      setItens(prev => prev.map(i => {
        const original = grupoOriginal.find(g => g.id === i.id)
        return original ? { ...i, pago: original.pago, valor_real: original.valor_real, data_pagamento: original.data_pagamento } : i
      }))
      showToast('Erro ao registrar pagamento da fatura', 'erro')
    }
  }

  async function desfazerFatura(tipoCartao: TipoCartao, grupo: ItemPlanejamento[]) {
    const ids = grupo.map(i => i.id)

    setItens(prev => prev.map(i => ids.includes(i.id) ? { ...i, pago: false, valor_real: null, data_pagamento: null } : i))

    const { error } = await supabase
      .from('planejamento')
      .update({ pago: false, valor_real: null, data_pagamento: null })
      .in('id', ids)

    if (!error) {
      log('editar', 'planejamento', `Pagamento da fatura ${labelsCartao[tipoCartao]} desfeito (${ids.length} cartões)`)
      showToast('Pagamento da fatura removido')
    } else {
      setItens(prev => prev.map(i => {
        const original = grupo.find(g => g.id === i.id)
        return original ? { ...i, pago: original.pago, valor_real: original.valor_real, data_pagamento: original.data_pagamento } : i
      }))
      showToast('Erro ao desfazer pagamento da fatura', 'erro')
    }
  }

  async function desfazerPagamento(id: string) {
    const item = itens.find(i => i.id === id)

    setModalAberto(null)
    setItens(prev => prev.map(i => i.id === id ? { ...i, pago: false, valor_real: null, data_pagamento: null } : i))

    const { error } = await supabase
      .from('planejamento')
      .update({ pago: false, valor_real: null, data_pagamento: null })
      .eq('id', id)

    if (!error) {
      log('editar', 'planejamento', `Pagamento desfeito: ${item ? removerPrefixoCartao(item.item) : id}`)
      showToast('Pagamento removido')
    } else {
      setItens(prev => prev.map(i => i.id === id ? { ...i, pago: true, valor_real: item?.valor_real ?? null, data_pagamento: item?.data_pagamento ?? null } : i))
      showToast('Erro ao desfazer pagamento', 'erro')
    }
  }

  async function excluirItem(id: string, tambemFuturos: boolean) {
    const item = itens.find(i => i.id === id)

    setModalAberto(null)
    setExitingIds(prev => new Set(prev).add(id))
    const removeTimer = setTimeout(() => {
      setItens(prev => prev.filter(i => i.id !== id))
      setExitingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }, 300)

    const { error } = await supabase.from('planejamento').delete().eq('id', id)
    if (!error) {
      log('excluir', 'planejamento', `Excluído: ${item ? removerPrefixoCartao(item.item) : id}`)
      if (tambemFuturos && item) {
        try {
          const removidos = await excluirRegistrosFuturos(
            'planejamento',
            { item: item.item, responsavel: item.responsavel },
            mesSelecionado
          )
          showToast(removidos > 0 ? `Item excluído (e ${removidos} ocorrência(s) futura(s))` : 'Item excluído')
        } catch {
          showToast('Item excluído, mas houve erro ao excluir as ocorrências futuras', 'erro')
        }
      } else {
        showToast('Item excluído')
      }
    } else {
      clearTimeout(removeTimer)
      setExitingIds(prev => { const s = new Set(prev); s.delete(id); return s })
      if (item) setItens(prev => [...prev, item])
      showToast('Erro ao excluir', 'erro')
    }
  }

  async function editarItem() {
    if (!itemSelecionado) return
    const valor = parseFloat(formData.valor_previsto.replace(',', '.'))
    if (!formData.item.trim()) return
    if (isNaN(valor) || valor <= 0) { showToast('Informe um valor válido', 'erro'); return }
    if (formData.categoria !== 'Cartão' && !formData.data_vencimento) {
      showToast('Informe a data de vencimento', 'erro')
      return
    }
    const updates = {
      item: aplicarPrefixoCartao(formData.item, formData.tipo_cartao),
      responsavel: formData.responsavel,
      categoria: formData.categoria,
      valor_previsto: valor,
      data_vencimento: formData.data_vencimento || null,
    }
    const id = itemSelecionado.id
    const originalItem = itemSelecionado
    const tambemFuturos = aplicarFuturos

    // Feedback imediato: fecha modal e atualiza lista sem aguardar resposta do servidor
    setModalAberto(null)
    setItemSelecionado(null)
    setAplicarFuturos(false)
    setItens(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i))

    const { error } = await supabase.from('planejamento').update(updates).eq('id', id)
    if (!error) {
      log('editar', 'planejamento', `Editado: ${formData.item} — ${formatBRL(valor)}`, valor, originalItem.valor_previsto)
      if (tambemFuturos) {
        // Data de vencimento não é propagada: é específica de cada mês (o dia
        // pode ser reaproveitado, mas o mês/ano de cada linha futura precisa
        // ser preservado, o que uma única atualização em massa não permite).
        const { data_vencimento, ...updatesFuturos } = updates
        try {
          const alterados = await atualizarRegistrosFuturos(
            'planejamento',
            { item: originalItem.item, responsavel: originalItem.responsavel },
            mesSelecionado,
            updatesFuturos
          )
          if (alterados > 0) showToast(`Item editado (e ${alterados} ocorrência(s) futura(s))`)
        } catch {
          showToast('Item editado, mas houve erro ao aplicar aos meses futuros', 'erro')
        }
      }
    } else {
      // Reverte em caso de erro
      setItens(prev => prev.map(i => i.id === id ? originalItem : i))
      showToast(error.message || 'Erro ao editar', 'erro')
    }
  }

  async function adicionarItem() {
    const valor = parseFloat(formData.valor_previsto.replace(',', '.'))
    if (!formData.item.trim()) { showToast('Informe a descrição', 'erro'); return }
    if (isNaN(valor) || valor <= 0) { showToast('Informe um valor válido', 'erro'); return }
    if (formData.categoria !== 'Cartão' && !formData.data_vencimento) {
      showToast('Informe a data de vencimento', 'erro')
      return
    }
    const primeiroDia = startOfMonth(mesSelecionado)
    const novoItem = {
      mes_referencia: format(primeiroDia, 'yyyy-MM-dd'),
      item: aplicarPrefixoCartao(formData.item, formData.tipo_cartao),
      responsavel: formData.responsavel,
      categoria: formData.categoria,
      valor_previsto: valor,
      pago: false,
      valor_real: null,
      data_vencimento: formData.data_vencimento || null,
      data_pagamento: null,
    }

    // Feedback imediato: fecha modal e adiciona item otimisticamente
    const tempId = `temp-${Date.now()}`
    const itemOtimista: ItemPlanejamento = {
      ...novoItem,
      id: tempId,
      created_at: null,
      parcela_atual: null,
      total_parcelas: null,
    }
    const tambemFuturos = aplicarFuturos
    const quantidade = Math.min(
      MESES_FUTUROS_MAXIMO,
      Math.max(1, parseInt(quantidadeMesesFuturos, 10) || MESES_FUTUROS_PADRAO)
    )

    setModalAberto(null)
    setFormData({ item: '', responsavel: 'Matheus', categoria: 'Fixa', tipo_cartao: '', valor_previsto: '', data_vencimento: '' })
    setAplicarFuturos(false)
    setItens(prev => [...prev, itemOtimista])
    setNewItemId(tempId)
    setTimeout(() => setNewItemId(null), 400)

    // Persiste em background
    const { data: insertData, error } = await supabase.from('planejamento').insert([novoItem]).select()
    if (!error) {
      const realId = insertData?.[0]?.id
      if (realId) {
        setItens(prev => prev.map(i => i.id === tempId
          ? { ...itemOtimista, id: realId, created_at: insertData[0].created_at ?? null }
          : i
        ))
      }
      log('inserir', 'planejamento', `Novo item: ${formData.item} — ${formatBRL(valor)}`, valor)

      if (tambemFuturos) {
        const { mes_referencia, ...base } = novoItem
        try {
          await criarRegistrosFuturos('planejamento', base, mesSelecionado, quantidade, (mes) => ({
            data_vencimento: moverVencimentoParaMes(novoItem.data_vencimento, mes),
          }))
          showToast(`Item adicionado e repetido nos próximos ${quantidade} mês(es)`)
        } catch {
          showToast('Item adicionado, mas houve erro ao repetir nos meses futuros', 'erro')
        }
      }
    } else {
      // Reverte em caso de erro
      setItens(prev => prev.filter(i => i.id !== tempId))
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
      .not('item', 'ilike', '[RECEITA]%')

    const candidatos = (itensAnteriores || []).filter(i => {
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

      const { data: existentes } = await supabase
        .from('planejamento')
        .select('id')
        .eq('mes_referencia', mesAtualStr)
        .not('item', 'ilike', '[RECEITA]%')
      const idsExistentes = (existentes || []).map(i => i.id)

      const novosItens = previewImport.itens.map(({ id, mes_referencia, pago, valor_real, data_pagamento, created_at, parcela_atual, total_parcelas, data_vencimento, ...resto }) => ({
        ...resto,
        mes_referencia: mesAtualStr,
        pago: false,
        valor_real: null,
        data_pagamento: null,
        parcela_atual: parcela_atual ? parcela_atual + 1 : null,
        total_parcelas: total_parcelas ?? null,
        data_vencimento: moverVencimentoParaMes(data_vencimento, mesSelecionado),
      }))

      if (novosItens.length > 0) {
        const { error: insertError } = await supabase.from('planejamento').insert(novosItens)
        if (insertError) throw insertError
      }

      if (idsExistentes.length > 0) {
        await supabase.from('planejamento').delete().in('id', idsExistentes)
      }

      log('importar', 'planejamento', `Importados ${novosItens.length} item(ns) de ${previewImport.mesOrigem}`)
      setModalAberto(null)
      setPreviewImport(null)
      refetch()
      showToast('Importação concluída!')
    } catch (e) {
      console.error('Erro ao importar mês anterior:', e)
      showToast('Erro ao importar. Os dados existentes foram preservados.', 'erro')
    } finally {
      setImportandoMesAnterior(false)
    }
  }

  function abrirModalEditar(itemEdit: ItemPlanejamento) {
    setItemSelecionado(itemEdit)
    setFormData({
      item: removerPrefixoCartao(itemEdit.item ?? ''),
      responsavel: itemEdit.responsavel ?? 'Matheus',
      categoria: itemEdit.categoria ?? 'Fixa',
      // Uma linha legada ("NuBank Matheus") é hidratada como 'principal', então
      // simplesmente salvar a edição já a converte para o prefixo novo.
      tipo_cartao: tipoCartaoPorItem(itemEdit.item ?? '') ?? '',
      valor_previsto: (itemEdit.valor_previsto ?? 0).toString(),
      data_vencimento: itemEdit.data_vencimento ?? format(startOfMonth(mesSelecionado), 'yyyy-MM-dd'),
    })
    setAplicarFuturos(false)
    setModalAberto('editar')
  }

  // Nomes reais dos cartões, tirados das próprias linhas do mês já carregadas
  // ("[CARTAO1] PicPay" → "PicPay") — sem query extra.
  const labelsCartao: CartaoLabels = useMemo(() => cartaoLabelsDePlanejamento(itens), [itens])

  const totalPrevisto = useMemo(
    () => itens.reduce((acc, item) => acc + item.valor_previsto, 0),
    [itens]
  )

  const totalPago = useMemo(
    () => itens.reduce((acc, item) => acc + (item.pago ? (item.valor_real ?? item.valor_previsto) : 0), 0),
    [itens]
  )

  const totalPendente = useMemo(
    () => itens.reduce((acc, item) => acc + (!item.pago ? item.valor_previsto : 0), 0),
    [itens]
  )

  const percentualPago = totalPrevisto > 0 ? Math.min((totalPago / totalPrevisto) * 100, 100) : 0
  const itensPagos = itens.filter(i => i.pago).length

  const itensFiltrados = useMemo(() => {
    if (filtroStatus === 'pago') return itens.filter(i => i.pago)
    if (filtroStatus === 'pendente') return itens.filter(i => !i.pago)
    return itens
  }, [itens, filtroStatus])

  const gruposPorCategoria = useMemo(() => {
    const ordem: string[] = []
    const map = new Map<string, ItemPlanejamento[]>()
    for (const item of itensFiltrados) {
      if (!map.has(item.categoria)) {
        ordem.push(item.categoria)
        map.set(item.categoria, [])
      }
      map.get(item.categoria)!.push(item)
    }
    return ordem
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
      .map((cat) => {
        const grupo = map.get(cat)!
        const pendentes = grupo.filter(i => !i.pago)
        const pagos = grupo.filter(i => i.pago)
        return { categoria: cat, itens: [...pendentes, ...pagos] }
      })
  }, [itensFiltrados])

  function renderLinhaItem(item: ItemPlanejamento) {
    const tipoCartao = tipoCartaoPorItem(item.item)
    const diff = item.pago && item.valor_real !== null ? Math.abs(item.valor_real - item.valor_previsto) : 0
    return (
      <SwipeableItem
        key={item.id}
        onDelete={() => { setItemSelecionado(item); setAplicarFuturos(false); setModalAberto('excluir') }}
        disabled={!isOnline}
      >
        <div
          className={`px-4 py-3 transition-[background-color,color,opacity] duration-200 border-l-4 ${
            estiloResponsavel(item.responsavel).borda
          } ${item.pago ? 'bg-gray-50/60 dark:bg-white/[0.04]' : 'bg-white'} ${isOnline ? 'cursor-pointer active:bg-gray-50 dark:active:bg-white/[0.06] hover:bg-gray-50/50 dark:hover:bg-white/[0.06]' : ''} ${exitingIds.has(item.id) ? 'item-exit' : newItemId === item.id ? 'item-new' : ''} ${highlightId === item.id ? 'state-highlight' : ''}`}
          onClick={() => { if (isOnline) abrirModalEditar(item) }}
          role={isOnline ? 'button' : undefined}
          tabIndex={isOnline ? 0 : undefined}
          onKeyDown={isOnline ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirModalEditar(item) } } : undefined}
          aria-label={isOnline ? `Editar ${removerPrefixoCartao(item.item)}` : undefined}
        >
          <div className="flex items-center gap-3">
            {/* Status dot */}
            <div className={`w-2 h-2 rounded-full shrink-0 ${item.pago ? 'bg-green-500' : 'bg-gray-300'}`} />

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium truncate transition-colors duration-200 ${item.pago ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                {removerPrefixoCartao(item.item)}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[10px] text-gray-400">{item.responsavel}</span>
                {tipoCartao && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">
                    <CreditCard className="w-2.5 h-2.5" /> {labelsCartao[tipoCartao]}
                  </span>
                )}
                <StatusBadge status={calcularStatusVencimento(item.data_pagamento, item.data_vencimento)} />
                {item.data_vencimento && !item.data_pagamento && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
                    <Calendar className="w-2.5 h-2.5" />
                    {format(parseISO(item.data_vencimento), 'dd/MM')}
                  </span>
                )}
              </div>
            </div>

            {/* Valores */}
            <div className="text-right shrink-0 mr-1">
              <p className={`text-sm font-semibold num ${item.pago ? 'text-gray-400' : 'text-gray-800'}`}>
                {formatBRL(item.valor_previsto)}
              </p>
              {item.pago && (
                <p className={`text-xs font-medium num ${diff > 0.01 ? 'text-red-500' : 'text-emerald-600'}`}>
                  ✓ {formatBRL(item.valor_real ?? item.valor_previsto)}
                </p>
              )}
            </div>

            {/* Ação de pagamento */}
            {isOnline && (
              <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                {!item.pago ? (
                  <button
                    onClick={() => abrirModalPagamento(item)}
                    className="p-1.5 rounded-xl text-green-600 hover:bg-green-100 active:bg-green-200 transition"
                    aria-label="Registrar pagamento"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                  </button>
                ) : (
                  <button
                    onClick={() => { setItemSelecionado(item); setModalAberto('desfazer') }}
                    className={`p-1.5 rounded-lg text-amber-500 hover:bg-amber-50 transition ${successId === item.id ? 'btn-success' : ''}`}
                    title="Desfazer pagamento"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Alerta de diferença */}
          {diff > 0.01 && (
            <div className="mt-1.5 ml-5 flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="w-3 h-3" />
              Diferença de {formatBRL(diff)} em relação ao previsto
            </div>
          )}
        </div>
      </SwipeableItem>
    )
  }

  function renderGrupoCartao(tipoCartao: TipoCartao, grupo: ItemPlanejamento[]) {
    const nomeCartao = labelsCartao[tipoCartao]
    const groupKey = `${tipoCartao}-${grupo.map(i => i.id).join('-')}`
    const expandido = faturaExpandida.has(groupKey)
    const totalPrevistoGrupo = grupo.reduce((acc, i) => acc + i.valor_previsto, 0)
    const totalPagoGrupo = grupo.reduce((acc, i) => acc + (i.pago ? (i.valor_real ?? i.valor_previsto) : 0), 0)
    const todosPagos = grupo.every(i => i.pago)
    const algunsPagos = grupo.some(i => i.pago)
    // "[PRINCIPAL] NuBank Matheus" → "Matheus": tira o prefixo e, se sobrar o nome do
    // próprio cartão na frente, tira também — senão o chip repetiria "NuBank NuBank".
    const nomesCartoes = grupo
      .map(i => {
        const nome = removerPrefixoCartao(i.item)
        const semCartao = nome.replace(new RegExp(`^${nomeCartao}\\s*`, 'i'), '').trim()
        return semCartao || nome
      })
      .filter(Boolean)

    function alternarExpansao() {
      setFaturaExpandida(prev => {
        const next = new Set(prev)
        if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey)
        return next
      })
    }

    return (
      <div key={`cartao-${groupKey}`}>
        <div
          className={`px-4 py-3 transition-colors duration-200 border-l-4 border-l-purple-400 ${todosPagos ? 'bg-gray-50/60 dark:bg-white/[0.04]' : 'bg-white'} cursor-pointer active:bg-gray-50 dark:active:bg-white/[0.06] hover:bg-gray-50/50 dark:hover:bg-white/[0.06]`}
          onClick={alternarExpansao}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternarExpansao() } }}
          aria-label={`${expandido ? 'Recolher' : 'Expandir'} fatura ${nomeCartao}`}
          aria-expanded={expandido}
        >
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full shrink-0 ${todosPagos ? 'bg-green-500' : algunsPagos ? 'bg-amber-400' : 'bg-gray-300'}`} />

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className={`text-sm font-medium truncate ${todosPagos ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                  Fatura {nomeCartao}
                </p>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-semibold num ${todosPagos ? 'text-gray-400' : 'text-gray-800'}`}>
                    {formatBRL(totalPrevistoGrupo)}
                  </p>
                  {algunsPagos && (
                    <p className="text-xs font-medium num text-emerald-600">
                      ✓ {formatBRL(totalPagoGrupo)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className="inline-flex items-center gap-0.5 text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full shrink-0">
                  <CreditCard className="w-2.5 h-2.5" /> {grupo.length} cartões
                </span>
                <span className="text-[10px] text-gray-400 truncate">{nomesCartoes.join(' · ')}</span>
              </div>
            </div>

            <ChevronDown className={`w-4 h-4 text-gray-300 shrink-0 transition-transform duration-200 ${expandido ? 'rotate-180' : ''}`} />
          </div>

          {isOnline && (
            <div className="mt-2.5 pl-5" onClick={(e) => e.stopPropagation()}>
              {!todosPagos ? (
                <button
                  onClick={() => abrirModalPagarFatura(tipoCartao, grupo.filter(i => !i.pago))}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-green-50 text-green-600 text-xs font-bold hover:bg-green-100 active:bg-green-200 transition"
                  aria-label="Pagar fatura completa"
                >
                  <CheckCircle2 className="w-4 h-4" /> Pagar fatura completa
                </button>
              ) : (
                <button
                  onClick={() => desfazerFatura(tipoCartao, grupo)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-amber-50 text-amber-600 text-xs font-bold hover:bg-amber-100 transition"
                >
                  <RotateCcw className="w-4 h-4" /> Desfazer pagamento da fatura
                </button>
              )}
            </div>
          )}
        </div>

        {expandido && (
          <div className="pl-3 bg-gray-50/50 dark:bg-white/[0.02] divide-y divide-gray-100 border-t border-gray-100">
            {grupo.map(renderLinhaItem)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">

      {/* Toast */}
      {toast && (
        <div className={`toast-enter fixed top-4 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-2 px-4 py-2.5 rounded-2xl shadow-float text-sm font-medium ${
          toast.tipo === 'ok' ? 'bg-gray-900 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.tipo === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {toast.msg}
        </div>
      )}

      {/* Alertas inline de vencimento próximo */}
      {(() => {
        const alertas = verificarVencimentos(itens)
        if (alertas.hoje.length === 0 && alertas.amanha.length === 0) return null
        return (
          <div className="space-y-1.5">
            {alertas.hoje.length > 0 && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-2xl px-3 py-2.5">
                <Bell className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-red-700">Vence hoje!</p>
                  <p className="text-xs text-red-600 truncate">{alertas.hoje.map(i => removerPrefixoCartao(i.item)).join(', ')}</p>
                </div>
              </div>
            )}
            {alertas.amanha.length > 0 && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-2xl px-3 py-2.5">
                <Bell className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-amber-700">Vence amanhã</p>
                  <p className="text-xs text-amber-600 truncate">{alertas.amanha.map(i => removerPrefixoCartao(i.item)).join(', ')}</p>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Resumo + Filtros */}
      <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3.5">
          <div className="w-7 h-7 rounded-xl bg-red-100 flex items-center justify-center">
            <Receipt className="w-4 h-4 text-red-600" />
          </div>
          <span className="font-semibold text-gray-800 text-sm">Resumo de Despesas</span>
        </div>

        {/* Métricas — leitura, sem peso visual extra */}
        <div className="grid grid-cols-3 gap-2 mb-3.5">
          <div className="bg-gray-50 rounded-2xl p-2.5 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">Previsto</p>
            <p className="text-xs font-bold text-gray-800 break-all leading-tight num">{formatBRL(totalPrevisto)}</p>
          </div>
          <div className="bg-primary-50 rounded-2xl p-2.5 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-500 mb-0.5">Pago</p>
            <p className="text-xs font-bold text-primary-700 break-all leading-tight num">{formatBRL(totalPago)}</p>
          </div>
          <div className={`rounded-2xl p-2.5 text-center ${totalPendente <= 0.009 ? 'bg-green-50' : 'bg-red-50'}`}>
            <p className={`text-[10px] font-semibold uppercase tracking-wide mb-0.5 ${totalPendente <= 0.009 ? 'text-green-500' : 'text-red-500'}`}>A pagar</p>
            {totalPendente <= 0.009
              ? <p className="text-xs font-bold text-green-600 leading-tight">Quitado</p>
              : <p className="text-xs font-bold text-red-600 break-all leading-tight num">{formatBRL(totalPendente)}</p>
            }
          </div>
        </div>

        {/* Barra de progresso geral */}
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1.5">
            <span className="tabular-nums">{itensPagos}/{itens.length} itens pagos</span>
            <span className="font-bold text-primary-600 tabular-nums">{percentualPago.toFixed(0)}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
            <div
              key={Math.round(percentualPago)}
              className="h-1.5 rounded-full bg-gradient-to-r from-primary-500 to-primary-600 bar-enter"
              style={{ '--bar-w': `${percentualPago}%` } as React.CSSProperties}
            />
          </div>
        </div>

        {/* Filtros compactos */}
        <div className="flex gap-1.5 pt-3 border-t border-gray-100">
          {(['', 'pago', 'pendente'] as const).map((f) => {
            const label = f === '' ? 'Todos' : f === 'pago' ? 'Pagos' : 'Pendentes'
            const isActive = filtroStatus === f
            return (
              <button
                key={f}
                onClick={() => setFiltroStatus(f)}
                className={`text-xs px-3 py-1 rounded-full font-medium transition-all duration-150 active:scale-95 ${
                  isActive
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

      {/* Ações */}
      {isOnline && (
        <PageActionButtons
          onAdd={() => {
            setFormData({ item: '', responsavel: 'Matheus', categoria: 'Fixa', tipo_cartao: '', valor_previsto: '', data_vencimento: format(startOfMonth(mesSelecionado), 'yyyy-MM-dd') })
            setAplicarFuturos(false)
            setQuantidadeMesesFuturos(String(MESES_FUTUROS_PADRAO))
            setModalAberto('adicionar')
          }}
          onImport={abrirModalImportar}
          importColorClass="bg-orange-500 text-white hover:bg-orange-600"
        />
      )}

      {/* Lista agrupada por categoria */}
      {gruposPorCategoria.length === 0 ? (
        <div className="bg-white rounded-3xl shadow-card border border-gray-100">
          <div className="flex flex-col items-center justify-center py-14 gap-3">
            <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center">
              <Receipt className="w-6 h-6 text-red-300" strokeWidth={1.5} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-500">
                {filtroStatus ? 'Nenhum item neste filtro' : 'Nenhuma despesa cadastrada'}
              </p>
              {!filtroStatus && (
                <p className="text-xs text-gray-400 mt-0.5">Toque em + Adicionar para começar</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {gruposPorCategoria.map(({ categoria, itens: grupoItens }, catIdx) => {
            const subtotalGrupo = grupoItens.reduce((acc, i) => acc + i.valor_previsto, 0)
            const pendentesGrupo = grupoItens.filter(i => !i.pago).length
            const pagosGrupo = grupoItens.filter(i => i.pago).length
            const pctGrupo = grupoItens.length > 0 ? (pagosGrupo / grupoItens.length) * 100 : 0
            return (
              <div key={categoria} className="bg-white rounded-3xl shadow-card border border-gray-100 overflow-hidden list-item-enter" style={{ animationDelay: `${Math.min(catIdx, 4) * 35}ms` }}>
                {/* Cabeçalho do grupo */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      CATEGORIA_CORES_PLAN[categoria] ?? 'bg-gray-100 text-gray-500'
                    }`}>
                      {categoria}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {pendentesGrupo > 0 ? `${pendentesGrupo} pendente${pendentesGrupo > 1 ? 's' : ''}` : 'Tudo pago ✓'}
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-gray-700 num">{formatBRL(subtotalGrupo)}</span>
                </div>

                {/* Barra de progresso da categoria */}
                {pctGrupo > 0 && (
                  <div className="h-0.5 bg-gray-100">
                    <div
                      className="h-0.5 bg-primary-400 transition-[width] duration-700 ease-smooth"
                      style={{ width: `${pctGrupo}%` }}
                    />
                  </div>
                )}

                {/* Itens do grupo */}
                <div className="divide-y divide-gray-100">
                  {agruparEntradasPorCartao(grupoItens).map((entrada) =>
                    entrada.tipo === 'individual'
                      ? renderLinhaItem(entrada.item)
                      : renderGrupoCartao(entrada.tipoCartao, entrada.itens)
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal: Registrar Pagamento */}
      {modalAberto === 'pagar' && itemSelecionado && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4 modal-overlay">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm p-6 shadow-float modal-sheet sm:modal-center">
            <h3 className="text-lg font-bold mb-1">Registrar Pagamento</h3>
            <p className="text-sm text-gray-500 mb-4">{removerPrefixoCartao(itemSelecionado.item)}</p>
            <label className="text-xs font-medium text-gray-600 mb-1.5 block">Valor pago (R$)</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder={`Previsto: ${formatBRL(itemSelecionado.valor_previsto)}`}
              value={valorReal}
              onChange={(e) => setValorReal(numericOnly(e.target.value))}
              className="w-full border border-gray-200 rounded-xl p-3 text-lg font-semibold mb-4 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
              autoFocus
            />
            <label className="text-xs font-medium text-gray-600 mb-1.5 block">Data de pagamento</label>
            <input
              type="date"
              value={dataPagamento}
              onChange={(e) => setDataPagamento(e.target.value)}
              min={itemSelecionado.mes_referencia}
              max={format(new Date(), 'yyyy-MM-dd')}
              className="w-full border border-gray-200 rounded-xl p-3 text-sm mb-5 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
            />
            <div className="flex gap-3">
              <button onClick={() => setModalAberto(null)} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600 hover:bg-gray-200 transition-colors active:scale-[0.97]">Cancelar</button>
              <button onClick={() => marcarComoPago(itemSelecionado.id)} className="flex-1 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition-all active:scale-[0.97] shadow-sm">Confirmar</button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Modal: Pagar fatura NuBank completa (1 ação → paga as N despesas do grupo) */}
      {modalAberto === 'pagarFatura' && grupoFatura && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4 modal-overlay">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm p-6 shadow-float modal-sheet sm:modal-center max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-1">Pagar fatura {labelsCartao[grupoFatura.tipoCartao]}</h3>
            <p className="text-sm text-gray-500 mb-4">
              {grupoFatura.itens.length} cartão{grupoFatura.itens.length > 1 ? 'ões' : ''} nesta fatura
            </p>

            <label className="text-xs font-medium text-gray-600 mb-1.5 block">
              Valor total pago da fatura (R$)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={totalFatura}
              onChange={(e) => alterarTotalFatura(numericOnly(e.target.value))}
              className="w-full border border-gray-200 rounded-xl p-3 text-lg font-semibold mb-1.5 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
              autoFocus
            />
            <p className="text-[11px] text-gray-400 mb-4">
              Ao alterar o total, os valores por cartão são recalculados
              proporcionalmente e somam exatamente esse valor.
            </p>

            <div className="space-y-3 mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Detalhamento por cartão
              </p>
              {grupoFatura.itens.map((item) => {
                const valor = parseValor(valoresFatura[item.id])
                const diff = valor - item.valor_previsto
                return (
                  <div key={item.id}>
                    <label className="text-xs font-medium text-gray-600 mb-1.5 block">
                      {removerPrefixoCartao(item.item)}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder={`Previsto: ${formatBRL(item.valor_previsto)}`}
                      value={valoresFatura[item.id] ?? ''}
                      onChange={(e) => alterarValorDespesaFatura(item.id, numericOnly(e.target.value))}
                      className="w-full border border-gray-200 rounded-xl p-3 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
                    />
                    {Math.abs(diff) > 0.005 && (
                      <p className={`text-[11px] mt-1 num ${diff > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                        {diff > 0 ? '+' : '−'}{formatBRL(Math.abs(diff))} vs. previsto
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            <label className="text-xs font-medium text-gray-600 mb-1.5 block">Data de pagamento</label>
            <input
              type="date"
              value={dataPagamentoFatura}
              onChange={(e) => setDataPagamentoFatura(e.target.value)}
              min={grupoFatura.itens[0]?.mes_referencia}
              max={format(new Date(), 'yyyy-MM-dd')}
              className="w-full border border-gray-200 rounded-xl p-3 text-sm mb-5 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
            />
            <div className="flex gap-3">
              <button onClick={() => { setModalAberto(null); setGrupoFatura(null); setTotalFatura('') }} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600 hover:bg-gray-200 transition-colors active:scale-[0.97]">Cancelar</button>
              <button onClick={confirmarPagarFatura} className="flex-1 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition-all active:scale-[0.97] shadow-sm">Confirmar</button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Modal: Adicionar / Editar */}
      {(modalAberto === 'adicionar' || modalAberto === 'editar') && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4 modal-overlay">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm p-6 shadow-float modal-sheet sm:modal-center">
            <h3 className="text-lg font-bold mb-5">{modalAberto === 'adicionar' ? 'Novo Item' : 'Editar Item'}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Descrição</label>
                <input type="text" value={formData.item} onChange={(e) => setFormData({ ...formData, item: e.target.value })} className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Responsável</label>
                <select value={formData.responsavel} onChange={(e) => setFormData({ ...formData, responsavel: e.target.value })} className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow bg-white">
                  {RESPONSAVEIS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Categoria</label>
                <select value={formData.categoria} onChange={(e) => setFormData({ ...formData, categoria: e.target.value })} className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow bg-white">
                  {CATEGORIAS_PLANEJAMENTO.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Cartão</label>
                <select value={formData.tipo_cartao} onChange={(e) => setFormData({ ...formData, tipo_cartao: e.target.value as '' | TipoCartao })} className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow bg-white">
                  <option value="">Nenhum</option>
                  {TIPOS_CARTAO.map(tipo => (
                    <option key={tipo} value={tipo}>{labelsCartao[tipo]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Valor previsto (R$)</label>
                <input type="text" inputMode="decimal" value={formData.valor_previsto} onChange={(e) => setFormData({ ...formData, valor_previsto: numericOnly(e.target.value) })} className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow" placeholder="0,00" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  Data de Vencimento
                  {formData.categoria !== 'Cartão' && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                <input
                  type="date"
                  value={formData.data_vencimento}
                  onChange={(e) => setFormData({ ...formData, data_vencimento: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
                />
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={aplicarFuturos}
                    onChange={(e) => setAplicarFuturos(e.target.checked)}
                    className="w-4 h-4 rounded accent-primary-600"
                  />
                  {modalAberto === 'adicionar' ? 'Repetir nos meses futuros' : 'Aplicar também aos meses futuros'}
                </label>
                {modalAberto === 'adicionar' ? (
                  aplicarFuturos && (
                    <div className="mt-2">
                      <label className="text-xs font-medium text-gray-600 mb-1 block">Por quantos meses</label>
                      <input
                        type="number"
                        min={1}
                        max={MESES_FUTUROS_MAXIMO}
                        value={quantidadeMesesFuturos}
                        onChange={(e) => setQuantidadeMesesFuturos(e.target.value)}
                        className="w-full border border-gray-200 rounded-xl p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
                      />
                    </div>
                  )
                ) : (
                  <p className="text-xs text-gray-400 mt-1">
                    Atualiza descrição, responsável, categoria e valor de todas as ocorrências futuras deste item (a data de vencimento de cada mês não é alterada).
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setModalAberto(null)} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600 hover:bg-gray-200 transition-colors active:scale-[0.97]">Cancelar</button>
              <button onClick={modalAberto === 'adicionar' ? adicionarItem : editarItem} className="flex-1 py-3 rounded-xl bg-primary-600 text-white font-semibold hover:bg-primary-700 transition-all active:scale-[0.97] shadow-sm">Salvar</button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Modal: Importar mês anterior */}
      {modalAberto === 'importar' && previewImport && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[200] p-4 modal-overlay">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 max-h-[80vh] flex flex-col shadow-float">
            <h3 className="text-lg font-bold mb-1">Importar do mês anterior</h3>
            <p className="text-sm text-gray-500 mb-3">
              Origem: <span className="font-semibold capitalize">{previewImport.mesOrigem}</span>
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 text-xs text-amber-800 space-y-1">
              <p className="font-semibold">⚠️ Atenção — esta ação irá:</p>
              <p>• Apagar todos os itens de despesa do mês atual</p>
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
                  <div key={idx} className="text-xs flex justify-between bg-gray-50 px-2 py-1.5 rounded-xl">
                    <span className="truncate max-w-[180px] text-gray-700">
                      {removerPrefixoCartao(i.item)}{parcelaLabel}
                    </span>
                    <span className="text-gray-500 shrink-0 ml-2">{formatBRL(i.valor_previsto)}</span>
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
                className="flex-1 py-2.5 rounded-xl bg-gray-100 font-medium text-gray-600 hover:bg-gray-200 transition-colors active:scale-[0.97]"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarImportarMesAnterior}
                disabled={importandoMesAnterior || previewImport.itens.length === 0}
                className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white font-semibold hover:bg-orange-600 disabled:opacity-50 transition-all active:scale-[0.97] shadow-sm"
              >
                {importandoMesAnterior ? 'Importando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Modal: Excluir */}
      {modalAberto === 'excluir' && itemSelecionado && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4 modal-overlay">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm p-6 shadow-float modal-sheet sm:modal-center">
            <h3 className="text-lg font-bold mb-2">Excluir item</h3>
            <p className="text-sm text-gray-500 mb-4">
              Tem certeza que deseja excluir <span className="font-semibold text-gray-800">&quot;{removerPrefixoCartao(itemSelecionado.item)}&quot;</span>?
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
              <button onClick={() => setModalAberto(null)} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600 hover:bg-gray-200 transition-colors active:scale-[0.97]">Cancelar</button>
              <button onClick={() => excluirItem(itemSelecionado.id, aplicarFuturos)} className="flex-1 py-3 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 transition-all active:scale-[0.97] shadow-sm">Excluir</button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Modal: Desfazer pagamento */}
      {modalAberto === 'desfazer' && itemSelecionado && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-[200] p-4 modal-overlay">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-sm p-6 shadow-float modal-sheet sm:modal-center">
            <h3 className="text-lg font-bold mb-2">Desfazer pagamento</h3>
            <p className="text-sm text-gray-500 mb-1">
              <span className="font-semibold text-gray-800">{removerPrefixoCartao(itemSelecionado.item)}</span>
            </p>
            {itemSelecionado.valor_real !== null && (
              <p className="text-sm text-gray-400 mb-5">
                Valor registrado: {formatBRL(itemSelecionado.valor_real)}
              </p>
            )}
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-5">
              O item voltará para o status de pendente e o valor registrado será apagado.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setModalAberto(null)} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600 hover:bg-gray-200 transition-colors active:scale-[0.97]">Cancelar</button>
              <button onClick={() => desfazerPagamento(itemSelecionado.id)} className="flex-1 py-3 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 transition-all active:scale-[0.97] shadow-sm">Desfazer</button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  )
}
