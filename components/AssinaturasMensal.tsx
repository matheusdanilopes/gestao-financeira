'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, addMonths, endOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useGlobalSync } from '@/lib/useGlobalSync'
import {
  Repeat, Plus, X, WifiOff,
  CheckCircle2, AlertTriangle, XCircle, MinusCircle,
  CreditCard, Search, SlidersHorizontal, History,
} from 'lucide-react'
import { SwipeableItem } from '@/components/SwipeableItem'
import { log, numericOnly, formatBRL } from '@/lib/logger'
import { CATEGORIAS_PADRAO, parseCategoriasConfig } from '@/lib/categorias'

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

interface HistoricoValor {
  id: string
  assinatura_id: string
  valor: number
  vigente_desde: string
  criado_em: string
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
  const [historico, setHistorico] = useState<HistoricoValor[]>([])
  const [cartaoLabels, setCartaoLabels] = useState<CartaoLabels>(CARTAO_LABELS_DEFAULT)
  const [verificando, setVerificando] = useState(false)

  // Categorias carregadas do conjunto centralizado (configuracoes.categorias_compras)
  const [categoriasDisponiveis, setCategoriasDisponiveis] = useState<string[]>(CATEGORIAS_PADRAO)
  useEffect(() => {
    fetch('/api/configuracoes')
      .then(r => r.json())
      .then(data => {
        const valor = (data.configuracoes ?? []).find(
          (c: { chave: string }) => c.chave === 'categorias_compras',
        )?.valor
        if (valor) setCategoriasDisponiveis(parseCategoriasConfig(valor))
      })
      .catch(() => {}) // mantém CATEGORIAS_PADRAO como fallback
  }, [])

  const [modalAberto, setModalAberto] = useState<'adicionar' | 'editar' | 'excluir' | null>(null)
  const [itemSelecionado, setItemSelecionado] = useState<Assinatura | null>(null)
  const [formData, setFormData] = useState(FORM_VAZIO)

  const [filtroCartao, setFiltroCartao] = useState('todos')
  const [filtroResponsavel, setFiltroResponsavel] = useState('')
  const [filtroDescricao, setFiltroDescricao] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todas')
  const [filtroFatura, setFiltroFatura] = useState('todas')
  const [dropdownFiltro, setDropdownFiltro] = useState(false)

  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'erro' } | null>(null)

  // nextMesRefStr = mês+1, usado como projeto_fatura (regra do sistema)
  const mesRefStr = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')
  const nextMesRefStr = format(startOfMonth(addMonths(mesSelecionado, 1)), 'yyyy-MM-dd')
  const mesFmt = format(mesSelecionado, 'MMMM', { locale: ptBR })

  const fetcher = useCallback(async () => {
    const [{ data: assinaturasData }, { data: transacoesData }, { data: planejamentoData }, { data: historicoData }] = await Promise.all([
      supabase.from('assinaturas').select('*').order('nome', { ascending: true }),
      supabase
        .from('transacoes_nubank')
        .select('descricao, valor, cartao, projeto_fatura')
        .eq('projeto_fatura', nextMesRefStr),
      supabase.from('planejamento').select('item').eq('mes_referencia', mesRefStr),
      supabase.from('assinaturas_historico').select('*').order('vigente_desde', { ascending: true }),
    ])
    const c1 = (planejamentoData || []).find(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO1]'))?.item?.replace('[CARTAO1]', '').trim()
    const c2 = (planejamentoData || []).find(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO2]'))?.item?.replace('[CARTAO2]', '').trim()
    return {
      assinaturas: assinaturasData || [],
      transacoes: transacoesData || [],
      historico: historicoData || [],
      cartaoLabels: { nubank: 'NuBank', cartao1: c1 || 'Cartão 1', cartao2: c2 || 'Cartão 2' },
    }
  }, [mesRefStr, nextMesRefStr])

  const { isOnline, refetch } = useGlobalSync({
    cacheKey: `assinaturas:${mesRefStr}`,
    tables: ['assinaturas', 'transacoes_nubank', 'planejamento', 'assinaturas_historico'],
    fetcher,
    onData: (raw) => {
      const d = raw as { assinaturas: Assinatura[]; transacoes: TransacaoSimples[]; historico: HistoricoValor[]; cartaoLabels: CartaoLabels }
      setItens(d.assinaturas)
      setTransacoes(d.transacoes)
      setHistorico(d.historico || [])
      setCartaoLabels(d.cartaoLabels)
    },
  })

  function valorParaMes(assinatura: Assinatura, mes: Date, hist: HistoricoValor[]): number {
    const cutoff = format(endOfMonth(mes), 'yyyy-MM-dd')
    const entry = hist
      .filter(h => h.assinatura_id === assinatura.id && h.vigente_desde <= cutoff)
      .sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))[0]
    return entry?.valor ?? assinatura.valor
  }

  function showToast(msg: string, tipo: 'ok' | 'erro' = 'ok') {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3500)
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
    const valorEsperado = valorParaMes(assinatura, mesSelecionado, historico)
    const valorOk = matches.some(tx => Math.abs(tx.valor - valorEsperado) <= 0.05)
    return valorOk ? 'detectada' : 'valor_divergente'
  }

  const filtrosAtivos = (filtroCartao !== 'todos' ? 1 : 0) + (filtroDescricao !== '' ? 1 : 0) + (filtroStatus !== 'todas' ? 1 : 0) + (filtroFatura !== 'todas' ? 1 : 0)

  const itensFiltrados = useMemo(() => {
    return itens.filter(i => {
      if (filtroCartao !== 'todos' && i.cartao !== filtroCartao) return false
      if (filtroResponsavel !== '' && i.responsavel !== filtroResponsavel) return false
      if (filtroDescricao !== '' && !i.nome.toLowerCase().includes(filtroDescricao.toLowerCase())) return false
      if (filtroStatus === 'ativa' && !i.ativa) return false
      if (filtroStatus === 'inativa' && i.ativa) return false
      if (filtroFatura !== 'todas' && statusTransacao(i) !== filtroFatura) return false
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, filtroCartao, filtroResponsavel, filtroDescricao, filtroStatus, filtroFatura, transacoes])

  const itensAtivos = useMemo(() => itens.filter(i => i.ativa), [itens])

  const totalAtivo = useMemo(
    () => itensAtivos.reduce((acc, i) => acc + valorParaMes(i, mesSelecionado, historico), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itensAtivos, mesSelecionado, historico]
  )

  const totalMatheus = useMemo(
    () => itensAtivos.filter(i => i.responsavel === 'Matheus').reduce((acc, i) => acc + valorParaMes(i, mesSelecionado, historico), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itensAtivos, mesSelecionado, historico]
  )
  const totalJeniffer = useMemo(
    () => itensAtivos.filter(i => i.responsavel === 'Jeniffer').reduce((acc, i) => acc + valorParaMes(i, mesSelecionado, historico), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itensAtivos, mesSelecionado, historico]
  )

  const countPorResponsavel = useMemo(() => ({
    '': itensAtivos.length,
    Matheus: itensAtivos.filter(i => i.responsavel === 'Matheus').length,
    Jeniffer: itensAtivos.filter(i => i.responsavel === 'Jeniffer').length,
  }), [itensAtivos])

  const detectadasCount = useMemo(
    () => itensAtivos.filter(i => statusTransacao(i) === 'detectada').length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itensAtivos, transacoes, mesSelecionado, historico]
  )

  const detectadasValor = useMemo(
    () => itensAtivos.filter(i => statusTransacao(i) === 'detectada').reduce((acc, i) => acc + valorParaMes(i, mesSelecionado, historico), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itensAtivos, transacoes, mesSelecionado, historico]
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

    const vigenteDe = format(startOfMonth(mesSelecionado), 'yyyy-MM-dd')
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
      const { data: newItem, error } = await supabase.from('assinaturas').insert([payload]).select().single()
      if (error || !newItem) { showToast('Erro ao adicionar', 'erro'); return }
      await supabase.from('assinaturas_historico').insert([{ assinatura_id: newItem.id, valor, vigente_desde: vigenteDe }])
      log('inserir', 'assinaturas', `Nova assinatura: ${nome} — ${formatBRL(valor)}`, valor)
      showToast('Assinatura adicionada!')
    } else if (itemSelecionado) {
      const valorEfetivoAtual = valorParaMes(itemSelecionado, mesSelecionado, historico)
      const valorMudou = valor !== valorEfetivoAtual

      // Atualização otimista — reflete a mudança imediatamente sem esperar refetch
      setItens(prev => prev.map(i => i.id === itemSelecionado.id ? { ...i, ...payload } : i))
      const entradaExistente = historico.find(
        h => h.assinatura_id === itemSelecionado.id && h.vigente_desde === vigenteDe
      )
      const tempId = `opt-${Date.now()}`
      if (valorMudou) {
        setHistorico(prev => [
          ...prev.filter(h => !(h.assinatura_id === itemSelecionado.id && h.vigente_desde === vigenteDe)),
          { id: tempId, assinatura_id: itemSelecionado.id, valor, vigente_desde: vigenteDe, criado_em: new Date().toISOString() },
        ])
      }

      if (valorMudou) {
        await supabase.from('assinaturas_historico').insert([{ assinatura_id: itemSelecionado.id, valor, vigente_desde: vigenteDe }])
      }
      const { error } = await supabase.from('assinaturas').update(payload).eq('id', itemSelecionado.id)
      if (error) {
        setItens(prev => prev.map(i => i.id === itemSelecionado.id ? itemSelecionado : i))
        if (valorMudou) {
          setHistorico(prev => {
            const sem = prev.filter(h => h.id !== tempId)
            return entradaExistente ? [...sem, entradaExistente] : sem
          })
        }
        showToast('Erro ao salvar', 'erro')
        return
      }
      log('editar', 'assinaturas', `Editada: ${nome} — ${formatBRL(valor)}`, valor)
      showToast('Atualizado!')
    }

    fecharModal()
    refetch()
  }

  async function excluir() {
    if (!itemSelecionado) return
    const removed = itemSelecionado
    setItens(prev => prev.filter(i => i.id !== removed.id))
    fecharModal()
    const { error } = await supabase.from('assinaturas').delete().eq('id', removed.id)
    if (!error) {
      log('excluir', 'assinaturas', `Excluída: ${removed.nome}`, removed.valor)
      showToast('Excluída')
      refetch()
    } else {
      setItens(prev => [...prev, removed].sort((a, b) => a.nome.localeCompare(b.nome)))
      showToast('Erro ao excluir', 'erro')
    }
  }

  async function toggleAtiva(item: Assinatura) {
    setItens(prev => prev.map(i => i.id === item.id ? { ...i, ativa: !i.ativa } : i))
    const { error } = await supabase.from('assinaturas').update({ ativa: !item.ativa }).eq('id', item.id)
    if (!error) {
      log('editar', 'assinaturas', `${item.ativa ? 'Desativada' : 'Ativada'}: ${item.nome}`)
    } else {
      setItens(prev => prev.map(i => i.id === item.id ? { ...i, ativa: item.ativa } : i))
      showToast('Erro ao atualizar assinatura', 'erro')
    }
  }

  function abrirEditar(item: Assinatura) {
    setItemSelecionado(item)
    setFormData({
      nome: item.nome,
      valor: String(valorParaMes(item, mesSelecionado, historico)),
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
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[300] px-4 py-2 rounded-xl text-sm font-medium shadow-lg ${
          toast.tipo === 'ok' ? 'bg-green-600 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Resumo: Total ativo/mês + Pago em mês */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl shadow p-3 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <Repeat className="w-4 h-4 text-indigo-500" />
            <p className="text-xs text-gray-500">Total ativo/mês</p>
          </div>
          <p className="text-lg font-bold text-indigo-700">R$ {totalAtivo.toFixed(2)}</p>
          <p className="text-xs text-gray-400">{itensAtivos.length} ativa(s)</p>
        </div>
        <div className="bg-white rounded-2xl shadow p-3 text-center">
          <p className="text-xs text-gray-500 mb-1">Pago em {mesFmt}</p>
          <p className="text-lg font-bold text-green-700">R$ {detectadasValor.toFixed(2)}</p>
          <p className="text-xs text-gray-400">{detectadasCount}/{itensAtivos.length} identificadas</p>
        </div>
      </div>

      {/* Cards interativos de responsável */}
      <div className="grid grid-cols-3 gap-1.5">
        <button
          onClick={() => setFiltroResponsavel('')}
          className={`rounded-xl px-2 py-2 text-center transition-all duration-200 active:scale-[0.97] border ${
            filtroResponsavel === ''
              ? 'bg-primary-50 border-primary-200'
              : 'bg-white border-gray-100'
          }`}
        >
          <p className={`text-[11px] font-medium mb-0.5 ${filtroResponsavel === '' ? 'text-primary-500' : 'text-gray-400'}`}>Total</p>
          <p className={`text-xs font-bold num leading-tight ${filtroResponsavel === '' ? 'text-primary-700' : 'text-gray-700'}`}>{formatBRL(totalAtivo)}</p>
          <p className={`text-[9px] mt-0.5 ${filtroResponsavel === '' ? 'text-primary-400' : 'text-gray-400'}`}>{countPorResponsavel['']} ativa(s)</p>
        </button>
        <button
          onClick={() => setFiltroResponsavel(filtroResponsavel === 'Matheus' ? '' : 'Matheus')}
          className={`rounded-xl px-2 py-2 text-center transition-all duration-200 active:scale-[0.97] border ${
            filtroResponsavel === 'Matheus'
              ? 'bg-blue-50 border-blue-200'
              : 'bg-white border-gray-100'
          }`}
        >
          <p className={`text-[11px] font-medium mb-0.5 ${filtroResponsavel === 'Matheus' ? 'text-blue-500' : 'text-gray-400'}`}>Matheus</p>
          <p className={`text-xs font-bold num leading-tight ${filtroResponsavel === 'Matheus' ? 'text-blue-700' : 'text-gray-700'}`}>{formatBRL(totalMatheus)}</p>
          <p className={`text-[9px] mt-0.5 ${filtroResponsavel === 'Matheus' ? 'text-blue-400' : 'text-gray-400'}`}>{countPorResponsavel.Matheus} ativa(s)</p>
        </button>
        <button
          onClick={() => setFiltroResponsavel(filtroResponsavel === 'Jeniffer' ? '' : 'Jeniffer')}
          className={`rounded-xl px-2 py-2 text-center transition-all duration-200 active:scale-[0.97] border ${
            filtroResponsavel === 'Jeniffer'
              ? 'bg-pink-50 border-pink-200'
              : 'bg-white border-gray-100'
          }`}
        >
          <p className={`text-[11px] font-medium mb-0.5 ${filtroResponsavel === 'Jeniffer' ? 'text-pink-500' : 'text-gray-400'}`}>Jeniffer</p>
          <p className={`text-xs font-bold num leading-tight ${filtroResponsavel === 'Jeniffer' ? 'text-pink-600' : 'text-gray-700'}`}>{formatBRL(totalJeniffer)}</p>
          <p className={`text-[9px] mt-0.5 ${filtroResponsavel === 'Jeniffer' ? 'text-pink-400' : 'text-gray-400'}`}>{countPorResponsavel.Jeniffer} ativa(s)</p>
        </button>
      </div>

      {/* Linha de ação: Verificar + Filtrar */}
      <div className="flex gap-2">
        {isOnline && (
          <button
            onClick={verificarNaFatura}
            disabled={verificando}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition active:scale-[0.98] disabled:opacity-60"
          >
            <Search className={`w-4 h-4 ${verificando ? 'animate-pulse' : ''}`} />
            {verificando ? 'Verificando…' : 'Verificar cobranças'}
          </button>
        )}
        <button
          onClick={() => setDropdownFiltro(d => !d)}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-2xl border text-sm font-medium transition active:scale-[0.98] ${
            filtrosAtivos > 0
              ? 'border-indigo-400 bg-indigo-600 text-white'
              : 'border-gray-200 bg-white text-gray-600'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filtrar
          {filtrosAtivos > 0 && (
            <span className="ml-0.5 bg-white text-indigo-600 rounded-full w-4 h-4 text-[10px] font-bold flex items-center justify-center">{filtrosAtivos}</span>
          )}
        </button>
      </div>

      {/* Dropdown de filtro */}
      {dropdownFiltro && (
        <div className="bg-white rounded-2xl shadow border border-gray-100 p-3 space-y-2">
          <input
            type="text"
            className="bg-gray-50 border border-transparent rounded-xl p-2.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-shadow"
            placeholder="Buscar por nome…"
            value={filtroDescricao}
            onChange={e => setFiltroDescricao(e.target.value)}
          />
          <select
            className="bg-gray-50 border border-transparent rounded-xl p-2.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-shadow"
            value={filtroCartao}
            onChange={e => setFiltroCartao(e.target.value)}
          >
            <option value="todos">Cartão (todos)</option>
            {CARTOES_KEYS.map(k => (
              <option key={k} value={k}>{cartaoLabels[k]}</option>
            ))}
          </select>
          <select
            className="bg-gray-50 border border-transparent rounded-xl p-2.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-shadow"
            value={filtroStatus}
            onChange={e => setFiltroStatus(e.target.value)}
          >
            <option value="todas">Status (todas)</option>
            <option value="ativa">Ativas</option>
            <option value="inativa">Inativas</option>
          </select>
          <select
            className="bg-gray-50 border border-transparent rounded-xl p-2.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-shadow"
            value={filtroFatura}
            onChange={e => setFiltroFatura(e.target.value)}
          >
            <option value="todas">Fatura (todas)</option>
            <option value="detectada">✓ Detectada</option>
            <option value="valor_divergente">⚠ Valor diferente</option>
            <option value="nao_encontrada">✗ Não encontrada</option>
            <option value="inativa">— Inativa</option>
          </select>
          {filtrosAtivos > 0 && (
            <button
              onClick={() => { setFiltroCartao('todos'); setFiltroDescricao(''); setFiltroStatus('todas'); setFiltroFatura('todas') }}
              className="w-full text-xs text-red-500 hover:text-red-700 py-1 font-semibold transition-colors"
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}

      {/* Lista por cartão */}
      {CARTOES_KEYS.map(key => {
        const grupo = itensPorCartao[key] || []
        if (grupo.length === 0) return null
        const totalGrupoAtivo = grupo.filter(i => i.ativa).reduce((acc, i) => acc + valorParaMes(i, mesSelecionado, historico), 0)

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
                  <SwipeableItem
                    key={item.id}
                    onDelete={() => { setItemSelecionado(item); setModalAberto('excluir') }}
                    disabled={!isOnline}
                  >
                    <div
                      className={`px-4 py-3 flex items-center gap-3 ${!item.ativa ? 'opacity-50' : ''} ${isOnline ? 'cursor-pointer active:bg-gray-50 hover:bg-gray-50/50' : ''}`}
                      onClick={() => { if (isOnline) abrirEditar(item) }}
                      role={isOnline ? 'button' : undefined}
                      tabIndex={isOnline ? 0 : undefined}
                      onKeyDown={isOnline ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirEditar(item) } } : undefined}
                      aria-label={isOnline ? `Editar ${item.nome}` : undefined}
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
                          R$ {valorParaMes(item, mesSelecionado, historico).toFixed(2)}
                        </p>
                      </div>
                      {isOnline && (
                        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
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
                        </div>
                      )}
                    </div>
                  </SwipeableItem>
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
        <ModalPortal>
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold">
                {modalAberto === 'adicionar' ? 'Nova Assinatura' : 'Editar Assinatura'}
              </h3>
              <button onClick={fecharModal} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalAberto === 'editar' && (
              <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                Novo valor será aplicado apenas para cobranças futuras. Registros históricos permanecem inalterados.
              </div>
            )}

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
                  {/* Garante que categoria existente (mesmo legada) sempre aparece */}
                  {!categoriasDisponiveis.includes(formData.categoria) && formData.categoria && (
                    <option value={formData.categoria}>{formData.categoria}</option>
                  )}
                  {categoriasDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
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

            {modalAberto === 'editar' && itemSelecionado && (() => {
              const entradasHistorico = historico
                .filter(h => h.assinatura_id === itemSelecionado.id)
                .sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))
              if (entradasHistorico.length <= 1) return null
              return (
                <details className="mt-4">
                  <summary className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                    <History className="w-3.5 h-3.5" />
                    Histórico de valores ({entradasHistorico.length})
                  </summary>
                  <ul className="mt-2 space-y-1 pl-1">
                    {entradasHistorico.map((h, idx) => (
                      <li key={h.id} className="flex justify-between text-xs text-gray-500">
                        <span>{format(new Date(h.vigente_desde + 'T12:00:00'), "dd/MM/yyyy")}</span>
                        <span className={`font-medium ${idx === 0 ? 'text-indigo-600' : 'text-gray-400'}`}>
                          {idx === 0 && <span className="mr-1 text-[10px] text-indigo-400">atual</span>}
                          R$ {Number(h.valor).toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )
            })()}

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
        </ModalPortal>
      )}

      {/* Modal: excluir */}
      {modalAberto === 'excluir' && itemSelecionado && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[200] p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold mb-2">Excluir assinatura</h3>
            <p className="text-sm text-gray-500 mb-6">
              Tem certeza que deseja excluir{' '}
              <span className="font-semibold text-gray-800">&quot;{itemSelecionado.nome}&quot;</span>?
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
        </ModalPortal>
      )}
    </div>
  )
}
