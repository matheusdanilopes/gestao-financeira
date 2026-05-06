'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, startOfMonth, addMonths, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { supabase } from '@/lib/supabaseClient'
import { descricaoFechamento, calcularDataFechamentoDaFaturaISO } from '@/lib/fatura'
import {
  Settings, LogOut, Upload, Activity, ChevronDown, Sun, Moon, Monitor,
  Tags, Plus, Pencil, Trash2, Check, CreditCard, CalendarDays, X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTheme } from '@/components/ThemeProvider'
import { CATEGORIAS_PADRAO, normalizarCategorias, parseCategoriasConfig } from '@/lib/categorias'

interface LogEntry {
  id: string
  acao: string
  tabela: string
  descricao: string
  valor: number | null
  valor_anterior: number | null
  usuario: string | null
  created_at: string
}

interface FaturaRegistrada {
  id: string
  cartao: string
  mes_referencia: string
  data_fechamento: string
}

interface FaturaExibida {
  mesReferencia: string          // 'yyyy-MM-dd'
  mesLabel: string               // 'Março 2024'
  dataFechamentoCalculada: string // 'yyyy-MM-dd'
  dataFechamentoRegistrada: string | null
  registrada: boolean
}

const ACAO_CONFIG: Record<string, { label: string; color: string }> = {
  inserir: { label: 'Inserção', color: 'bg-green-100 text-green-700' },
  editar: { label: 'Edição', color: 'bg-blue-100 text-blue-700' },
  excluir: { label: 'Exclusão', color: 'bg-red-100 text-red-600' },
  pagar: { label: 'Pagamento', color: 'bg-emerald-100 text-emerald-700' },
  receber: { label: 'Recebimento', color: 'bg-teal-100 text-teal-700' },
  aporte: { label: 'Aporte', color: 'bg-violet-100 text-violet-700' },
  importar: { label: 'Importação', color: 'bg-amber-100 text-amber-700' },
}

const CARTAO_LABELS: Record<string, string> = {
  nubank: 'NuBank',
  cartao1: 'Cartão 1',
  cartao2: 'Cartão 2',
}

const PAGE_SIZE = 20

type AbaConfiguracoes = 'geral' | 'faturas' | 'atividades' | 'categorias'
type CartaoFaturas = 'nubank' | 'cartao1' | 'cartao2'

export default function ConfiguracoesPage() {
  const [abaAtual, setAbaAtual] = useState<AbaConfiguracoes>('geral')

  // --- Geral ---
  const [cartaoExpandido, setCartaoExpandido] = useState<'nubank' | 'cartao1' | 'cartao2' | null>('nubank')
  const [diaVencimento, setDiaVencimento] = useState(10)
  const [ajusteFechamento, setAjusteFechamento] = useState(0)
  const [diaVencimentoC1, setDiaVencimentoC1] = useState(10)
  const [ajusteFechamentoC1, setAjusteFechamentoC1] = useState(0)
  const [diaVencimentoC2, setDiaVencimentoC2] = useState(10)
  const [ajusteFechamentoC2, setAjusteFechamentoC2] = useState(0)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')

  // --- Faturas ---
  const [cartaoFaturas, setCartaoFaturas] = useState<CartaoFaturas>('nubank')
  const [faturasRegistradas, setFaturasRegistradas] = useState<FaturaRegistrada[]>([])
  const [faturasCarregando, setFaturasCarregando] = useState(false)
  const [editandoFatura, setEditandoFatura] = useState<string | null>(null) // mesReferencia
  const [novaDataFechamento, setNovaDataFechamento] = useState('')
  const [salvandoFatura, setSalvandoFatura] = useState(false)
  const [cartaoLabels, setCartaoLabels] = useState(CARTAO_LABELS)

  // --- Atividades ---
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logsTotal, setLogsTotal] = useState(0)
  const [logsPage, setLogsPage] = useState(0)
  const [logsCarregando, setLogsCarregando] = useState(false)
  const [filtroAcao, setFiltroAcao] = useState('')
  const [filtroTabela, setFiltroTabela] = useState('')
  const [filtroBusca, setFiltroBusca] = useState('')

  // --- Categorias ---
  const [categorias, setCategorias] = useState<string[]>(CATEGORIAS_PADRAO)
  const [categoriasUso, setCategoriasUso] = useState<Record<string, number>>({})
  const [novaCategoria, setNovaCategoria] = useState('')
  const [editandoCategoria, setEditandoCategoria] = useState<string | null>(null)
  const [novoNomeCategoria, setNovoNomeCategoria] = useState('')
  const [categoriasSalvando, setCategoriasSalvando] = useState(false)

  const router = useRouter()
  const { theme, setTheme } = useTheme()

  // ---- Helpers ----

  function diaVencimentoPara(cartao: CartaoFaturas): number {
    if (cartao === 'cartao1') return diaVencimentoC1
    if (cartao === 'cartao2') return diaVencimentoC2
    return diaVencimento
  }

  function ajustePara(cartao: CartaoFaturas): number {
    if (cartao === 'cartao1') return ajusteFechamentoC1
    if (cartao === 'cartao2') return ajusteFechamentoC2
    return ajusteFechamento
  }

  // Gera a lista de meses a exibir na aba Faturas (12 meses atrás até 2 à frente)
  const mesesExibidos = useMemo<FaturaExibida[]>(() => {
    const hoje = new Date()
    const inicio = subMonths(startOfMonth(hoje), 12)
    const fim = addMonths(startOfMonth(hoje), 2)

    const lista: FaturaExibida[] = []
    let cursor = inicio
    while (cursor <= fim) {
      const mesIso = format(cursor, 'yyyy-MM-dd')
      const calculada = calcularDataFechamentoDaFaturaISO(cursor, diaVencimentoPara(cartaoFaturas), ajustePara(cartaoFaturas))
      const registrada = faturasRegistradas.find(
        f => f.cartao === cartaoFaturas && f.mes_referencia === mesIso
      )
      lista.push({
        mesReferencia: mesIso,
        mesLabel: format(cursor, 'MMMM yyyy', { locale: ptBR }),
        dataFechamentoCalculada: calculada,
        dataFechamentoRegistrada: registrada?.data_fechamento ?? null,
        registrada: !!registrada,
      })
      cursor = addMonths(cursor, 1)
    }
    return lista.reverse() // mais recente primeiro
  }, [cartaoFaturas, faturasRegistradas, diaVencimento, ajusteFechamento, diaVencimentoC1, ajusteFechamentoC1, diaVencimentoC2, ajusteFechamentoC2])

  // ---- Loaders ----

  async function carregarConfigs() {
    const res = await fetch('/api/configuracoes')
    const data = await res.json()
    const configs: Array<{ chave: string; valor: string }> = data.configuracoes ?? []

    const get = (chave: string, fallback: string) =>
      configs.find(c => c.chave === chave)?.valor ?? fallback

    setDiaVencimento(parseInt(get('dia_vencimento', '10')))
    setAjusteFechamento(parseInt(get('ajuste_fechamento', '0')))
    setDiaVencimentoC1(parseInt(get('dia_vencimento_cartao1', '10')))
    setAjusteFechamentoC1(parseInt(get('ajuste_fechamento_cartao1', '0')))
    setDiaVencimentoC2(parseInt(get('dia_vencimento_cartao2', '10')))
    setAjusteFechamentoC2(parseInt(get('ajuste_fechamento_cartao2', '0')))
    setCategorias(parseCategoriasConfig(get('categorias_compras', '')))
  }

  async function carregarFaturas() {
    setFaturasCarregando(true)
    const res = await fetch('/api/faturas')
    const data = await res.json()
    setFaturasRegistradas(data.faturas ?? [])
    setFaturasCarregando(false)
  }

  async function carregarLabelsCartao() {
    const mesRef = format(startOfMonth(new Date()), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('planejamento')
      .select('item')
      .eq('mes_referencia', mesRef)

    const c1 = (data || []).find(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO1]'))?.item?.replace('[CARTAO1]', '').trim()
    const c2 = (data || []).find(p => typeof p.item === 'string' && p.item.startsWith('[CARTAO2]'))?.item?.replace('[CARTAO2]', '').trim()

    setCartaoLabels({
      nubank: 'NuBank',
      cartao1: c1 || 'Cartão 1',
      cartao2: c2 || 'Cartão 2',
    })
  }

  async function carregarUsoCategorias() {
    const { data } = await supabase
      .from('transacoes_nubank')
      .select('categoria')
      .not('categoria', 'is', null)

    const usage = (data ?? []).reduce<Record<string, number>>((acc, row) => {
      const categoria = row.categoria as string | null
      if (!categoria) return acc
      acc[categoria] = (acc[categoria] ?? 0) + 1
      return acc
    }, {})

    setCategoriasUso(usage)
  }

  async function carregarLogs(page: number) {
    setLogsCarregando(true)
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const { data, count } = await supabase
      .from('activity_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (page === 0) {
      setLogs(data || [])
    } else {
      setLogs(prev => [...prev, ...(data || [])])
    }
    setLogsTotal(count || 0)
    setLogsPage(page)
    setLogsCarregando(false)
  }

  // ---- Savers ----

  async function salvar() {
    setSalvando(true)
    setMensagem('')
    const res = await fetch('/api/configuracoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configuracoes: [
          { chave: 'dia_vencimento',            valor: String(diaVencimento) },
          { chave: 'ajuste_fechamento',          valor: String(ajusteFechamento) },
          { chave: 'dia_vencimento_cartao1',     valor: String(diaVencimentoC1) },
          { chave: 'ajuste_fechamento_cartao1',  valor: String(ajusteFechamentoC1) },
          { chave: 'dia_vencimento_cartao2',     valor: String(diaVencimentoC2) },
          { chave: 'ajuste_fechamento_cartao2',  valor: String(ajusteFechamentoC2) },
        ],
      }),
    })
    const data = await res.json()
    if (data.ok) {
      setMensagem('Configurações salvas com sucesso!')
      setTimeout(() => setMensagem(''), 3000)
    } else {
      setMensagem('Erro ao salvar: ' + (data.error || 'desconhecido'))
    }
    setSalvando(false)
  }

  async function registrarFechamento(mesReferencia: string, dataFechamento: string) {
    setSalvandoFatura(true)
    const res = await fetch('/api/faturas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cartao: cartaoFaturas, mes_referencia: mesReferencia, data_fechamento: dataFechamento }),
    })
    const data = await res.json()
    if (data.ok) {
      await carregarFaturas()
      setEditandoFatura(null)
      setNovaDataFechamento('')
    } else {
      setMensagem('Erro: ' + (data.error || 'desconhecido'))
    }
    setSalvandoFatura(false)
  }

  async function removerFechamento(mesReferencia: string) {
    setSalvandoFatura(true)
    const res = await fetch('/api/faturas', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cartao: cartaoFaturas, mes_referencia: mesReferencia }),
    })
    const data = await res.json()
    if (data.ok) {
      await carregarFaturas()
    } else {
      setMensagem('Erro: ' + (data.error || 'desconhecido'))
    }
    setSalvandoFatura(false)
  }

  async function salvarCategorias(lista: string[]) {
    setCategoriasSalvando(true)
    const categoriasNormalizadas = normalizarCategorias(lista)

    const res = await fetch('/api/configuracoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configuracoes: [{ chave: 'categorias_compras', valor: JSON.stringify(categoriasNormalizadas) }],
      }),
    })
    const data = await res.json()

    if (data.ok) {
      setCategorias(categoriasNormalizadas)
      setMensagem('Categorias atualizadas com sucesso!')
      setTimeout(() => setMensagem(''), 3000)
    } else {
      setMensagem('Erro ao salvar categorias: ' + (data.error || 'desconhecido'))
    }

    setCategoriasSalvando(false)
  }

  async function adicionarCategoria() {
    const nome = novaCategoria.trim()
    if (!nome) return
    if (categorias.includes(nome)) {
      setMensagem('Essa categoria já existe.')
      return
    }
    setNovaCategoria('')
    await salvarCategorias([...categorias, nome])
  }

  async function removerCategoria(categoria: string) {
    const emUso = categoriasUso[categoria] ?? 0
    if (emUso > 0) {
      setMensagem(`A categoria "${categoria}" está em uso em ${emUso} compra(s) e não pode ser removida.`)
      return
    }
    await salvarCategorias(categorias.filter(c => c !== categoria))
  }

  async function confirmarEdicaoCategoria(categoriaAntiga: string) {
    const novoNome = novoNomeCategoria.trim()
    if (!novoNome || novoNome === categoriaAntiga) {
      setEditandoCategoria(null)
      setNovoNomeCategoria('')
      return
    }
    if (categorias.includes(novoNome)) {
      setMensagem('Já existe uma categoria com esse nome.')
      return
    }

    setCategoriasSalvando(true)

    const categoriaEmUso = (categoriasUso[categoriaAntiga] ?? 0) > 0
    if (categoriaEmUso) {
      const { error } = await supabase
        .from('transacoes_nubank')
        .update({ categoria: novoNome })
        .eq('categoria', categoriaAntiga)

      if (error) {
        setMensagem('Erro ao atualizar categoria nas compras: ' + error.message)
        setCategoriasSalvando(false)
        return
      }
    }

    const atualizadas = categorias.map(c => (c === categoriaAntiga ? novoNome : c))

    const res = await fetch('/api/configuracoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configuracoes: [{ chave: 'categorias_compras', valor: JSON.stringify(normalizarCategorias(atualizadas)) }],
      }),
    })
    const data = await res.json()

    if (data.ok) {
      setCategorias(normalizarCategorias(atualizadas))
      if (categoriaEmUso) {
        setCategoriasUso(prev => {
          const qtd = prev[categoriaAntiga] ?? 0
          const novo = { ...prev, [novoNome]: qtd }
          delete novo[categoriaAntiga]
          return novo
        })
      }
      setMensagem('Categoria atualizada com sucesso!')
      setTimeout(() => setMensagem(''), 3000)
      setEditandoCategoria(null)
      setNovoNomeCategoria('')
    } else {
      setMensagem('Erro ao renomear categoria: ' + (data.error || 'desconhecido'))
    }

    setCategoriasSalvando(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const logsFiltrados = useMemo(() => {
    return logs.filter((entry) => (
      (!filtroAcao || entry.acao === filtroAcao) &&
      (!filtroTabela || entry.tabela === filtroTabela) &&
      (!filtroBusca || entry.descricao.toLowerCase().includes(filtroBusca.toLowerCase()))
    ))
  }, [logs, filtroAcao, filtroTabela, filtroBusca])

  const tabelasDisponiveis = useMemo(
    () => Array.from(new Set(logs.map(l => l.tabela))).sort((a, b) => a.localeCompare(b)),
    [logs]
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      carregarConfigs()
      carregarLogs(0)
      carregarUsoCategorias()
      carregarFaturas()
      carregarLabelsCartao()
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  // ---- Helpers de data ----

  function formatarData(iso: string): string {
    const [ano, mes, dia] = iso.split('-')
    return `${dia}/${mes}/${ano}`
  }

  function inputParaISO(input: string): string {
    // input comes as yyyy-MM-dd from <input type="date">
    return input
  }

  // ---- Componente de configuração de cartão (acordeão) ----

  function SecaoCartao({
    titulo,
    diaVenc,
    setDiaVenc,
    ajuste,
    setAjuste,
    expandido,
    onToggle,
  }: {
    titulo: string
    diaVenc: number
    setDiaVenc: (v: number) => void
    ajuste: number
    setAjuste: (v: number) => void
    expandido: boolean
    onToggle: () => void
  }) {
    const diaFechamento = diaVenc - 7 + ajuste
    const resumoFechamento = diaFechamento > 0
      ? `Fecha dia ${diaFechamento}`
      : `Fecha dia ${30 + diaFechamento} (mês ant.)`

    return (
      <div className={`border rounded-2xl overflow-hidden transition-colors ${expandido ? 'border-primary-200' : 'border-gray-200'}`}>
        <button
          type="button"
          onClick={onToggle}
          className={`w-full flex items-center gap-3 px-4 py-4 transition-colors active:scale-[0.99] ${
            expandido ? 'bg-primary-50' : 'bg-white hover:bg-gray-50'
          }`}
        >
          <CreditCard className={`w-5 h-5 shrink-0 ${expandido ? 'text-primary-500' : 'text-gray-400'}`} />
          <div className="flex-1 min-w-0 text-left">
            <span className={`font-semibold text-sm block ${expandido ? 'text-primary-700' : 'text-gray-700'}`}>
              {titulo}
            </span>
            {!expandido && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <span className="text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full leading-tight">
                  Vence dia {diaVenc}
                </span>
                <span className="text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full leading-tight">
                  {resumoFechamento}
                </span>
              </div>
            )}
          </div>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 shrink-0 ${expandido ? 'rotate-180' : ''}`} />
        </button>

        {expandido && (
          <div className="px-4 pb-4 pt-3 space-y-4 border-t border-primary-100">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dia de Vencimento</label>
              <input
                type="number"
                min={1}
                max={31}
                value={diaVenc}
                onChange={(e) => setDiaVenc(Math.max(1, Math.min(31, parseInt(e.target.value) || 1)))}
                className="w-full px-4 py-3 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-primary-400 focus:border-transparent text-lg transition-shadow"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Ajuste Fino do Fechamento</label>
              <div className="flex gap-3">
                {([-1, 0, 1] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAjuste(v)}
                    className={`flex-1 py-2.5 rounded-2xl border-2 font-semibold transition active:scale-[0.97] ${
                      ajuste === v
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {v > 0 ? `+${v}` : v}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-primary-50 border border-primary-100 rounded-2xl p-3">
              <p className="text-xs text-gray-500">Fechamento calculado</p>
              <p className="font-semibold text-primary-700 mt-0.5">{descricaoFechamento(diaVenc, ajuste)}</p>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-24">
      <div className="sticky top-0 bg-gray-50 pt-2 pb-3 z-10">
        <h1 className="text-2xl font-bold mb-0">Configurações</h1>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto gap-2 mb-4 mt-3 pb-0.5 scrollbar-none">
        {([
          { key: 'geral',       label: 'Geral',      icon: Settings },
          { key: 'faturas',     label: 'Faturas',    icon: CreditCard },
          { key: 'atividades',  label: 'Atividades', icon: Activity },
          { key: 'categorias',  label: 'Categorias', icon: Tags },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setAbaAtual(key)}
            className={`shrink-0 px-4 py-2.5 rounded-2xl border text-sm font-semibold flex items-center gap-2 transition active:scale-[0.97] ${
              abaAtual === key
                ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {mensagem && (
        <p className="text-green-600 text-sm text-center font-medium bg-green-50 rounded-lg py-2 mb-3">
          {mensagem}
        </p>
      )}

      {/* ---- ABA GERAL ---- */}
      {abaAtual === 'geral' && (
        <>
          <div className="bg-white rounded-3xl shadow-card p-4 mb-4">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5 text-gray-500" />
              Ciclos de Fatura por Cartão
            </h2>

            <div className="space-y-3">
              <SecaoCartao
                titulo="NuBank"
                diaVenc={diaVencimento}
                setDiaVenc={setDiaVencimento}
                ajuste={ajusteFechamento}
                setAjuste={setAjusteFechamento}
                expandido={cartaoExpandido === 'nubank'}
                onToggle={() => setCartaoExpandido(p => p === 'nubank' ? null : 'nubank')}
              />
              <SecaoCartao
                titulo={cartaoLabels.cartao1}
                diaVenc={diaVencimentoC1}
                setDiaVenc={setDiaVencimentoC1}
                ajuste={ajusteFechamentoC1}
                setAjuste={setAjusteFechamentoC1}
                expandido={cartaoExpandido === 'cartao1'}
                onToggle={() => setCartaoExpandido(p => p === 'cartao1' ? null : 'cartao1')}
              />
              <SecaoCartao
                titulo={cartaoLabels.cartao2}
                diaVenc={diaVencimentoC2}
                setDiaVenc={setDiaVencimentoC2}
                ajuste={ajusteFechamentoC2}
                setAjuste={setAjusteFechamentoC2}
                expandido={cartaoExpandido === 'cartao2'}
                onToggle={() => setCartaoExpandido(p => p === 'cartao2' ? null : 'cartao2')}
              />

              <button
                onClick={salvar}
                disabled={salvando}
                className="w-full bg-primary-600 text-white py-3 rounded-2xl font-semibold hover:bg-primary-700 transition-all active:scale-[0.97] disabled:opacity-50 shadow-sm"
              >
                {salvando ? 'Salvando...' : 'Salvar Configurações'}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-card p-4 mb-4">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Upload className="w-5 h-5 text-gray-500" />
              Importar Dados
            </h2>
            <Link
              href="/importar"
              className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white py-3 rounded-2xl font-semibold hover:bg-primary-700 transition-all active:scale-[0.97] shadow-sm"
            >
              <Upload className="w-4 h-4" />
              Ir para Importação
            </Link>
          </div>

          <div className="bg-white rounded-3xl shadow-card p-4 mb-4">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Sun className="w-5 h-5 text-gray-500" />
              Tema
            </h2>
            <div className="flex gap-3">
              {([
                { value: 'light', label: 'Claro', Icon: Sun },
                { value: 'dark', label: 'Escuro', Icon: Moon },
                { value: 'system', label: 'Sistema', Icon: Monitor },
              ] as const).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-2xl border-2 font-semibold text-sm transition active:scale-[0.97] ${
                    theme === value
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-card p-4 mb-4">
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 py-3 text-red-600 font-semibold hover:bg-red-50 rounded-xl transition"
            >
              <LogOut className="w-5 h-5" />
              Sair da conta
            </button>
          </div>
        </>
      )}

      {/* ---- ABA FATURAS ---- */}
      {abaAtual === 'faturas' && (
        <div className="space-y-4">
          <div className="bg-white rounded-3xl shadow-card p-4">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-gray-500" />
              Datas de Fechamento
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Registre a data real de fechamento de cada fatura. Datas calculadas (em cinza) são estimativas com base no dia de vencimento configurado.
            </p>

            {/* Seletor de cartão */}
            <div className="flex gap-2 mb-4">
              {(['nubank', 'cartao1', 'cartao2'] as CartaoFaturas[]).map(c => (
                <button
                  key={c}
                  onClick={() => setCartaoFaturas(c)}
                  className={`flex-1 py-2 rounded-2xl border text-xs font-semibold transition active:scale-[0.97] ${
                    cartaoFaturas === c
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {cartaoLabels[c]}
                </button>
              ))}
            </div>

            {faturasCarregando ? (
              <p className="text-sm text-gray-400 text-center py-6">Carregando...</p>
            ) : (
              <div className="space-y-2">
                {mesesExibidos.map((f) => {
                  const emEdicao = editandoFatura === f.mesReferencia
                  const dataExibida = f.dataFechamentoRegistrada ?? f.dataFechamentoCalculada
                  const isRegistrada = f.registrada

                  return (
                    <div
                      key={f.mesReferencia}
                      className={`border rounded-2xl p-3 ${emEdicao ? 'border-primary-300 bg-primary-50' : 'border-gray-200'}`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 capitalize">{f.mesLabel}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <CalendarDays className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            {emEdicao ? (
                              <input
                                type="date"
                                value={novaDataFechamento}
                                onChange={e => setNovaDataFechamento(e.target.value)}
                                className="text-sm border border-gray-200 rounded-xl px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                              />
                            ) : (
                              <span className={`text-sm ${isRegistrada ? 'text-gray-800 font-medium' : 'text-gray-400'}`}>
                                {formatarData(dataExibida)}
                                {!isRegistrada && <span className="ml-1 text-[10px] text-gray-400">(calculado)</span>}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {emEdicao ? (
                            <>
                              <button
                                onClick={() => registrarFechamento(f.mesReferencia, inputParaISO(novaDataFechamento))}
                                disabled={salvandoFatura || !novaDataFechamento}
                                className="p-1.5 rounded-xl text-green-700 hover:bg-green-50 disabled:opacity-40 transition-colors"
                                title="Salvar"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => { setEditandoFatura(null); setNovaDataFechamento('') }}
                                className="p-1.5 rounded-xl text-gray-500 hover:bg-gray-100 transition-colors"
                                title="Cancelar"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setEditandoFatura(f.mesReferencia)
                                  setNovaDataFechamento(dataExibida)
                                }}
                                disabled={salvandoFatura}
                                className="p-1.5 rounded-xl text-primary-600 hover:bg-primary-50 disabled:opacity-40 transition-colors"
                                title="Registrar/editar data de fechamento"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              {isRegistrada && (
                                <button
                                  onClick={() => removerFechamento(f.mesReferencia)}
                                  disabled={salvandoFatura}
                                  className="p-1.5 rounded-xl text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors"
                                  title="Remover data registrada (volta ao cálculo automático)"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <p className="text-xs text-gray-400 mt-3">
              Datas em cinza são calculadas automaticamente. Clique no lápis para registrar a data real de fechamento (útil quando cai em fim de semana ou feriado).
            </p>
          </div>
        </div>
      )}

      {/* ---- ABA ATIVIDADES ---- */}
      {abaAtual === 'atividades' && (
        <div className="bg-white rounded-3xl shadow-card p-4 mb-4">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Activity className="w-5 h-5 text-gray-500" />
            Atividade Recente
            {logsTotal > 0 && <span className="ml-auto text-xs text-gray-400 font-normal">{logsTotal} registro(s)</span>}
          </h2>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <input
              type="text"
              value={filtroBusca}
              onChange={(e) => setFiltroBusca(e.target.value)}
              placeholder="Buscar descrição"
              className="col-span-2 bg-gray-50 rounded-2xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
            />
            <select value={filtroAcao} onChange={(e) => setFiltroAcao(e.target.value)} className="bg-gray-50 rounded-2xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow">
              <option value="">Ação (todas)</option>
              {Object.entries(ACAO_CONFIG).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
            </select>
            <select value={filtroTabela} onChange={(e) => setFiltroTabela(e.target.value)} className="bg-gray-50 rounded-2xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow">
              <option value="">Tabela (todas)</option>
              {tabelasDisponiveis.map(tabela => <option key={tabela} value={tabela}>{tabela}</option>)}
            </select>
          </div>

          {logsFiltrados.length === 0 && !logsCarregando ? (
            <p className="text-sm text-gray-400 text-center py-6">Nenhuma atividade para os filtros informados</p>
          ) : (
            <div className="space-y-2">
              {logsFiltrados.map((entry) => {
                const cfg = ACAO_CONFIG[entry.acao] ?? { label: entry.acao, color: 'bg-gray-100 text-gray-600' }
                const dt = new Date(entry.created_at)
                const dataStr = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                const horaStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

                return (
                  <div key={entry.id} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full mt-0.5 ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 leading-snug">{entry.descricao}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {entry.tabela} · {dataStr} às {horaStr}
                        {entry.usuario && <span className="ml-1 text-gray-500">· {entry.usuario}</span>}
                      </p>
                    </div>
                  </div>
                )
              })}

              {logs.length < logsTotal && (
                <button
                  onClick={() => carregarLogs(logsPage + 1)}
                  disabled={logsCarregando}
                  className="w-full mt-1 py-2 text-sm text-primary-600 hover:text-primary-700 flex items-center justify-center gap-1 disabled:opacity-50 transition-colors"
                >
                  <ChevronDown className="w-4 h-4" />
                  {logsCarregando ? 'Carregando…' : `Ver mais (${logsTotal - logs.length} restantes)`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- ABA CATEGORIAS ---- */}
      {abaAtual === 'categorias' && (
        <div className="bg-white rounded-3xl shadow-card p-4 mb-4">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Tags className="w-5 h-5 text-gray-500" />
            Categorias de Compras
          </h2>

          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={novaCategoria}
              onChange={(e) => setNovaCategoria(e.target.value)}
              placeholder="Nova categoria"
              className="flex-1 bg-gray-50 rounded-2xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
            />
            <button
              onClick={adicionarCategoria}
              disabled={categoriasSalvando}
              className="px-3 rounded-2xl bg-primary-600 text-white text-sm font-semibold disabled:opacity-50 hover:bg-primary-700 transition-all active:scale-[0.97] shadow-sm"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2">
            {categorias.map((categoria) => {
              const emUso = categoriasUso[categoria] ?? 0
              const emEdicao = editandoCategoria === categoria
              return (
                <div key={categoria} className="border border-gray-200 rounded-2xl p-2.5 flex items-center gap-2">
                  {emEdicao ? (
                    <input
                      autoFocus
                      value={novoNomeCategoria}
                      onChange={(e) => setNovoNomeCategoria(e.target.value)}
                      className="flex-1 bg-gray-50 rounded-xl p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
                    />
                  ) : (
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">{categoria}</p>
                      <p className="text-xs text-gray-400">{emUso} compra(s) usando esta categoria</p>
                    </div>
                  )}

                  {emEdicao ? (
                    <button
                      onClick={() => confirmarEdicaoCategoria(categoria)}
                      disabled={categoriasSalvando}
                      className="p-2 rounded-xl text-green-700 hover:bg-green-50 active:bg-green-100 transition-colors"
                      title="Salvar alteração"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => { setEditandoCategoria(categoria); setNovoNomeCategoria(categoria) }}
                      className="p-2 rounded-xl text-primary-600 hover:bg-primary-50 active:bg-primary-100 transition-colors"
                      title="Editar categoria"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}

                  <button
                    onClick={() => removerCategoria(categoria)}
                    disabled={categoriasSalvando || emUso > 0}
                    className="p-2 rounded-xl text-red-500 hover:bg-red-50 active:bg-red-100 disabled:opacity-40 transition-colors"
                    title={emUso > 0 ? 'Não é possível remover categorias em uso' : 'Remover categoria'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>

          <p className="text-xs text-gray-400 mt-3">
            Você pode editar categorias em uso (as compras serão atualizadas automaticamente). Remoções só são permitidas para categorias sem uso.
          </p>
        </div>
      )}

    </div>
  )
}
