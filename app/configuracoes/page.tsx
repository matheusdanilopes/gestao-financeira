'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { format, startOfMonth, addMonths, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { supabase } from '@/lib/supabaseClient'
import { descricaoFechamento, calcularDataFechamentoDaFaturaISO } from '@/lib/fatura'
import {
  Settings, LogOut, Upload, Activity, ChevronDown, Sun, Moon, Monitor,
  Tags, Plus, Pencil, Trash2, Check, CreditCard, CalendarDays, X, Bell, Search,
  User, Mail, Lock, Eye, EyeOff,
} from 'lucide-react'
import FilterSelect from '@/components/FilterSelect'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useTheme } from '@/components/ThemeProvider'
import { CATEGORIAS_PADRAO, normalizarCategorias, parseCategoriasConfig } from '@/lib/categorias'
import { PUSH_REFRESH_KEY } from '@/components/NotificacoesBell'

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
  inserir:  { label: 'Inserção',     color: 'bg-green-100 text-green-700' },
  editar:   { label: 'Edição',       color: 'bg-blue-100 text-blue-700' },
  excluir:  { label: 'Exclusão',     color: 'bg-red-100 text-red-600' },
  pagar:    { label: 'Pagamento',    color: 'bg-emerald-100 text-emerald-700' },
  receber:  { label: 'Recebimento',  color: 'bg-teal-100 text-teal-700' },
  aporte:   { label: 'Aporte',       color: 'bg-violet-100 text-violet-700' },
  importar: { label: 'Importação',   color: 'bg-amber-100 text-amber-700' },
}

const CARTAO_LABELS: Record<string, string> = {
  nubank: 'NuBank',
  cartao1: 'Cartão 1',
  cartao2: 'Cartão 2',
}

const PAGE_SIZE = 20

type AbaConfiguracoes = 'cartoes' | 'categorias' | 'preferencias' | 'conta' | 'atividades'
type CartaoFaturas = 'nubank' | 'cartao1' | 'cartao2'

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
    <div className={`border rounded-2xl overflow-hidden transition-colors ${expandido ? 'border-primary-200 dark:border-primary-800' : 'border-gray-200 dark:border-gray-700'}`}>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-3 px-4 py-4 transition-colors active:scale-[0.99] ${
          expandido ? 'bg-primary-50 dark:bg-primary-900/20' : 'bg-white dark:bg-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
      >
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${expandido ? 'bg-primary-100 dark:bg-primary-900/40' : 'bg-gray-100 dark:bg-gray-700'}`}>
          <CreditCard className={`w-4 h-4 ${expandido ? 'text-primary-500' : 'text-gray-400 dark:text-gray-500'}`} />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <span className={`font-semibold text-sm block tracking-tight ${expandido ? 'text-primary-700 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300'}`}>
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
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ease-spring shrink-0 ${expandido ? 'rotate-180' : ''}`} />
      </button>

      {expandido && (
        <div className="px-4 pb-5 pt-4 space-y-4 border-t border-primary-100 dark:border-primary-900/30 bg-white dark:bg-gray-800/30">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wider">Dia de Vencimento</label>
            <input
              type="number"
              min={1}
              max={31}
              value={diaVenc}
              onChange={(e) => setDiaVenc(Math.max(1, Math.min(31, parseInt(e.target.value) || 1)))}
              className="w-full px-4 py-3 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-primary-400 focus:border-transparent text-lg font-semibold num transition-shadow"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wider">Ajuste Fino do Fechamento</label>
            <div className="flex gap-2">
              {([-1, 0, 1] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAjuste(v)}
                  className={`flex-1 py-2.5 rounded-2xl border-2 font-semibold transition active:scale-[0.97] ${
                    ajuste === v
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  {v > 0 ? `+${v}` : v}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-800 rounded-2xl p-3.5">
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider mb-0.5">Fechamento calculado</p>
            <p className="font-semibold text-primary-700 dark:text-primary-400">{descricaoFechamento(diaVenc, ajuste)}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Card de seção reutilizável (evita repetir a casca visual em cada bloco da aba Geral) ----

function SettingsCard({
  icon: Icon,
  title,
  description,
  badge,
  children,
  className = '',
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  badge?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`bg-white rounded-3xl shadow-card border border-gray-100 p-4 mb-4 ${className}`}>
      <h2 className={`text-base font-semibold flex items-center gap-2.5 text-gray-800 tracking-tight ${description ? 'mb-1' : 'mb-4'}`}>
        <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-gray-500" />
        </div>
        <span className="flex-1">{title}</span>
        {badge && (
          <span className="text-xs text-gray-400 font-normal bg-gray-100 px-2 py-0.5 rounded-full">{badge}</span>
        )}
      </h2>
      {description && (
        <p className="text-xs text-gray-400 mb-4 ml-10">{description}</p>
      )}
      {children}
    </div>
  )
}

function SettingsToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-700 tracking-tight">{title}</p>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        aria-checked={checked}
        role="switch"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-spring focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 ${
          checked ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-700'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ease-spring ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}

function ConfiguracoesContent() {
  const searchParams = useSearchParams()
  const [abaAtual, setAbaAtual] = useState<AbaConfiguracoes>('preferencias')

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'cartoes' || tab === 'categorias' || tab === 'preferencias' || tab === 'conta' || tab === 'atividades') {
      setAbaAtual(tab)
    }
  }, [searchParams])

  // --- Geral ---
  const [cartaoExpandido, setCartaoExpandido] = useState<'nubank' | 'cartao1' | 'cartao2' | null>(null)
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

  // --- Notificações ---
  const [notificacoesVencimentoAtivas, setNotificacoesVencimentoAtivas] = useState(true)
  const [permissaoPush, setPermissaoPush] = useState<NotificationPermission | 'unsupported' | null>(null)
  const [subscricaoAtiva, setSubscricaoAtiva] = useState<boolean | null>(null)
  const [registrandoPush, setRegistrandoPush] = useState(false)
  const [testando, setTestando] = useState(false)
  const [mensagemPush, setMensagemPush] = useState('')

  // --- Conta (usuário) ---
  const [emailAtual, setEmailAtual] = useState('')
  const [novoEmail, setNovoEmail] = useState('')
  const [salvandoEmail, setSalvandoEmail] = useState(false)
  const [mensagemEmail, setMensagemEmail] = useState('')

  const [novaSenha, setNovaSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [mostrarNovaSenha, setMostrarNovaSenha] = useState(false)
  const [mostrarConfirmarSenha, setMostrarConfirmarSenha] = useState(false)
  const [salvandoSenha, setSalvandoSenha] = useState(false)
  const [mensagemSenha, setMensagemSenha] = useState('')

  // --- Categorias ---
  const [categorias, setCategorias] = useState<string[]>(CATEGORIAS_PADRAO)
  const [categoriasUso, setCategoriasUso] = useState<Record<string, number>>({})
  const [categoriaLimites, setCategoriaLimites] = useState<Record<string, string>>({})
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
  const mesesExibidos: FaturaExibida[] = (() => {
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
  })()

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
    setNotificacoesVencimentoAtivas(get('notificacoes_vencimento_ativas', 'true') === 'true')

    const limites: Record<string, string> = {}
    for (const c of configs) {
      if (c.chave.startsWith('limite_cat_')) {
        const catName = c.chave.slice('limite_cat_'.length)
        limites[catName] = c.valor
      }
    }
    setCategoriaLimites(limites)
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
    const [{ data: compras }, { data: assinaturas }] = await Promise.all([
      supabase.from('transacoes_nubank').select('categoria').not('categoria', 'is', null),
      supabase.from('assinaturas').select('categoria').not('categoria', 'is', null),
    ])

    const usage: Record<string, number> = {}

    for (const row of (compras ?? [])) {
      const c = row.categoria as string | null
      if (c) usage[c] = (usage[c] ?? 0) + 1
    }
    for (const row of (assinaturas ?? [])) {
      const c = row.categoria as string | null
      if (c) usage[c] = (usage[c] ?? 0) + 1
    }

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
      const [{ error: erroCompras }, { error: erroAssinaturas }] = await Promise.all([
        supabase
          .from('transacoes_nubank')
          .update({ categoria: novoNome })
          .eq('categoria', categoriaAntiga),
        supabase
          .from('assinaturas')
          .update({ categoria: novoNome })
          .eq('categoria', categoriaAntiga),
      ])

      if (erroCompras || erroAssinaturas) {
        setMensagem('Erro ao renomear categoria: ' + (erroCompras?.message ?? erroAssinaturas?.message))
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

  async function carregarStatusPush() {
    if (typeof window === 'undefined') return
    if (!('Notification' in window)) {
      setPermissaoPush('unsupported')
      return
    }
    setPermissaoPush(Notification.permission)
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        setSubscricaoAtiva(!!sub)
      } catch {
        setSubscricaoAtiva(false)
      }
    }
  }

  async function ativarNotificacoes() {
    setRegistrandoPush(true)
    setMensagemPush('')
    try {
      const perm = await Notification.requestPermission()
      setPermissaoPush(perm)
      if (perm !== 'granted') {
        setMensagemPush('Permissão negada. Acesse as configurações do navegador/sistema para permitir notificações.')
        return
      }
      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (sub) await sub.unsubscribe()
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
      if (!vapidKey) { setMensagemPush('VAPID não configurado.'); return }
      const padding = '='.repeat((4 - (vapidKey.length % 4)) % 4)
      const base64 = (vapidKey + padding).replace(/-/g, '+').replace(/_/g, '/')
      const raw = atob(base64)
      const arr = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: arr })
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub }),
      })
      if (res.ok) {
        setSubscricaoAtiva(true)
        setMensagemPush('Notificações ativadas com sucesso!')
        try { localStorage.setItem(PUSH_REFRESH_KEY, String(Date.now())) } catch { /* noop */ }
      } else {
        setMensagemPush('Erro ao registrar no servidor.')
      }
    } catch (err) {
      setMensagemPush(err instanceof Error ? err.message : 'Erro ao ativar notificações.')
    } finally {
      setRegistrandoPush(false)
    }
  }

  async function desativarNotificacoes() {
    setRegistrandoPush(true)
    setMensagemPush('')
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (sub) await sub.unsubscribe()
      }
      setSubscricaoAtiva(false)
      setMensagemPush('Notificações desativadas.')
      try { localStorage.removeItem(PUSH_REFRESH_KEY) } catch { /* noop */ }
    } catch (err) {
      setMensagemPush(err instanceof Error ? err.message : 'Erro ao desativar.')
    } finally {
      setRegistrandoPush(false)
    }
  }

  async function testarNotificacao() {
    setTestando(true)
    setMensagemPush('')
    try {
      const res = await fetch('/api/push/test', { method: 'POST' })
      const data = await res.json()
      setMensagemPush(res.ok ? 'Notificação de teste enviada! Verifique seu dispositivo.' : (data.error ?? 'Erro ao testar.'))
    } catch {
      setMensagemPush('Erro ao conectar ao servidor.')
    } finally {
      setTestando(false)
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  async function handleAlterarEmail(e: React.FormEvent) {
    e.preventDefault()
    setMensagemEmail('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(novoEmail)) {
      setMensagemEmail('Informe um email válido.')
      return
    }
    if (novoEmail === emailAtual) {
      setMensagemEmail('O novo email deve ser diferente do atual.')
      return
    }
    setSalvandoEmail(true)
    try {
      const res = await fetch('/api/conta/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: novoEmail }),
      })
      const data = await res.json()
      if (data.ok) {
        setMensagemEmail('Email atualizado com sucesso!')
        setEmailAtual(novoEmail)
        setNovoEmail('')
        setTimeout(() => setMensagemEmail(''), 3000)
      } else {
        setMensagemEmail('Erro: ' + (data.error || 'desconhecido'))
      }
    } catch {
      setMensagemEmail('Erro ao conectar ao servidor.')
    } finally {
      setSalvandoEmail(false)
    }
  }

  async function handleAlterarSenha(e: React.FormEvent) {
    e.preventDefault()
    setMensagemSenha('')
    if (novaSenha.length < 6) {
      setMensagemSenha('A senha deve ter pelo menos 6 caracteres.')
      return
    }
    if (novaSenha !== confirmarSenha) {
      setMensagemSenha('As senhas não coincidem.')
      return
    }
    setSalvandoSenha(true)
    try {
      const res = await fetch('/api/conta/senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha: novaSenha }),
      })
      const data = await res.json()
      if (data.ok) {
        setMensagemSenha('Senha atualizada com sucesso!')
        setNovaSenha('')
        setConfirmarSenha('')
        setTimeout(() => setMensagemSenha(''), 3000)
      } else {
        setMensagemSenha('Erro: ' + (data.error || 'desconhecido'))
      }
    } catch {
      setMensagemSenha('Erro ao conectar ao servidor.')
    } finally {
      setSalvandoSenha(false)
    }
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
      carregarStatusPush()
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setEmailAtual(data.user.email)
    })
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

  // Verifica se a mensagem é de erro ou sucesso
  const mensagemSucesso = mensagem.toLowerCase().includes('sucesso') || mensagem.toLowerCase().includes('atualizada')

  return (
    <div className="min-h-screen bg-gray-50 page-content page-bottom-safe page-enter">
      {/* Header */}
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 z-10">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">Configurações</h1>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto gap-2 mb-4 mt-3 pb-0.5 scrollbar-hide">
        {([
          { key: 'preferencias', label: 'Preferências', icon: Settings },
          { key: 'conta',        label: 'Conta',        icon: User },
          { key: 'cartoes',      label: 'Cartões',      icon: CreditCard },
          { key: 'categorias',   label: 'Categorias',   icon: Tags },
          { key: 'atividades',   label: 'Atividades',   icon: Activity },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setAbaAtual(key)}
            className={`shrink-0 px-4 py-2.5 rounded-2xl border text-sm font-semibold flex items-center gap-2 transition active:scale-[0.97] ${
              abaAtual === key
                ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Toast de feedback */}
      {mensagem && (
        <div className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl mb-4 text-sm font-medium ${
          mensagemSucesso
            ? 'bg-emerald-50 border border-emerald-100 text-emerald-700'
            : 'bg-red-50 border border-red-100 text-red-600'
        }`}>
          <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
            mensagemSucesso ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-500'
          }`}>
            {mensagemSucesso
              ? <Check className="w-3 h-3" />
              : <X className="w-3 h-3" />
            }
          </span>
          {mensagem}
        </div>
      )}

      {/* ---- ABA CARTÕES ---- */}
      {abaAtual === 'cartoes' && (
        <>
          {/* Ciclos de fatura */}
          <SettingsCard icon={Settings} title="Ciclos de Fatura por Cartão">
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
                className="w-full bg-primary-600 text-white py-3 rounded-2xl font-semibold hover:bg-primary-700 transition-all active:scale-[0.97] disabled:opacity-50 shadow-sm mt-1"
              >
                {salvando ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Salvando…
                  </span>
                ) : 'Salvar Configurações'}
              </button>
            </div>
          </SettingsCard>

          {/* Datas de fechamento */}
          <SettingsCard
            icon={CalendarDays}
            title="Datas de Fechamento"
            description="Registre a data real de fechamento de cada fatura. Datas em cinza são estimativas automáticas."
          >
            {/* Seletor de cartão */}
            <div className="flex gap-2 mb-4">
              {(['nubank', 'cartao1', 'cartao2'] as CartaoFaturas[]).map(c => (
                <button
                  key={c}
                  onClick={() => setCartaoFaturas(c)}
                  className={`flex-1 py-2 rounded-2xl border text-xs font-semibold transition active:scale-[0.97] ${
                    cartaoFaturas === c
                      ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {cartaoLabels[c]}
                </button>
              ))}
            </div>

            {faturasCarregando ? (
              <div className="space-y-2 py-2">
                {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-14 rounded-2xl" />)}
              </div>
            ) : (
              <div className="space-y-2">
                {mesesExibidos.map((f) => {
                  const emEdicao = editandoFatura === f.mesReferencia
                  const dataExibida = f.dataFechamentoRegistrada ?? f.dataFechamentoCalculada
                  const isRegistrada = f.registrada

                  return (
                    <div
                      key={f.mesReferencia}
                      className={`border rounded-2xl p-3 transition-colors ${
                        emEdicao
                          ? 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20'
                          : 'border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 capitalize tracking-tight">{f.mesLabel}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <CalendarDays className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            {emEdicao ? (
                              <input
                                type="date"
                                value={novaDataFechamento}
                                onChange={e => setNovaDataFechamento(e.target.value)}
                                className="text-sm border border-gray-200 rounded-xl px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white dark:bg-gray-800"
                              />
                            ) : (
                              <span className={`text-sm num ${isRegistrada ? 'text-gray-700 dark:text-gray-300 font-medium' : 'text-gray-400 dark:text-gray-500'}`}>
                                {formatarData(dataExibida)}
                                {!isRegistrada && <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500">(calculado)</span>}
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
                                className="w-8 h-8 flex items-center justify-center rounded-xl text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-40 transition-colors"
                                title="Salvar"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => { setEditandoFatura(null); setNovaDataFechamento('') }}
                                className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 transition-colors"
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
                                className="w-8 h-8 flex items-center justify-center rounded-xl text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-40 transition-colors"
                                title="Registrar/editar data de fechamento"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              {isRegistrada && (
                                <button
                                  onClick={() => removerFechamento(f.mesReferencia)}
                                  disabled={salvandoFatura}
                                  className="w-8 h-8 flex items-center justify-center rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 transition-colors"
                                  title="Remover data registrada"
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

            <p className="text-xs text-gray-400 mt-3 leading-relaxed">
              Datas em cinza são calculadas automaticamente. Use o lápis para registrar a data real (útil quando cai em fim de semana ou feriado).
            </p>
          </SettingsCard>
        </>
      )}

      {/* ---- ABA CATEGORIAS ---- */}
      {abaAtual === 'categorias' && (
        <SettingsCard
          icon={Tags}
          title="Categorias"
          description="Usadas em compras, despesas, receitas e assinaturas."
        >
          {/* Adicionar categoria */}
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={novaCategoria}
              onChange={(e) => setNovaCategoria(e.target.value)}
              placeholder="Nova categoria"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adicionarCategoria() } }}
              className="flex-1 bg-gray-50 border border-gray-200 dark:border-gray-700 rounded-2xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow placeholder-gray-400"
            />
            <button
              onClick={adicionarCategoria}
              disabled={categoriasSalvando || !novaCategoria.trim()}
              className="w-10 h-10 flex items-center justify-center rounded-2xl bg-primary-600 text-white disabled:opacity-40 hover:bg-primary-700 transition-all active:scale-[0.97] shadow-sm shrink-0"
              aria-label="Adicionar categoria"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Lista de categorias */}
          <div className="space-y-2">
            {categorias.map((categoria) => {
              const emUso = categoriasUso[categoria] ?? 0
              const emEdicao = editandoCategoria === categoria
              return (
                <div key={categoria} className={`border rounded-2xl p-3 flex items-center gap-2 transition-colors ${
                  emEdicao
                    ? 'border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700'
                }`}>
                  {emEdicao ? (
                    <input
                      autoFocus
                      value={novoNomeCategoria}
                      onChange={(e) => setNovoNomeCategoria(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') confirmarEdicaoCategoria(categoria); if (e.key === 'Escape') { setEditandoCategoria(null); setNovoNomeCategoria('') } }}
                      className="flex-1 bg-white dark:bg-gray-800 border border-primary-200 dark:border-primary-700 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
                    />
                  ) : (
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 tracking-tight">{categoria}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {emUso > 0 ? `${emUso} uso${emUso > 1 ? 's' : ''} em compras e assinaturas` : 'Sem usos registrados'}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="text-[10px] text-gray-400">Limite/mês:</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Sem limite"
                          value={categoriaLimites[categoria] ?? ''}
                          onChange={(e) => setCategoriaLimites(prev => ({ ...prev, [categoria]: e.target.value }))}
                          onBlur={async (e) => {
                            const val = e.target.value.trim()
                            await fetch('/api/configuracoes', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ configuracoes: [{ chave: `limite_cat_${categoria}`, valor: val || '0' }] }),
                            })
                          }}
                          className="w-24 bg-gray-50 border border-gray-200 rounded-xl px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary-400 transition-shadow"
                        />
                      </div>
                    </div>
                  )}

                  {/* Botão confirmar edição */}
                  {emEdicao ? (
                    <button
                      onClick={() => confirmarEdicaoCategoria(categoria)}
                      disabled={categoriasSalvando}
                      className="w-8 h-8 flex items-center justify-center rounded-xl text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 active:bg-emerald-100 transition-colors"
                      title="Salvar alteração"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => { setEditandoCategoria(categoria); setNovoNomeCategoria(categoria) }}
                      className="w-8 h-8 flex items-center justify-center rounded-xl text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 active:bg-primary-100 transition-colors"
                      title="Editar categoria"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}

                  {/* Botão remover */}
                  <button
                    onClick={() => removerCategoria(categoria)}
                    disabled={categoriasSalvando || emUso > 0}
                    className="w-8 h-8 flex items-center justify-center rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 active:bg-red-100 disabled:opacity-30 transition-colors"
                    title={emUso > 0 ? 'Não é possível remover categorias em uso' : 'Remover categoria'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>

          <p className="text-xs text-gray-400 mt-3 leading-relaxed">
            Editar renomeia a categoria em compras e assinaturas automaticamente. Remoção só é permitida quando não há uso.
          </p>
        </SettingsCard>
      )}

      {/* ---- ABA PREFERÊNCIAS ---- */}
      {abaAtual === 'preferencias' && (
        <>
          {/* Dados */}
          <SettingsCard icon={Upload} title="Dados">
            <Link
              href="/importar"
              className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white py-3 rounded-2xl font-semibold hover:bg-primary-700 transition-all active:scale-[0.97] shadow-sm"
            >
              <Upload className="w-4 h-4" />
              Importar Dados
            </Link>
          </SettingsCard>

          {/* Tema */}
          <SettingsCard icon={Sun} title="Tema">
            <div className="flex gap-2">
              {([
                { value: 'light',  label: 'Claro',   Icon: Sun },
                { value: 'dark',   label: 'Escuro',  Icon: Moon },
                { value: 'system', label: 'Sistema', Icon: Monitor },
              ] as const).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={`flex-1 flex flex-col items-center gap-2 py-3.5 rounded-2xl border-2 font-semibold text-sm transition active:scale-[0.97] ${
                    theme === value
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${theme === value ? 'text-primary-500' : ''}`} />
                  {label}
                </button>
              ))}
            </div>
          </SettingsCard>

          {/* Notificações push */}
          <SettingsCard icon={Bell} title="Notificações Push" className="space-y-4">
            {/* Status da permissão */}
            {permissaoPush !== null && (
              <div className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl text-sm font-medium ${
                permissaoPush === 'granted'
                  ? 'bg-green-50 border border-green-100 text-green-700'
                  : permissaoPush === 'denied'
                  ? 'bg-red-50 border border-red-100 text-red-700'
                  : permissaoPush === 'unsupported'
                  ? 'bg-gray-50 border border-gray-200 text-gray-500'
                  : 'bg-amber-50 border border-amber-100 text-amber-700'
              }`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  permissaoPush === 'granted' ? 'bg-green-500' :
                  permissaoPush === 'denied'  ? 'bg-red-500' :
                  permissaoPush === 'unsupported' ? 'bg-gray-400' : 'bg-amber-400'
                }`} />
                {permissaoPush === 'granted' && subscricaoAtiva
                  ? 'Notificações ativas e subscrição registrada'
                  : permissaoPush === 'granted' && subscricaoAtiva === false
                  ? 'Permissão concedida, mas sem subscrição ativa'
                  : permissaoPush === 'denied'
                  ? 'Permissão bloqueada — libere nas configurações do sistema'
                  : permissaoPush === 'unsupported'
                  ? 'Notificações não suportadas neste navegador'
                  : 'Permissão não concedida'}
              </div>
            )}

            {mensagemPush && (
              <p className={`text-xs px-3.5 py-2.5 rounded-2xl border ${
                mensagemPush.includes('sucesso') || mensagemPush.includes('enviada')
                  ? 'bg-green-50 border-green-100 text-green-700'
                  : 'bg-red-50 border-red-100 text-red-600'
              }`}>
                {mensagemPush}
              </p>
            )}

            {/* Ações */}
            {permissaoPush !== null && permissaoPush !== 'unsupported' && permissaoPush !== 'denied' && (
              <div className="flex gap-2">
                {(!subscricaoAtiva || permissaoPush !== 'granted') ? (
                  <button
                    onClick={ativarNotificacoes}
                    disabled={registrandoPush}
                    className="flex-1 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-2xl transition-all active:scale-[0.97] disabled:opacity-50 shadow-sm"
                  >
                    {registrandoPush ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Ativando…
                      </span>
                    ) : 'Ativar notificações'}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={testarNotificacao}
                      disabled={testando}
                      className="flex-1 py-2.5 bg-primary-50 hover:bg-primary-100 text-primary-700 text-sm font-semibold rounded-2xl transition-all active:scale-[0.97] disabled:opacity-50 border border-primary-200"
                    >
                      {testando ? 'Enviando…' : 'Testar notificação'}
                    </button>
                    <button
                      onClick={desativarNotificacoes}
                      disabled={registrandoPush}
                      className="py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold rounded-2xl transition-all active:scale-[0.97] disabled:opacity-50"
                    >
                      {registrandoPush ? '…' : 'Desativar'}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Alertas de vencimento */}
            <div className="border-t border-gray-100 pt-4">
              <SettingsToggleRow
                title="Alertas de vencimento"
                description="T-1 e no dia do vencimento às 09:00"
                checked={notificacoesVencimentoAtivas}
                onChange={async (newVal) => {
                  setNotificacoesVencimentoAtivas(newVal)
                  await fetch('/api/configuracoes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ configuracoes: [{ chave: 'notificacoes_vencimento_ativas', valor: String(newVal) }] }),
                  })
                }}
              />
            </div>
          </SettingsCard>

        </>
      )}

      {/* ---- ABA CONTA ---- */}
      {abaAtual === 'conta' && (
        <>
          {/* Email */}
          <SettingsCard icon={Mail} title="Email" description={`Email atual: ${emailAtual || '—'}`}>
            <form onSubmit={handleAlterarEmail} className="space-y-3">
              <input
                type="email"
                value={novoEmail}
                onChange={(e) => setNovoEmail(e.target.value)}
                placeholder="novo@email.com"
                required
                autoComplete="email"
                className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-shadow"
              />
              {mensagemEmail && (
                <p className={`text-xs px-3.5 py-2.5 rounded-2xl border ${
                  mensagemEmail.includes('sucesso')
                    ? 'bg-green-50 border-green-100 text-green-700'
                    : 'bg-red-50 border-red-100 text-red-600'
                }`}>
                  {mensagemEmail}
                </p>
              )}
              <button
                type="submit"
                disabled={salvandoEmail}
                className="w-full bg-primary-600 text-white py-3 rounded-2xl font-semibold text-sm hover:bg-primary-700 active:scale-[0.98] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {salvandoEmail ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Salvando…
                  </span>
                ) : (
                  'Alterar email'
                )}
              </button>
            </form>
          </SettingsCard>

          {/* Senha */}
          <SettingsCard icon={Lock} title="Senha">
            <form onSubmit={handleAlterarSenha} className="space-y-3">
              <div className="relative">
                <input
                  type={mostrarNovaSenha ? 'text' : 'password'}
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  placeholder="Nova senha"
                  required
                  autoComplete="new-password"
                  className="w-full pl-4 pr-11 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-shadow"
                />
                <button
                  type="button"
                  onClick={() => setMostrarNovaSenha(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  aria-label={mostrarNovaSenha ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {mostrarNovaSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="relative">
                <input
                  type={mostrarConfirmarSenha ? 'text' : 'password'}
                  value={confirmarSenha}
                  onChange={(e) => setConfirmarSenha(e.target.value)}
                  placeholder="Confirmar nova senha"
                  required
                  autoComplete="new-password"
                  className="w-full pl-4 pr-11 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-shadow"
                />
                <button
                  type="button"
                  onClick={() => setMostrarConfirmarSenha(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  aria-label={mostrarConfirmarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {mostrarConfirmarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {mensagemSenha && (
                <p className={`text-xs px-3.5 py-2.5 rounded-2xl border ${
                  mensagemSenha.includes('sucesso')
                    ? 'bg-green-50 border-green-100 text-green-700'
                    : 'bg-red-50 border-red-100 text-red-600'
                }`}>
                  {mensagemSenha}
                </p>
              )}
              <button
                type="submit"
                disabled={salvandoSenha}
                className="w-full bg-primary-600 text-white py-3 rounded-2xl font-semibold text-sm hover:bg-primary-700 active:scale-[0.98] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {salvandoSenha ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Salvando…
                  </span>
                ) : (
                  'Alterar senha'
                )}
              </button>
            </form>
          </SettingsCard>

          {/* Sessão */}
          <SettingsCard icon={LogOut} title="Sessão">
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2.5 py-3 text-red-600 font-semibold hover:bg-red-50 rounded-2xl transition-colors active:scale-[0.98]"
            >
              <LogOut className="w-4 h-4" />
              Sair da conta
            </button>
          </SettingsCard>
        </>
      )}

      {/* ---- ABA ATIVIDADES ---- */}
      {abaAtual === 'atividades' && (
        <SettingsCard
          icon={Activity}
          title="Atividade Recente"
          badge={logsTotal > 0 ? `${logsTotal} reg.` : undefined}
        >
          {/* Filtros */}
          <div className="space-y-2 mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={filtroBusca}
                onChange={(e) => setFiltroBusca(e.target.value)}
                placeholder="Buscar descrição…"
                className="w-full bg-gray-50 border border-gray-200 dark:border-gray-700 rounded-2xl pl-9 pr-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow placeholder-gray-400"
              />
            </div>
            <div className="flex gap-2">
              <FilterSelect
                value={filtroAcao}
                onChange={v => setFiltroAcao(v)}
                options={[
                  { value: '', label: 'Ação (todas)' },
                  ...Object.entries(ACAO_CONFIG).map(([key, cfg]) => ({ value: key, label: cfg.label })),
                ]}
              />
              <FilterSelect
                value={filtroTabela}
                onChange={v => setFiltroTabela(v)}
                options={[
                  { value: '', label: 'Tabela (todas)' },
                  ...tabelasDisponiveis.map(tabela => ({ value: tabela, label: tabela })),
                ]}
              />
            </div>
          </div>

          {logsFiltrados.length === 0 && !logsCarregando ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
              <div className="w-10 h-10 rounded-2xl bg-gray-100 flex items-center justify-center mb-1">
                <Activity className="w-5 h-5 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-500">Nenhuma atividade encontrada</p>
              <p className="text-xs text-gray-400">Tente ajustar os filtros</p>
            </div>
          ) : (
            <div className="space-y-0">
              {logsFiltrados.map((entry) => {
                const cfg = ACAO_CONFIG[entry.acao] ?? { label: entry.acao, color: 'bg-gray-100 text-gray-600' }
                const dt = new Date(entry.created_at)
                const dataStr = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                const horaStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

                return (
                  <div key={entry.id} className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
                    <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full mt-0.5 whitespace-nowrap ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 dark:text-gray-300 leading-snug">{entry.descricao}</p>
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
                  className="w-full mt-2 py-2.5 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors rounded-2xl hover:bg-primary-50 dark:hover:bg-primary-900/20"
                >
                  <ChevronDown className="w-4 h-4" />
                  {logsCarregando ? 'Carregando…' : `Ver mais (${logsTotal - logs.length} restantes)`}
                </button>
              )}
            </div>
          )}
        </SettingsCard>
      )}

    </div>
  )
}

export default function ConfiguracoesPage() {
  return (
    <Suspense>
      <ConfiguracoesContent />
    </Suspense>
  )
}
