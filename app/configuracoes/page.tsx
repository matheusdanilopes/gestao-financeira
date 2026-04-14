'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { descricaoFechamento } from '@/lib/fatura'
import { Settings, LogOut, Upload, Activity, ChevronDown } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import BottomNav from '@/components/BottomNav'

interface LogEntry {
  id: string
  acao: string
  tabela: string
  descricao: string
  valor: number | null
  created_at: string
}

const ACAO_CONFIG: Record<string, { label: string; color: string }> = {
  inserir:  { label: 'Inserção',  color: 'bg-green-100 text-green-700' },
  editar:   { label: 'Edição',    color: 'bg-blue-100 text-blue-700' },
  excluir:  { label: 'Exclusão',  color: 'bg-red-100 text-red-600' },
  pagar:    { label: 'Pagamento', color: 'bg-emerald-100 text-emerald-700' },
  receber:  { label: 'Recebimento', color: 'bg-teal-100 text-teal-700' },
  aporte:   { label: 'Aporte',    color: 'bg-violet-100 text-violet-700' },
  importar: { label: 'Importação', color: 'bg-amber-100 text-amber-700' },
}

const PAGE_SIZE = 20

export default function ConfiguracoesPage() {
  const [diaVencimento, setDiaVencimento] = useState(10)
  const [ajusteFechamento, setAjusteFechamento] = useState(0)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [logsTotal, setLogsTotal] = useState(0)
  const [logsPage, setLogsPage] = useState(0)
  const [logsCarregando, setLogsCarregando] = useState(false)
  const router = useRouter()

  useEffect(() => { carregarConfigs(); carregarLogs(0) }, [])

  async function carregarConfigs() {
    const res = await fetch('/api/configuracoes')
    const data = await res.json()
    const configs: Array<{ chave: string; valor: string }> = data.configuracoes ?? []
    const dv = configs.find(c => c.chave === 'dia_vencimento')
    const af = configs.find(c => c.chave === 'ajuste_fechamento')
    if (dv) setDiaVencimento(parseInt(dv.valor))
    if (af) setAjusteFechamento(parseInt(af.valor))
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

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-24">
      <h1 className="text-2xl font-bold mb-6">Configurações</h1>

      {/* Fatura Nubank */}
      <div className="bg-white rounded-xl shadow p-4 mb-4">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5 text-gray-500" />
          Ciclo de Fatura Nubank
        </h2>

        <div className="space-y-5">
          {/* Dia de vencimento */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Dia de Vencimento
            </label>
            <input
              type="number"
              min={1}
              max={31}
              value={diaVencimento}
              onChange={(e) => setDiaVencimento(Math.max(1, Math.min(31, parseInt(e.target.value) || 1)))}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
            />
            <p className="text-xs text-gray-400 mt-1">
              Dia do mês em que a fatura vence (ex: 10)
            </p>
          </div>

          {/* Ajuste fino */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ajuste Fino do Fechamento
            </label>
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
            <p className="text-xs text-gray-400 mt-1">
              Use ±1 se o Nubank processar 1 dia antes/depois do esperado (fins de semana, feriados)
            </p>
          </div>

          {/* Preview do fechamento */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
            <p className="text-sm text-gray-500">Fechamento calculado</p>
            <p className="font-semibold text-blue-700 mt-0.5">
              {descricaoFechamento(diaVencimento, ajusteFechamento)}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Compras a partir deste dia vão para a fatura do mês seguinte
            </p>
          </div>

          {mensagem && (
            <p className="text-green-600 text-sm text-center font-medium bg-green-50 rounded-lg py-2">
              {mensagem}
            </p>
          )}

          <button
            onClick={salvar}
            disabled={salvando}
            className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition disabled:opacity-50"
          >
            {salvando ? 'Salvando...' : 'Salvar Configurações'}
          </button>
        </div>
      </div>

      {/* Importar CSV */}
      <div className="bg-white rounded-xl shadow p-4 mb-4">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Upload className="w-5 h-5 text-gray-500" />
          Importar Dados
        </h2>
        <p className="text-sm text-gray-500 mb-3">
          Faça upload do CSV exportado pelo Nubank para importar suas transações.
        </p>
        <Link
          href="/importar"
          className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition"
        >
          <Upload className="w-4 h-4" />
          Ir para Importação
        </Link>
      </div>

      {/* Logs de Atividade */}
      <div className="bg-white rounded-xl shadow p-4 mb-4">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <Activity className="w-5 h-5 text-gray-500" />
          Atividade Recente
          {logsTotal > 0 && (
            <span className="ml-auto text-xs text-gray-400 font-normal">{logsTotal} registro(s)</span>
          )}
        </h2>

        {logs.length === 0 && !logsCarregando ? (
          <p className="text-sm text-gray-400 text-center py-6">Nenhuma atividade registrada ainda</p>
        ) : (
          <div className="space-y-2">
            {logs.map((entry) => {
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
                    <p className="text-xs text-gray-400 mt-0.5">{entry.tabela} · {dataStr} às {horaStr}</p>
                  </div>
                  {entry.valor != null && (
                    <span className="shrink-0 text-sm font-medium text-gray-600">
                      R$ {entry.valor.toFixed(2)}
                    </span>
                  )}
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

      {/* Logout */}
      <div className="bg-white rounded-xl shadow p-4">
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-3 text-red-600 font-semibold hover:bg-red-50 rounded-xl transition"
        >
          <LogOut className="w-5 h-5" />
          Sair da conta
        </button>
      </div>
      <BottomNav />
    </div>
  )
}
