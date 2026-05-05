'use client'

import { useState, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, addMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useGlobalSync } from '@/lib/useGlobalSync'
import {
  Repeat, Pencil, Trash2, Plus, X, WifiOff,
  CheckCircle2, AlertTriangle, XCircle, MinusCircle,
  CreditCard, Search,
} from 'lucide-react'
import { log, numericOnly } from '@/lib/logger'

interface Assinatura {
  id: string
  nome: string
  valor: number
  cartao: string
  responsavel: string
  dia_cobranca: number | null
  categoria: string
  ativa: boolean
  observacao: string | null
  created_at: string
}

interface TransacaoSimples {
  descricao: string
  valor: number
  cartao: string
  projeto_fatura: string
}

interface Props {
  mesSelecionado: Date
}

const CATEGORIAS = ['Streaming', 'Música', 'Software', 'Saúde', 'Educação', 'Jogos', 'Segurança', 'Outros']
const CARTOES_KEYS = ['nubank', 'cartao1', 'cartao2'] as const
const RESPONSAVEIS = ['Matheus', 'Jeniffer', 'Compartilhado']

type CartaoLabels = { nubank: string; cartao1: string; cartao2: string }
const CARTAO_LABELS_DEFAULT: CartaoLabels = { nubank: 'NuBank', cartao1: 'Cartão 1', cartao2: 'Cartão 2' }

const FORM_VAZIO = {
  nome: '',
  valor: '',
  cartao: 'nubank',
  responsavel: 'Matheus',
  dia_cobranca: '',
  categoria: 'Streaming',
  observacao: '',
}

type StatusTx = 'detectada' | 'valor_divergente' | 'nao_encontrada' | 'inativa'

export default function AssinaturasMensal({ mesSelecionado }: Props) {
  const [itens, setItens] = useState<Assinatura[]>([])
  const [transacoes, setTransacoes] = useState<TransacaoSimples[]>([])
  const [cartaoLabels, setCartaoLabels] = useState<CartaoLabels>(CARTAO_LABELS_DEFAULT)
  const [verificando, setVerificando] = useState(false)

  const [modalAberto, setModalAberto] = useState<'adicionar' | 'editar' | 'excluir' | null>(null)
  const [itemSelecionado, setItemSelecionado] = useState<Assinatura | null>(null)
  const [formData, setFormData] = useState(FORM_VAZIO)

  const [filtroCartao, setFiltroCartao] = useState('todos')
  const [filtroResponsavel, setFiltroResponsavel] = useState('todos')

  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null)

  // nextMesRefStr = mês+1, usado como projeto_fatura (regra do sistema)
  const mesRefStr = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')
  const nextMesRefStr = format(startOfMonth(addMonths(mesSelecionado, 1)), 'yyyy-MM-dd')
  const mesFmt = format(mesSelecionado, 'MMMM', { locale: ptBR })

  const fetcher = useCallback(async () => {
    const [{ data: assinaturasData }, { data: transacoesData }, { data: planejamentoData }] = await Promise.all([
      supabase.from('assinaturas').select('*').order('nome', { ascending: true }),
      supabase
        .from('transacoes_nubank')
        .select('descricao, valor, cartao, projeto_fatura')
        .eq('projeto_fatura', nextMesRefStr),
      supabase.from('planejamento').select('item').eq('mes_referencia', mesRefStr),
    ])
    const c1 = (planejamentoData || []).find(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO1]'))?.item?.replace('[CARTAO1]', '').trim()
    const c2 = (planejamentoData || []).find(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO2]'))?.item?.replace('[CARTAO2]', '').trim()
    return {
      assinaturas: assinaturasData || [],
      transacoes: transacoesData || [],
      cartaoLabels: { nubank: 'NuBank', cartao1: c1 || 'Cartão 1', cartao2: c2 || 'Cartão 2' },
    }
  }, [mesRefStr, nextMesRefStr])

  const { isOnline } = useGlobalSync({
    cacheKey: `assinaturas:${mesRefStr}`,
    tables: ['assinaturas', 'transacoes_nubank', 'planejamento'],
    fetcher,
    onData: (raw) => {
      const d = raw as { assinaturas: Assinatura[]; transacoes: TransacaoSimples[]; cartaoLabels: CartaoLabels }
      setItens(d.assinaturas)
      setTransacoes(d.transacoes)
      setCartaoLabels(d.cartaoLabels)
    },
  })

  function showToast(msg: string, tipo: 'ok' | 'erro' = 'ok') {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3500)
  }

  async function recarregar() {
    const [{ data: a }, { data: t }, { data: p }] = await Promise.all([
      supabase.from('assinaturas').select('*').order('nome', { ascending: true }),
      supabase
        .from('transacoes_nubank')
        .select('descricao, valor, cartao, projeto_fatura')
        .eq('projeto_fatura', nextMesRefStr),
      supabase.from('planejamento').select('item').eq('mes_referencia', mesRefStr),
    ])
    const c1 = (p || []).find(x => typeof x.item === 'string' && x.item.startsWith('[CARTAO1]'))?.item?.replace('[CARTAO1]', '').trim()
    const c2 = (p || []).find(x => typeof x.item === 'string' && x.item.startsWith('[CARTAO2]'))?.item?.replace('[CARTAO2]', '').trim()
    setItens(a || [])
    setTransacoes(t || [])
    setCartaoLabels({ nubank: 'NuBank', cartao1: c1 || 'Cartão 1', cartao2: c2 || 'Cartão 2' })
  }

  async function verificarNaFatura() {
    setVerificando(true)
    const { data } = await supabase
      .from('transacoes_nubank')
      .select('descricao, valor, cartao, projeto_fatura')
      .eq('projeto_fatura', nextMesRefStr)
    setTransacoes(data || [])
    setVerificando(false)
    const ativas = itens.filter(i => i.ativa)
    const detectadas = ativas.filter(i => {
      const nome = i.nome.toLowerCase()
      return (data || []).some(tx => tx.cartao === i.cartao && tx.descricao.toLowerCase().includes(nome))
    }).length
    showToast(`${detectadas} de ${ativas.length} assinatura(s) encontrada(s) na fatura de ${mesFmt}`)
  }

  function statusTransacao(assinatura: Assinatura): StatusTx {
    if (!assinatura.ativa) return 'inativa'
    const nome = assinatura.nome.toLowerCase()
    const matches = transacoes.filter(
      tx => tx.cartao === assinatura.cartao && tx.descricao.toLowerCase().includes(nome)
    )
    if (matches.length === 0) return 'nao_encontrada'
    const valorOk = matches.some(tx => Math.abs(tx.valor - assinatura.valor) <= 0.05)
    return valorOk ? 'detectada' : 'valor_divergente'
  }

  const itensFiltrados = useMemo(() => {
    return itens.filter(i => {
      if (filtroCartao !== 'todos' && i.cartao !== filtroCartao) return false
      if (filtroResponsavel !== 'todos' && i.responsavel !== filtroResponsavel) return false
      return true
    })
  }, [itens, filtroCartao, filtroResponsavel])

  const itensAtivos = useMemo(() => itens.filter(i => i.ativa), [itens])

  const totalAtivo = useMemo(
    () => itensAtivos.reduce((acc, i) => acc + i.valor, 0),
    [itensAtivos]
  )

  const totalPorCartao = useMemo(() => ({
    nubank: itensAtivos.filter(i => i.cartao === 'nubank').reduce((acc, i) => acc + i.valor, 0),
    cartao1: itensAtivos.filter(i => i.cartao === 'cartao1').reduce((acc, i) => acc + i.valor, 0),
    cartao2: itensAtivos.filter(i => i.cartao === 'cartao2').reduce((acc, i) => acc + i.valor, 0),
  }), [itensAtivos])

  const totalMatheus = useMemo(
    () => itensAtivos.filter(i => i.responsavel === 'Matheus').reduce((acc, i) => acc + i.valor, 0),
    [itensAtivos]
  )
  const totalJeniffer = useMemo(
    () => itensAtivos.filter(i => i.responsavel === 'Jeniffer').reduce((acc, i) => acc + i.valor, 0),
    [itensAtivos]
  )

  const detectadasCount = useMemo(
    () => itensAtivos.filter(i => statusTransacao(i) === 'detectada').length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itensAtivos, transacoes]
  )

  const detectadasValor = useMemo(
    () => itensAtivos.filter(i => statusTransacao(i) === 'detectada').reduce((acc, i) => acc + i.valor, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itensAtivos, transacoes]
  )

  const itensPorCartao = useMemo(() => {
    const groups: Record<string, Assinatura[]> = { nubank: [], cartao1: [], cartao2: [] }
    for (const item of itensFiltrados) {
      if (!groups[item.cartao]) groups[item.cartao] = []
      groups[item.cartao].push(item)
    }
    return groups
  }, [itensFiltrados])

  async function salvar() {
    const nome = formData.nome.trim()
    const valor = parseFloat(formData.valor.replace(',', '.'))
    if (!nome || isNaN(valor) || valor <= 0) return

    const payload = {
      nome,
      valor,
      cartao: formData.cartao,
      responsavel: formData.responsavel,
      dia_cobranca: formData.dia_cobranca ? parseInt(formData.dia_cobranca) : null,
      categoria: formData.categoria,
      observacao: formData.observacao.trim() || null,
    }

    if (modalAberto === 'adicionar') {
      const { error } = await supabase.from('assinaturas').insert([payload])
      if (error) { showToast('Erro ao adicionar', 'erro'); return }
      log('inserir', 'assinaturas', `Nova assinatura: ${nome} — R$ ${valor.toFixed(2)}`, valor)
      showToast('Assinatura adicionada!')
    } else if (itemSelecionado) {
      const { error } = await supabase.from('assinaturas').update(payload).eq('id', itemSelecionado.id)
      if (error) { showToast('Erro ao salvar', 'erro'); return }
      log('editar', 'assinaturas', `Editada: ${nome} — R$ ${valor.toFixed(2)}`, valor)
      showToast('Atualizado!')
    }

    fecharModal()
    recarregar()
  }

  async function excluir() {
    if (!itemSelecionado) return
    const { error } = await supabase.from('assinaturas').delete().eq('id', itemSelecionado.id)
    if (!error) {
      log('excluir', 'assinaturas', `Excluída: ${itemSelecionado.nome}`, itemSelecionado.valor)
      fecharModal()
      recarregar()
      showToast('Excluída')
    } else {
      showToast('Erro ao excluir', 'erro')
    }
  }

  async function toggleAtiva(item: Assinatura) {
    const { error } = await supabase.from('assinaturas').update({ ativa: !item.ativa }).eq('id', item.id)
    if (!error) {
      log('editar', 'assinaturas', `${item.ativa ? 'Desativada' : 'Ativada'}: ${item.nome}`)
      recarregar()
    }
  }

  function abrirEditar(item: Assinatura) {
    setItemSelecionado(item)
    setFormData({
      nome: item.nome,
      valor: String(item.valor),
      cartao: item.cartao,
      responsavel: item.responsavel,
      dia_cobranca: item.dia_cobranca ? String(item.dia_cobranca) : '',
      categoria: item.categoria,
      observacao: item.observacao || '',
    })
    setModalAberto('editar')
  }

  function fecharModal() {
    setModalAberto(null)
    setItemSelecionado(null)
    setFormData(FORM_VAZIO)
  }

  function StatusBadge({ status }: { status: StatusTx }) {
    if (status === 'detectada')
      return <span title="Detectada na fatura"><CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" /></span>
    if (status === 'valor_divergente')
      return <span title="Detectada com valor diferente"><AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" /></span>
    if (status === 'nao_encontrada')
      return <span title="Não encontrada neste mês"><XCircle className="w-4 h-4 text-gray-300 shrink-0" /></span>
    return <span title="Inativa"><MinusCircle className="w-4 h-4 text-gray-200 shrink-0" /></span>
  }

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
      <div className="bg-white rounded-2xl shadow p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Repeat className="w-5 h-5 text-indigo-600" />
          <span className="font-semibold text-gray-800">Resumo de Assinaturas</span>
        </div>

        {/* Total geral + total pago */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-indigo-50 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-500 mb-0.5">Total ativo/mês</p>
            <p className="text-lg font-bold text-indigo-700">R$ {totalAtivo.toFixed(2)}</p>
            <p className="text-xs text-gray-400">{itensAtivos.length} ativa(s)</p>
          </div>
          <div className="bg-green-50 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-500 mb-0.5">Pago em {mesFmt}</p>
            <p className="text-lg font-bold text-green-700">R$ {detectadasValor.toFixed(2)}</p>
            <p className="text-xs text-gray-400">{detectadasCount}/{itensAtivos.length} identificadas</p>
          </div>
        </div>

        {/* Por responsável — apenas Matheus e Jeniffer */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-50 rounded-xl p-2.5 text-center">
            <p className="text-[10px] text-gray-400 mb-0.5">Matheus</p>
            <p className="text-sm font-bold text-gray-700">R$ {totalMatheus.toFixed(2)}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-2.5 text-center">
            <p className="text-[10px] text-gray-400 mb-0.5">Jeniffer</p>
            <p className="text-sm font-bold text-gray-700">R$ {totalJeniffer.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Botão verificar na fatura */}
      {isOnline && (
        <button
          onClick={verificarNaFatura}
          disabled={verificando}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition active:scale-[0.98] disabled:opacity-60"
        >
          <Search className={`w-4 h-4 ${verificando ? 'animate-pulse' : ''}`} />
          {verificando ? 'Verificando na fatura…' : `Verificar cobranças de ${mesFmt} na fatura`}
        </button>
      )}

      {/* Filtros */}
      <div className="space-y-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {([{ value: 'todos', label: 'Todos cartões' }] as { value: string; label: string }[])
            .concat(CARTOES_KEYS.map(k => ({ value: k, label: cartaoLabels[k] })))
            .map(c => (
              <button
                key={c.value}
                onClick={() => setFiltroCartao(c.value)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition ${
                  filtroCartao === c.value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-600 border border-gray-200'
                }`}
              >
                {c.label}
              </button>
            ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[{ value: 'todos', label: 'Todos' }, ...RESPONSAVEIS.filter(r => r !== 'Compartilhado').map(r => ({ value: r, label: r }))].map(r => (
            <button
              key={r.value}
              onClick={() => setFiltroResponsavel(r.value)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition ${
                filtroResponsavel === r.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-gray-600 border border-gray-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legenda */}
      <div className="flex items-center gap-3 bg-white rounded-xl shadow px-3 py-2 flex-wrap text-xs text-gray-500">
        <span className="text-gray-400">Fatura:</span>
        <span className="flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> Detectada
        </span>
        <span className="flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Valor diferente
        </span>
        <span className="flex items-center gap-1">
          <XCircle className="w-3.5 h-3.5 text-gray-300" /> Não encontrada
        </span>
      </div>

      {/* Lista por cartão */}
      {CARTOES_KEYS.map(key => {
        const grupo = itensPorCartao[key] || []
        if (grupo.length === 0) return null
        const totalGrupoAtivo = grupo.filter(i => i.ativa).reduce((acc, i) => acc + i.valor, 0)

        return (
          <div key={key} className="bg-white rounded-2xl shadow overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-gray-500" />
                <span className="font-semibold text-sm text-gray-700">{cartaoLabels[key]}</span>
              </div>
              <span className="text-sm font-bold text-indigo-700">
                R$ {totalGrupoAtivo.toFixed(2)}
                <span className="text-xs font-normal text-gray-400">/mês</span>
              </span>
            </div>

            <div className="divide-y divide-gray-50">
              {grupo.map(item => {
                const status = statusTransacao(item)
                return (
                  <div
                    key={item.id}
                    className={`px-4 py-3 flex items-center gap-3 ${!item.ativa ? 'opacity-50' : ''}`}
                  >
                    <StatusBadge status={status} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className={`text-sm font-medium truncate ${
                          item.ativa ? 'text-gray-800' : 'text-gray-400 line-through'
                        }`}>
                          {item.nome}
                        </p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 shrink-0">
                          {item.categoria}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        {item.responsavel}
                        {item.dia_cobranca ? ` · dia ${item.dia_cobranca}` : ''}
                        {item.observacao ? ` · ${item.observacao}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold ${item.ativa ? 'text-indigo-700' : 'text-gray-400'}`}>
                        R$ {item.valor.toFixed(2)}
                      </p>
                    </div>
                    {isOnline && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => toggleAtiva(item)}
                          title={item.ativa ? 'Desativar' : 'Ativar'}
                          className={`p-1.5 rounded-lg transition ${
                            item.ativa
                              ? 'text-gray-400 hover:bg-gray-50'
                              : 'text-green-600 hover:bg-green-50'
                          }`}
                        >
                          {item.ativa
                            ? <MinusCircle className="w-4 h-4" />
                            : <CheckCircle2 className="w-4 h-4" />
                          }
                        </button>
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
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {itensFiltrados.length === 0 && (
        <div className="bg-white rounded-2xl shadow py-12 flex flex-col items-center gap-2 text-gray-300">
          <Repeat className="w-10 h-10" />
          <p className="text-sm">Nenhuma assinatura cadastrada</p>
        </div>
      )}

      {!isOnline && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 flex items-center gap-2">
          <WifiOff className="w-4 h-4 text-blue-600 shrink-0" />
          <p className="text-sm text-blue-700 font-medium">Você está offline — edição desabilitada</p>
        </div>
      )}

      {isOnline && (
        <button
          onClick={() => setModalAberto('adicionar')}
          className="w-full bg-indigo-600 text-white py-3 rounded-2xl font-semibold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all active:scale-[0.97] shadow-sm"
        >
          <Plus className="w-5 h-5" />
          Adicionar assinatura
        </button>
      )}

      {/* Modal: adicionar / editar */}
      {(modalAberto === 'adicionar' || modalAberto === 'editar') && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold">
                {modalAberto === 'adicionar' ? 'Nova Assinatura' : 'Editar Assinatura'}
              </h3>
              <button onClick={fecharModal} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Nome do serviço</label>
                <input
                  type="text"
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="Ex: Netflix, Spotify…"
                  value={formData.nome}
                  onChange={e => setFormData(f => ({ ...f, nome: e.target.value }))}
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Valor mensal (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="w-full border border-gray-200 rounded-xl p-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="0,00"
                  value={formData.valor}
                  onChange={e => setFormData(f => ({ ...f, valor: numericOnly(e.target.value) }))}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Cartão</label>
                <select
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                  value={formData.cartao}
                  onChange={e => setFormData(f => ({ ...f, cartao: e.target.value }))}
                >
                  {CARTOES_KEYS.map(k => (
                    <option key={k} value={k}>{cartaoLabels[k]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Responsável</label>
                <select
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                  value={formData.responsavel}
                  onChange={e => setFormData(f => ({ ...f, responsavel: e.target.value }))}
                >
                  {RESPONSAVEIS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Categoria</label>
                <select
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                  value={formData.categoria}
                  onChange={e => setFormData(f => ({ ...f, categoria: e.target.value }))}
                >
                  {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  Dia de cobrança
                  <span className="ml-1 text-gray-400 font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="Ex: 15"
                  value={formData.dia_cobranca}
                  onChange={e => setFormData(f => ({ ...f, dia_cobranca: e.target.value.replace(/\D/g, '') }))}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  Observação
                  <span className="ml-1 text-gray-400 font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  className="w-full border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="Ex: Plano família, conta compartilhada…"
                  value={formData.observacao}
                  onChange={e => setFormData(f => ({ ...f, observacao: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={fecharModal} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600">
                Cancelar
              </button>
              <button onClick={salvar} className="flex-1 py-3 rounded-xl bg-indigo-600 text-white font-semibold">
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
            <h3 className="text-lg font-bold mb-2">Excluir assinatura</h3>
            <p className="text-sm text-gray-500 mb-6">
              Tem certeza que deseja excluir{' '}
              <span className="font-semibold text-gray-800">"{itemSelecionado.nome}"</span>?
            </p>
            <div className="flex gap-3">
              <button onClick={fecharModal} className="flex-1 py-3 rounded-xl bg-gray-100 font-medium text-gray-600">
                Cancelar
              </button>
              <button onClick={excluir} className="flex-1 py-3 rounded-xl bg-red-500 text-white font-semibold">
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
