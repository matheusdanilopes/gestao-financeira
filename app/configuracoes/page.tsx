'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { descricaoFechamento } from '@/lib/fatura'
import { Settings, LogOut, Upload, Activity, ChevronDown, Sun, Moon, Monitor, Tags, Plus, Pencil, Trash2, Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import BottomNav from '@/components/BottomNav'
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

const ACAO_CONFIG: Record<string, { label: string; color: string }> = {
  inserir: { label: 'Inserção', color: 'bg-green-100 text-green-700' },
  editar: { label: 'Edição', color: 'bg-blue-100 text-blue-700' },
  excluir: { label: 'Exclusão', color: 'bg-red-100 text-red-600' },
  pagar: { label: 'Pagamento', color: 'bg-emerald-100 text-emerald-700' },
  receber: { label: 'Recebimento', color: 'bg-teal-100 text-teal-700' },
  aporte: { label: 'Aporte', color: 'bg-violet-100 text-violet-700' },
  importar: { label: 'Importação', color: 'bg-amber-100 text-amber-700' },
}

const PAGE_SIZE = 20

type AbaConfiguracoes = 'geral' | 'atividades' | 'categorias'

export default function ConfiguracoesPage() {
  const [abaAtual, setAbaAtual] = useState<AbaConfiguracoes>('geral')
  const [diaVencimento, setDiaVencimento] = useState(10)
  const [ajusteFechamento, setAjusteFechamento] = useState(0)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')

  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logsTotal, setLogsTotal] = useState(0)
  const [logsPage, setLogsPage] = useState(0)
  const [logsCarregando, setLogsCarregando] = useState(false)
  const [filtroAcao, setFiltroAcao] = useState('')
  const [filtroTabela, setFiltroTabela] = useState('')
  const [filtroBusca, setFiltroBusca] = useState('')

  const [categorias, setCategorias] = useState<string[]>(CATEGORIAS_PADRAO)
  const [categoriasUso, setCategoriasUso] = useState<Record<string, number>>({})
  const [novaCategoria, setNovaCategoria] = useState('')
  const [editandoCategoria, setEditandoCategoria] = useState<string | null>(null)
  const [novoNomeCategoria, setNovoNomeCategoria] = useState('')
  const [categoriasSalvando, setCategoriasSalvando] = useState(false)

  const router = useRouter()
  const { theme, setTheme } = useTheme()

  async function carregarConfigs() {
    const res = await fetch('/api/configuracoes')
    const data = await res.json()
    const configs: Array<{ chave: string; valor: string }> = data.configuracoes ?? []
    const dv = configs.find(c => c.chave === 'dia_vencimento')
    const af = configs.find(c => c.chave === 'ajuste_fechamento')
    const cats = configs.find(c => c.chave === 'categorias_compras')

    if (dv) setDiaVencimento(parseInt(dv.valor))
    if (af) setAjusteFechamento(parseInt(af.valor))
    setCategorias(parseCategoriasConfig(cats?.valor))
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

  async function salvar() {
    setSalvando(true)
    setMensagem('')
    const res = await fetch('/api/configuracoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configuracoes: [
          { chave: 'dia_vencimento', valor: String(diaVencimento) },
          { chave: 'ajuste_fechamento', valor: String(ajusteFechamento) },
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
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-24">
      <h1 className="text-2xl font-bold mb-4">Configurações</h1>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {([
          { key: 'geral', label: 'Geral', icon: Settings },
          { key: 'atividades', label: 'Atividades', icon: Activity },
          { key: 'categorias', label: 'Categorias', icon: Tags },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setAbaAtual(key)}
            className={`py-2.5 rounded-xl border text-sm font-semibold flex items-center justify-center gap-2 transition ${
              abaAtual === key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
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

      {abaAtual === 'geral' && (
        <>
          <div className="bg-white rounded-xl shadow p-4 mb-4">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5 text-gray-500" />
              Ciclo de Fatura Nubank
            </h2>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Dia de Vencimento</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={diaVencimento}
                  onChange={(e) => setDiaVencimento(Math.max(1, Math.min(31, parseInt(e.target.value) || 1)))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Ajuste Fino do Fechamento</label>
                <div className="flex gap-3">
                  {([-1, 0, 1] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setAjusteFechamento(v)}
                      className={`flex-1 py-2.5 rounded-xl border-2 font-semibold transition ${
                        ajusteFechamento === v
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {v > 0 ? `+${v}` : v}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                <p className="text-sm text-gray-500">Fechamento calculado</p>
                <p className="font-semibold text-blue-700 mt-0.5">{descricaoFechamento(diaVencimento, ajusteFechamento)}</p>
              </div>

              <button
                onClick={salvar}
                disabled={salvando}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition disabled:opacity-50"
              >
                {salvando ? 'Salvando...' : 'Salvar Configurações'}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-4 mb-4">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Upload className="w-5 h-5 text-gray-500" />
              Importar Dados
            </h2>
            <Link
              href="/importar"
              className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition"
            >
              <Upload className="w-4 h-4" />
              Ir para Importação
            </Link>
          </div>

          <div className="bg-white rounded-xl shadow p-4 mb-4">
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
                  className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 font-semibold text-sm transition ${
                    theme === value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-4">
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

      {abaAtual === 'atividades' && (
        <div className="bg-white rounded-xl shadow p-4 mb-4">
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
              className="col-span-2 bg-gray-50 rounded-lg p-2 text-sm"
            />
            <select value={filtroAcao} onChange={(e) => setFiltroAcao(e.target.value)} className="bg-gray-50 rounded-lg p-2 text-sm">
              <option value="">Ação (todas)</option>
              {Object.entries(ACAO_CONFIG).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
            </select>
            <select value={filtroTabela} onChange={(e) => setFiltroTabela(e.target.value)} className="bg-gray-50 rounded-lg p-2 text-sm">
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
                  className="w-full mt-1 py-2 text-sm text-blue-600 hover:text-blue-700 flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  <ChevronDown className="w-4 h-4" />
                  {logsCarregando ? 'Carregando…' : `Ver mais (${logsTotal - logs.length} restantes)`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {abaAtual === 'categorias' && (
        <div className="bg-white rounded-xl shadow p-4 mb-4">
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
              className="flex-1 bg-gray-50 rounded-lg p-2.5 text-sm"
            />
            <button
              onClick={adicionarCategoria}
              disabled={categoriasSalvando}
              className="px-3 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2">
            {categorias.map((categoria) => {
              const emUso = categoriasUso[categoria] ?? 0
              const emEdicao = editandoCategoria === categoria
              return (
                <div key={categoria} className="border border-gray-200 rounded-xl p-2.5 flex items-center gap-2">
                  {emEdicao ? (
                    <input
                      autoFocus
                      value={novoNomeCategoria}
                      onChange={(e) => setNovoNomeCategoria(e.target.value)}
                      className="flex-1 bg-gray-50 rounded-lg p-2 text-sm"
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
                      className="p-2 rounded-lg text-green-700 hover:bg-green-50"
                      title="Salvar alteração"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => { setEditandoCategoria(categoria); setNovoNomeCategoria(categoria) }}
                      className="p-2 rounded-lg text-blue-600 hover:bg-blue-50"
                      title="Editar categoria"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}

                  <button
                    onClick={() => removerCategoria(categoria)}
                    disabled={categoriasSalvando || emUso > 0}
                    className="p-2 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40"
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

      <BottomNav />
    </div>
  )
}
