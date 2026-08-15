'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { Upload, CheckCircle2, XCircle, Sparkles, Clock, AlertCircle, ShieldCheck, Trash2, Code2, Copy, Check, X, FileSpreadsheet, RotateCcw, Search, Calendar, Info, ChevronDown, ChevronUp } from 'lucide-react'
import { useCategorizacao } from '@/components/CategorizacaoProvider'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth } from 'date-fns'
import FilterSelect from '@/components/FilterSelect'
import { numericOnly } from '@/lib/logger'

interface StatsFatura {
  noCSV: number
  inseridas: number
  ignoradas: number
  totalNoBanco: number
}

interface AssinaturaAtualizada {
  nome: string
  valorAnterior: number
  valorNovo: number
}

interface Resumo {
  matheus: number
  jeniffer: number
  total: string
  novas: number
  duplicatasNoArquivo: number
  totalLidas: number
  mesesSobrescritos: string[]
  resumoPorFatura?: Record<string, StatsFatura>
  assinaturasAtualizadas?: AssinaturaAtualizada[]
}

interface Atividade {
  id: string
  descricao: string
  valor: number | null
  created_at: string
}

type DecisaoValidacao =
  | 'inserida' | 'removida' | 'duplicada' | 'conflito'
  | 'conciliada' | 'conciliacao_desfeita'
  | 'estorno_aplicado' | 'estorno_registrado' | 'estorno_removido' | 'estorno_ignorado'

interface RegistroConflitante {
  id: string
  descricao: string
  valor: number
  data_compra: string
  status: string
}

const STATUS_LABELS: Record<string, string> = {
  PENDENTE: 'pendente',
  CONCILIADO: 'conciliada',
  CONFLITO_VALOR: 'em conflito',
  ESTORNO: 'estorno',
  ESTORNADO: 'estornada',
}

interface LinhaValidacao {
  id: string
  descricao: string
  valor: number | null
  data_compra: string | null
  decisao: DecisaoValidacao
  transacao_id: string | null
  notificacao_id: string | null
  registro_conflitante: RegistroConflitante | null
  revertido_em: string | null
  created_at: string
}

const DECISAO_INFO: Record<DecisaoValidacao, { label: string; classes: string }> = {
  inserida: { label: 'Nova transação', classes: 'bg-green-50 text-green-700 border-green-100' },
  removida: { label: 'Removida manualmente', classes: 'bg-gray-100 text-gray-500 border-gray-200' },
  duplicada: { label: 'Já existia no banco', classes: 'bg-gray-50 text-gray-500 border-gray-100' },
  conflito: { label: 'Conflito de valor', classes: 'bg-amber-50 text-amber-700 border-amber-100' },
  conciliada: { label: 'Conciliada com pendente existente', classes: 'bg-blue-50 text-blue-700 border-blue-100' },
  conciliacao_desfeita: { label: 'Conciliação desfeita manualmente', classes: 'bg-gray-100 text-gray-500 border-gray-200' },
  estorno_aplicado: { label: 'Estorno aplicado', classes: 'bg-purple-50 text-purple-700 border-purple-100' },
  estorno_registrado: { label: 'Estorno sem correspondência', classes: 'bg-purple-50 text-purple-700 border-purple-100' },
  estorno_removido: { label: 'Estorno removido', classes: 'bg-gray-100 text-gray-500 border-gray-200' },
  estorno_ignorado: { label: 'Estorno duplicado', classes: 'bg-gray-50 text-gray-500 border-gray-100' },
}

function acaoParaLinha(decisao: DecisaoValidacao): { label: string; acao: 'reverter' | 'reaplicar'; destrutiva: boolean } | null {
  switch (decisao) {
    case 'inserida': return { label: 'Remover', acao: 'reverter', destrutiva: true }
    case 'removida': return { label: 'Reinserir', acao: 'reaplicar', destrutiva: false }
    case 'duplicada': return { label: 'Inserir mesmo assim', acao: 'reaplicar', destrutiva: false }
    case 'conciliada': return { label: 'Desfazer conciliação', acao: 'reverter', destrutiva: true }
    case 'conciliacao_desfeita': return { label: 'Reaplicar conciliação', acao: 'reaplicar', destrutiva: false }
    case 'estorno_aplicado':
    case 'estorno_registrado': return { label: 'Remover estorno', acao: 'reverter', destrutiva: true }
    case 'estorno_removido': return { label: 'Reaplicar', acao: 'reaplicar', destrutiva: false }
    case 'estorno_ignorado': return { label: 'Inserir mesmo assim', acao: 'reaplicar', destrutiva: false }
    default: return null
  }
}

interface DiagnosticoPar {
  descricao: string
  valor: number
  data_a: string
  data_b: string
  dias: number
  fatura_a: string
  fatura_b: string
  mesmaFatura: boolean
}

interface Diagnostico {
  totalPares: number
  mesmaFatura: number
  faturasDiferentes: number
  porFatura: Record<string, number>
  pares: DiagnosticoPar[]
}

interface DivergenciaParcela {
  id: string
  descricao: string
  valor: number
  projeto_fatura: string
  responsavel: string | null
  parcela_atual_atual: number | null
  total_parcelas_atual: number | null
  parcela_atual_correta: number | null
  total_parcelas_correta: number | null
}

interface DiagnosticoParcelas {
  total: number
  deixavamDeSerParcela: number
  viravamParcela: number
  numerosDiferentes: number
  divergencias: DivergenciaParcela[]
}

interface ArquivoDetalheScript {
  assunto: string | null
  arquivo: string | null
  enviado: boolean
  tentativas?: number
  erro: string | null
}

interface ResumoImportacaoScript {
  emailsEncontrados: number
  arquivoEncontrado: boolean
  totalArquivosCsv: number
  arquivosEnviadosComSucesso: number
  arquivosComFalha: number
  detalhes: ArquivoDetalheScript[]
  sucessoGeral: boolean
}

interface StatusExecucaoScript {
  status: 'running' | 'success' | 'error' | null
  origem?: 'api' | 'job'
  iniciadoEm?: string | null
  finalizadoEm?: string | null
  resumo?: ResumoImportacaoScript
  erro?: string
}

interface RespostaScript {
  success?: boolean
  sucesso?: boolean
  mensagem?: string
  error?: string
  erro?: string
  emExecucao?: boolean
  arquivoEncontrado?: boolean
  envioComSucesso?: boolean
  resumo?: ResumoImportacaoScript
  status?: StatusExecucaoScript | null
}

type CenarioScript =
  | 'sucesso-total'
  | 'sucesso-parcial'
  | 'nada-para-importar'
  | 'email-sem-anexo'
  | 'erro'
  | 'generico'

function classificarCenarioScript(execucao: StatusExecucaoScript): { cenario: CenarioScript; mensagem: string } {
  if (execucao.status === 'error') {
    return { cenario: 'erro', mensagem: execucao.erro || 'Erro desconhecido na execução do Google Apps Script.' }
  }

  const resumo = execucao.resumo
  if (!resumo) {
    return { cenario: 'generico', mensagem: 'Importação via Google Apps Script concluída com sucesso.' }
  }

  if (!resumo.arquivoEncontrado) {
    return resumo.emailsEncontrados === 0
      ? { cenario: 'nada-para-importar', mensagem: 'Nenhum e-mail novo para importar.' }
      : { cenario: 'email-sem-anexo', mensagem: 'E-mail encontrado, mas sem anexo CSV.' }
  }

  if (resumo.sucessoGeral) {
    return {
      cenario: 'sucesso-total',
      mensagem: `${resumo.arquivosEnviadosComSucesso} arquivo(s) importado(s) com sucesso.`,
    }
  }

  return {
    cenario: 'sucesso-parcial',
    mensagem: `Importação com falhas: ${resumo.arquivosEnviadosComSucesso} enviado(s), ${resumo.arquivosComFalha} com erro.`,
  }
}

function formatarHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function formatarDecorrido(iso: string | null | undefined, agora: number): string {
  if (!iso) return ''
  const inicio = new Date(iso).getTime()
  if (Number.isNaN(inicio)) return ''
  const segundos = Math.max(0, Math.floor((agora - inicio) / 1000))
  if (segundos < 60) return `${segundos}s`
  const minutos = Math.floor(segundos / 60)
  return `${minutos}m ${segundos % 60}s`
}

const ORIGEM_LABELS: Record<string, string> = { api: 'nosso app', job: 'gatilho automático do Apps Script' }

type TipoCartao = 'nubank' | 'cartao1' | 'cartao2'

const CARTAO_LABELS: Record<TipoCartao, string> = {
  nubank: 'NuBank',
  cartao1: 'Cartão 1',
  cartao2: 'Cartão 2',
}

export default function ImportarPage() {
  const [cartaoLabels, setCartaoLabels] = useState<Record<TipoCartao, string>>(CARTAO_LABELS)
  const [cartaoSelecionado, setCartaoSelecionado] = useState<TipoCartao>('nubank')
  const [uploading, setUploading] = useState(false)
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [arrastando, setArrastando] = useState(false)
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null)
  const [atividades, setAtividades] = useState<Atividade[]>([])
  const [detalheLogAberto, setDetalheLogAberto] = useState<string | null>(null)
  const [detalheLinhas, setDetalheLinhas] = useState<LinhaValidacao[] | null>(null)
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false)
  const [filtroBuscaDetalhe, setFiltroBuscaDetalhe] = useState('')
  const [filtroDecisaoDetalhe, setFiltroDecisaoDetalhe] = useState('')
  const [filtroValorMinDetalhe, setFiltroValorMinDetalhe] = useState('')
  const [filtroDataDetalhe, setFiltroDataDetalhe] = useState('')
  const [revertendoId, setRevertendoId] = useState<string | null>(null)
  const [confirmarAcao, setConfirmarAcao] = useState<{ linhaId: string; acao: 'reverter' | 'reaplicar' } | null>(null)
  const [erroLinha, setErroLinha] = useState<{ id: string; mensagem: string } | null>(null)
  const [diagnostico, setDiagnostico] = useState<Diagnostico | null>(null)
  const [diagnosticando, setDiagnosticando] = useState(false)
  const [diagnosticoExpandido, setDiagnosticoExpandido] = useState(false)
  const [pendingModo, setPendingModo] = useState<'conservador' | 'completo' | null>(null)
  const [corrigindo, setCorrigindo] = useState(false)
  const [resultadoCorrecao, setResultadoCorrecao] = useState<{ removidos: number; mensagem: string } | null>(null)
  const [diagnosticoParcelas, setDiagnosticoParcelas] = useState<DiagnosticoParcelas | null>(null)
  const [diagnosticandoParcelas, setDiagnosticandoParcelas] = useState(false)
  const [parcelasExpandido, setParcelasExpandido] = useState(false)
  const [confirmarCorrecaoParcelas, setConfirmarCorrecaoParcelas] = useState(false)
  const [corrigindoParcelas, setCorrigindoParcelas] = useState(false)
  const [resultadoCorrecaoParcelas, setResultadoCorrecaoParcelas] = useState<{ corrigidos: number; mensagem: string } | null>(null)
  const [modalApiAberto, setModalApiAberto] = useState(false)
  const [copiado, setCopiado] = useState<string | null>(null)
  const [disparandoScript, setDisparandoScript] = useState(false)
  const [scriptErro, setScriptErro] = useState<string | null>(null)
  const [scriptExecucao, setScriptExecucao] = useState<StatusExecucaoScript | null>(null)
  const [scriptDetalhesAbertos, setScriptDetalhesAbertos] = useState(false)
  const [agoraTick, setAgoraTick] = useState(() => Date.now())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollScriptRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { categorizando, categorizadoMsg, categorizar } = useCategorizacao()

  // Usuário acessou a tela de importação → limpa notificações de importação concluída
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.ready
      .then(reg => reg.active?.postMessage({ type: 'CLOSE_IMPORT_NOTIFICATIONS' }))
      .catch(() => {})
  }, [])

  async function executarDiagnostico() {
    setDiagnosticando(true)
    setDiagnostico(null)
    setResultadoCorrecao(null)
    setPendingModo(null)
    try {
      const res = await fetch('/api/import/diagnostico')
      if (res.ok) {
        const data = await res.json()
        setDiagnostico(data)
        setDiagnosticoExpandido(data.totalPares > 0)
      }
    } catch { /* silencioso */ } finally {
      setDiagnosticando(false)
    }
  }

  async function confirmarCorrecao() {
    if (!pendingModo) return
    setCorrigindo(true)
    try {
      const res = await fetch('/api/import/diagnostico/corrigir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modo: pendingModo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro desconhecido')
      setResultadoCorrecao(data)
      // Re-run diagnostic to show updated state
      await executarDiagnostico()
    } catch (e) {
      setResultadoCorrecao({ removidos: -1, mensagem: String(e) })
    } finally {
      setCorrigindo(false)
      setPendingModo(null)
    }
  }

  async function executarDiagnosticoParcelas() {
    setDiagnosticandoParcelas(true)
    setDiagnosticoParcelas(null)
    setResultadoCorrecaoParcelas(null)
    setConfirmarCorrecaoParcelas(false)
    try {
      const res = await fetch('/api/import/diagnostico/parcelas')
      if (res.ok) {
        const data = await res.json()
        setDiagnosticoParcelas(data)
        setParcelasExpandido(data.total > 0)
      }
    } catch { /* silencioso */ } finally {
      setDiagnosticandoParcelas(false)
    }
  }

  async function aplicarCorrecaoParcelas() {
    setCorrigindoParcelas(true)
    try {
      const res = await fetch('/api/import/diagnostico/corrigir-parcelas', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro desconhecido')
      setResultadoCorrecaoParcelas(data)
      await executarDiagnosticoParcelas()
    } catch (e) {
      setResultadoCorrecaoParcelas({ corrigidos: -1, mensagem: e instanceof Error ? e.message : String(e) })
    } finally {
      setCorrigindoParcelas(false)
      setConfirmarCorrecaoParcelas(false)
    }
  }

  const pararPollingScript = useCallback(() => {
    if (pollScriptRef.current) {
      clearTimeout(pollScriptRef.current)
      pollScriptRef.current = null
    }
  }, [])

  const consultarStatusScript = useCallback(async (agendarProximo: boolean) => {
    try {
      const res = await fetch('/api/import/google-apps-script')
      const data: RespostaScript = await res.json()
      const execucao = data.status ?? null
      setScriptExecucao(execucao)

      if (execucao?.status === 'running') {
        if (agendarProximo) {
          pollScriptRef.current = setTimeout(() => consultarStatusScript(true), 4000)
        }
        return
      }
      if (execucao?.status === 'success') {
        setScriptErro(null)
        carregarAtividades()
      }
      pararPollingScript()
    } catch { /* silencioso — tentativa seguinte do polling cobre falhas passageiras */ }
  }, [pararPollingScript])

  useEffect(() => {
    consultarStatusScript(false)
    return () => pararPollingScript()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Enquanto uma execução está rodando, atualiza o "tempo decorrido" no aviso.
  useEffect(() => {
    if (scriptExecucao?.status !== 'running') return
    const id = setInterval(() => setAgoraTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [scriptExecucao?.status])

  async function dispararGoogleAppsScript() {
    setDisparandoScript(true)
    setScriptErro(null)
    setScriptDetalhesAbertos(false)
    pararPollingScript()
    try {
      const res = await fetch('/api/import/google-apps-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cartao: cartaoSelecionado }),
      })
      const data: RespostaScript = await res.json()

      if (res.status === 409 || data.emExecucao) {
        // Já existe uma execução em andamento (pode ter sido disparada por outro
        // acionamento ou pelo gatilho de tempo do Apps Script) — não é um erro.
        setScriptExecucao(data.status ?? { status: 'running' })
        pollScriptRef.current = setTimeout(() => consultarStatusScript(true), 4000)
        return
      }
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Erro desconhecido')

      // Disparo aceito — a execução real roda em background; acompanha via polling.
      setAgoraTick(Date.now())
      setScriptExecucao({ status: 'running', iniciadoEm: new Date().toISOString(), origem: 'api' })
      pollScriptRef.current = setTimeout(() => consultarStatusScript(true), 4000)
    } catch (e) {
      setScriptErro(e instanceof Error ? e.message : String(e))
    } finally {
      setDisparandoScript(false)
    }
  }

  const cenarioScript = useMemo(() => {
    if (!scriptExecucao || scriptExecucao.status === 'running') return null
    return classificarCenarioScript(scriptExecucao)
  }, [scriptExecucao])

  function copiarTexto(chave: string, texto: string) {
    navigator.clipboard.writeText(texto).catch(() => {})
    setCopiado(chave)
    setTimeout(() => setCopiado(null), 2000)
  }

  async function carregarAtividades() {
    try {
      const res = await fetch('/api/nubank/atividades')
      if (res.ok) {
        const data = await res.json()
        setAtividades(data.atividades ?? [])
      }
    } catch { /* silencioso */ }
  }

  async function abrirDetalhesLog(id: string) {
    setDetalheLogAberto(id)
    setDetalheLinhas(null)
    setCarregandoDetalhe(true)
    setConfirmarAcao(null)
    setErroLinha(null)
    setFiltroBuscaDetalhe('')
    setFiltroDecisaoDetalhe('')
    setFiltroValorMinDetalhe('')
    setFiltroDataDetalhe('')
    try {
      const res = await fetch(`/api/nubank/atividades/${id}/detalhes`)
      const data = res.ok ? await res.json() : { linhas: [] }
      setDetalheLinhas(data.linhas ?? [])
    } catch {
      setDetalheLinhas([])
    } finally {
      setCarregandoDetalhe(false)
    }
  }

  function fecharDetalhes() {
    setDetalheLogAberto(null)
    setDetalheLinhas(null)
    setConfirmarAcao(null)
    setErroLinha(null)
    setFiltroBuscaDetalhe('')
    setFiltroDecisaoDetalhe('')
    setFiltroValorMinDetalhe('')
    setFiltroDataDetalhe('')
  }

  const detalheLinhasFiltradas = useMemo(() => {
    if (!detalheLinhas) return detalheLinhas
    const busca = filtroBuscaDetalhe.trim().toLowerCase()
    return detalheLinhas.filter(l =>
      (!busca || l.descricao.toLowerCase().includes(busca)) &&
      (!filtroDecisaoDetalhe || l.decisao === filtroDecisaoDetalhe) &&
      (!filtroValorMinDetalhe || (l.valor != null && l.valor >= Number(filtroValorMinDetalhe))) &&
      (!filtroDataDetalhe || l.data_compra === filtroDataDetalhe)
    )
  }, [detalheLinhas, filtroBuscaDetalhe, filtroDecisaoDetalhe, filtroValorMinDetalhe, filtroDataDetalhe])

  const filtrosDetalheAtivos = !!filtroBuscaDetalhe || !!filtroDecisaoDetalhe || !!filtroValorMinDetalhe || !!filtroDataDetalhe

  function pedirAcaoLinha(linhaId: string, acao: 'reverter' | 'reaplicar', destrutiva: boolean) {
    if (destrutiva) {
      setConfirmarAcao({ linhaId, acao })
    } else {
      executarAcaoLinha(linhaId, acao)
    }
  }

  async function executarAcaoLinha(linhaId: string, acao: 'reverter' | 'reaplicar') {
    if (!detalheLogAberto) return
    setRevertendoId(linhaId)
    setErroLinha(null)
    try {
      const res = await fetch(`/api/nubank/atividades/${detalheLogAberto}/detalhes/${linhaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro desconhecido')
      setDetalheLinhas(prev => prev ? prev.map(l => (l.id === linhaId ? data.linha : l)) : prev)
    } catch (e) {
      setErroLinha({ id: linhaId, mensagem: e instanceof Error ? e.message : String(e) })
    } finally {
      setRevertendoId(null)
      setConfirmarAcao(null)
    }
  }

  useEffect(() => {
    carregarAtividades()
  }, [])

  useEffect(() => {
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
    carregarLabelsCartao()
  }, [])

  async function processarArquivo(file: File) {
    setNomeArquivo(file.name)
    setUploading(true)
    setResumo(null)
    setErro(null)

    const formData = new FormData()
    formData.append('file', file)

    const endpoint = cartaoSelecionado === 'nubank' ? '/api/import' : '/api/import/cartao'
    if (cartaoSelecionado !== 'nubank') {
      formData.append('cartao', cartaoSelecionado)
    }

    try {
      const response = await fetch(endpoint, { method: 'POST', body: formData })
      const data = await response.json()

      if (data.success) {
        setResumo({
          matheus: data.matheus,
          jeniffer: data.jeniffer,
          total: data.total,
          novas: data.novas,
          duplicatasNoArquivo: data.duplicatasNoArquivo,
          totalLidas: data.totalLidas,
          mesesSobrescritos: data.mesesReprocessados ?? data.mesesSobrescritos ?? [],
          resumoPorFatura: data.resumoPorFatura,
          assinaturasAtualizadas: data.assinaturasAtualizadas ?? [],
        })
        carregarAtividades()
      } else {
        setErro(data.error || 'Erro desconhecido')
      }
    } catch (error) {
      setErro('Erro ao processar arquivo: ' + String(error))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processarArquivo(file)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setArrastando(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.name.endsWith('.csv')) processarArquivo(file)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setArrastando(true)
  }, [])

  const handleDragLeave = useCallback(() => setArrastando(false), [])

  return (
    <div className="min-h-screen bg-gray-50 page-content page-bottom-safe page-enter">
      <div className="sticky top-0 lg:top-14 sticky-header pt-3 pb-3 z-10">
        <h1 className="text-xl font-bold text-gray-900 mb-0.5">Importar CSV</h1>
        <p className="text-sm text-gray-400">Selecione o cartão e faça upload do arquivo</p>
      </div>

      {/* Seletor de cartão */}
      <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-1 mb-4 flex gap-1">
        {(Object.keys(cartaoLabels) as TipoCartao[]).map(tipo => (
          <button
            key={tipo}
            onClick={() => { setCartaoSelecionado(tipo); setResumo(null); setErro(null) }}
            className={`flex-1 py-2 px-3 rounded-xl text-sm font-semibold transition-all active:scale-[0.97] ${
              cartaoSelecionado === tipo
                ? 'bg-primary-600 text-white shadow-sm'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {cartaoLabels[tipo]}
          </button>
        ))}
      </div>

      {/* Zona de drop */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`bg-white rounded-3xl border-2 border-dashed transition-all cursor-pointer p-8 text-center mb-4 shadow-card ${
          uploading
            ? 'border-primary-200 bg-primary-50/40 cursor-default'
            : arrastando
              ? 'border-primary-400 bg-primary-50 scale-[1.01]'
              : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50/60 active:scale-[0.99]'
        }`}
      >
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileInput} className="hidden" disabled={uploading} />

        {uploading ? (
          <div className="flex flex-col items-center gap-4">
            {/* Skeleton animado de progresso */}
            <div className="relative w-14 h-14 flex items-center justify-center">
              <div className="absolute inset-0 rounded-2xl bg-primary-50 border border-primary-100" />
              <div className="w-6 h-6 rounded-full border-[3px] border-primary-200 border-t-primary-600 animate-spin" />
            </div>
            <div className="space-y-1.5 text-center">
              <p className="text-sm font-semibold text-primary-700">Processando arquivo…</p>
              <p className="text-xs text-gray-400 truncate max-w-[200px] mx-auto">{nomeArquivo}</p>
              <p className="text-xs text-gray-400">Lendo, validando e inserindo — aguarde</p>
            </div>
            <div className="w-40 h-1.5 bg-primary-100 rounded-full overflow-hidden">
              <div className="h-full bg-primary-400 rounded-full animate-pulse w-2/3" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border transition-colors ${
              arrastando ? 'bg-primary-50 border-primary-200' : 'bg-gray-50 border-gray-100'
            }`}>
              <Upload className={`w-6 h-6 transition-colors ${arrastando ? 'text-primary-500' : 'text-gray-400'}`} />
            </div>
            <div>
              <p className="font-semibold text-gray-700 text-sm">
                {arrastando ? 'Solte o arquivo aqui' : `Arraste o CSV do ${cartaoLabels[cartaoSelecionado]}`}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">ou toque para selecionar</p>
            </div>
            <span className="text-xs bg-gray-100 text-gray-500 px-3 py-1 rounded-full font-mono">.csv</span>
          </div>
        )}
      </div>

      {/* Dica de formato */}
      {cartaoSelecionado === 'nubank' ? (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 mb-4 text-xs text-blue-700 space-y-0.5">
          <p className="font-semibold text-blue-800">Como exportar do Nubank</p>
          <p className="text-blue-600">Nubank → Minha conta → Exportar gastos → Período → Baixar CSV</p>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 mb-4 text-xs text-amber-700 space-y-1">
          <p className="font-semibold text-amber-800">Formato esperado para {cartaoLabels[cartaoSelecionado]}</p>
          <p>Colunas: <span className="font-mono bg-amber-100 px-1 rounded">date, title, amount</span> — ou — <span className="font-mono bg-amber-100 px-1 rounded">Data, Descrição, Valor</span></p>
          <p>Parcelas detectadas pelo padrão <span className="font-mono bg-amber-100 px-1 rounded">X/Y</span> na descrição (ex: 2/12).</p>
        </div>
      )}

      {/* Importar via Google Apps Script */}
      <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-5 mb-4">
        <h2 className="text-sm font-bold text-gray-900 mb-1 flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-gray-500" />
          Importar via Google Sheets
        </h2>
        <p className="text-xs text-gray-400 mb-4 leading-relaxed">
          Aciona o Web App do Google Apps Script para enviar os dados da planilha do {cartaoLabels[cartaoSelecionado]} diretamente para nossa API.
        </p>
        <button
          onClick={dispararGoogleAppsScript}
          disabled={disparandoScript || scriptExecucao?.status === 'running'}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white py-3 rounded-2xl font-semibold hover:bg-emerald-700 transition-all disabled:opacity-50 active:scale-[0.98] shadow-sm"
        >
          <FileSpreadsheet className={`w-4 h-4 ${disparandoScript || scriptExecucao?.status === 'running' ? 'animate-pulse' : ''}`} />
          {disparandoScript
            ? 'Acionando Web App…'
            : scriptExecucao?.status === 'running'
              ? 'Importação em andamento…'
              : 'Importar via Google Apps Script'}
        </button>

        {/* Rodando */}
        {scriptExecucao?.status === 'running' && (
          <div className="mt-3 bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 text-sm text-blue-700 flex items-center gap-2.5">
            <span className="w-4 h-4 shrink-0 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />
            <span>
              Importação em andamento — iniciada às {formatarHora(scriptExecucao.iniciadoEm)}
              {scriptExecucao.origem ? ` (${ORIGEM_LABELS[scriptExecucao.origem] ?? scriptExecucao.origem})` : ''}
              {formatarDecorrido(scriptExecucao.iniciadoEm, agoraTick) && ` · há ${formatarDecorrido(scriptExecucao.iniciadoEm, agoraTick)}`}.
              {' '}Verifique novamente em alguns instantes.
            </span>
          </div>
        )}

        {/* Sucesso total */}
        {cenarioScript?.cenario === 'sucesso-total' && (
          <div className="mt-3 bg-green-50 border border-green-100 rounded-2xl px-4 py-3 text-sm text-green-700 flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600" />
            {cenarioScript.mensagem}
          </div>
        )}

        {/* Nada para importar — estado neutro, não é erro */}
        {cenarioScript?.cenario === 'nada-para-importar' && (
          <div className="mt-3 bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3 text-sm text-gray-500 flex items-center gap-2.5">
            <Info className="w-4 h-4 shrink-0 text-gray-400" />
            {cenarioScript.mensagem}
          </div>
        )}

        {/* E-mail encontrado mas sem CSV anexado — aviso */}
        {cenarioScript?.cenario === 'email-sem-anexo' && (
          <div className="mt-3 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3 text-sm text-amber-700 flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
            {cenarioScript.mensagem}
          </div>
        )}

        {/* Sucesso parcial — alguns arquivos falharam */}
        {cenarioScript?.cenario === 'sucesso-parcial' && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <span className="text-sm font-semibold text-amber-900">{cenarioScript.mensagem}</span>
              </div>
              <button
                onClick={() => setScriptDetalhesAbertos(v => !v)}
                className="text-xs text-amber-700 font-semibold shrink-0 flex items-center gap-0.5 underline underline-offset-2 hover:opacity-70 transition-opacity"
              >
                {scriptDetalhesAbertos ? 'Ocultar' : 'Ver detalhes'}
                {scriptDetalhesAbertos ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
            {scriptDetalhesAbertos && (
              <div className="mt-3 space-y-2">
                {scriptExecucao?.resumo?.detalhes.filter(d => !d.enviado).map((d, i) => (
                  <div key={i} className="bg-white rounded-xl p-3 text-xs border border-amber-100">
                    <p className="font-semibold text-gray-800 truncate">{d.arquivo ?? d.assunto ?? 'Arquivo'}</p>
                    {d.assunto && d.arquivo && <p className="text-gray-400 mt-0.5">{d.assunto}</p>}
                    <p className="text-red-600 mt-1">
                      {d.erro ?? 'Erro desconhecido'}
                      {d.tentativas ? ` (após ${d.tentativas} tentativa(s))` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Erro na execução (Apps Script rodou e falhou) */}
        {cenarioScript?.cenario === 'erro' && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700 flex items-center gap-2.5">
            <XCircle className="w-4 h-4 shrink-0 text-red-500" />
            {cenarioScript.mensagem}
          </div>
        )}

        {/* Erro ao disparar (configuração, token ou rede) — antes de qualquer execução */}
        {scriptErro && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700 flex items-center gap-2.5">
            <XCircle className="w-4 h-4 shrink-0 text-red-500" />
            {scriptErro}
          </div>
        )}
      </div>

      {/* Erro de importação com causa e ação */}
      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3 mb-4">
          <div className="w-8 h-8 rounded-xl bg-red-100 border border-red-200 flex items-center justify-center shrink-0 mt-0.5">
            <XCircle className="w-4 h-4 text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-red-800 text-sm">Falha na importação</p>
            <p className="text-red-600 text-xs mt-1 leading-relaxed">{erro}</p>
            <p className="text-red-400 text-xs mt-1.5">Verifique o formato do arquivo e tente novamente.</p>
          </div>
        </div>
      )}

      {/* Botão IA */}
      <button
        onClick={categorizar}
        disabled={categorizando}
        className="w-full flex items-center justify-center gap-2 bg-violet-600 text-white py-3 rounded-2xl font-semibold hover:bg-violet-700 transition-all disabled:opacity-50 active:scale-[0.98] shadow-sm mb-4"
      >
        <Sparkles className={`w-4 h-4 ${categorizando ? 'animate-pulse' : ''}`} />
        {categorizando ? 'Categorizando com IA…' : 'Categorizar com IA'}
      </button>

      {categorizadoMsg && (
        <div className="bg-violet-50 border border-violet-200 rounded-2xl px-4 py-3 mb-4 text-sm text-violet-700 text-center font-medium">
          {categorizadoMsg}
        </div>
      )}

      {resumo && (
        <div className="bg-white rounded-3xl shadow-card border border-gray-100 p-5 space-y-4 mb-4">
          {/* Cabeçalho */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-green-50 border border-green-100 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 leading-tight">Importação concluída</p>
              <p className="text-xs text-gray-400">Arquivo processado com sucesso</p>
            </div>
          </div>

          {/* Grid: lidas / novas */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 text-center">
              <p className="text-2xl font-bold text-gray-800 num leading-none">{resumo.totalLidas}</p>
              <p className="text-xs text-gray-500 mt-1">Lidas no arquivo</p>
            </div>
            <div className="bg-green-50 border border-green-100 rounded-2xl p-3 text-center">
              <p className="text-2xl font-bold text-green-700 num leading-none">{resumo.novas}</p>
              <p className="text-xs text-gray-500 mt-1">Novas importadas</p>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 text-center">
              <p className="text-2xl font-bold text-blue-700 num leading-none">{resumo.matheus}</p>
              <p className="text-xs text-gray-500 mt-1">Matheus</p>
            </div>
            <div className="bg-pink-50 border border-pink-100 rounded-2xl p-3 text-center">
              <p className="text-2xl font-bold text-pink-600 num leading-none">{resumo.jeniffer}</p>
              <p className="text-xs text-gray-500 mt-1">Jeniffer</p>
            </div>
          </div>

          {/* Total */}
          <div className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-2xl px-4 py-3">
            <span className="text-sm text-gray-500">Valor total importado</span>
            <span className="font-bold text-gray-900 num">R$ {resumo.total}</span>
          </div>

          {resumo.mesesSobrescritos.length > 0 && (
            <div className="pt-1">
              <p className="text-xs text-amber-700 font-semibold mb-1.5">Meses reprocessados</p>
              <div className="flex flex-wrap gap-1">
                {resumo.mesesSobrescritos.map(m => (
                  <span key={m} className="text-xs bg-amber-50 border border-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                    {m.substring(0, 7)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {resumo.assinaturasAtualizadas && resumo.assinaturasAtualizadas.length > 0 && (
            <div className="pt-1">
              <p className="text-xs text-amber-700 font-semibold mb-1.5">
                {resumo.assinaturasAtualizadas.length} assinatura(s) atualizada(s) com o valor da fatura
              </p>
              <div className="space-y-1">
                {resumo.assinaturasAtualizadas.map((a, i) => (
                  <div key={i} className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-xl px-3 py-1.5 text-xs">
                    <span className="text-amber-800 font-medium truncate">{a.nome}</span>
                    <span className="text-amber-700 num shrink-0 ml-2">
                      R$ {a.valorAnterior.toFixed(2)} → R$ {a.valorNovo.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {resumo.duplicatasNoArquivo > 0 && (
            <p className="text-xs text-gray-400 text-center">
              {resumo.duplicatasNoArquivo} linha(s) ignorada(s) — já existiam no banco
            </p>
          )}

          {resumo.resumoPorFatura && Object.keys(resumo.resumoPorFatura).length > 0 && (
            <div className="pt-1 space-y-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Verificação por fatura</p>
              {Object.entries(resumo.resumoPorFatura)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([fatura, stats]) => {
                  const label = new Date(fatura + 'T12:00:00')
                    .toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
                    .replace(/^\w/, c => c.toUpperCase())
                  const temExcesso = stats.totalNoBanco > stats.noCSV
                  return (
                    <div key={fatura} className={`rounded-2xl p-3 text-xs space-y-2 ${temExcesso ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50 border border-gray-100'}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-700">{label}</span>
                        {temExcesso
                          ? <span className="text-amber-600 font-semibold">Banco &gt; CSV</span>
                          : <span className="text-green-600 font-semibold">OK</span>
                        }
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-center">
                        <div>
                          <p className="font-bold text-gray-700 num">{stats.noCSV}</p>
                          <p className="text-gray-400 mt-0.5">no CSV</p>
                        </div>
                        <div>
                          <p className="font-bold text-green-700 num">{stats.inseridas}</p>
                          <p className="text-gray-400 mt-0.5">inseridas</p>
                        </div>
                        <div>
                          <p className="font-bold text-gray-500 num">{stats.ignoradas}</p>
                          <p className="text-gray-400 mt-0.5">ignoradas</p>
                        </div>
                        <div>
                          <p className={`font-bold num ${temExcesso ? 'text-amber-700' : 'text-gray-700'}`}>{stats.totalNoBanco}</p>
                          <p className="text-gray-400 mt-0.5">no banco</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      )}

      {/* Seção: Dados Históricos */}
      <div className="mt-2">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-gray-400" />
          <h2 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Dados Históricos</h2>
        </div>

        <button
          onClick={executarDiagnostico}
          disabled={diagnosticando}
          className="w-full flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 py-3 rounded-2xl font-medium hover:bg-gray-50 transition-all disabled:opacity-50 mb-3 text-sm shadow-card active:scale-[0.98]"
        >
          <ShieldCheck className={`w-4 h-4 ${diagnosticando ? 'animate-pulse text-primary-500' : ''}`} />
          {diagnosticando ? 'Verificando duplicatas…' : 'Verificar duplicatas históricas (±3 dias)'}
        </button>

        {diagnostico && (
          <div className={`rounded-2xl p-4 mb-4 ${diagnostico.totalPares > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-100'}`}>
            {diagnostico.totalPares === 0 ? (
              <div className="flex items-center gap-2.5 text-green-700">
                <div className="w-7 h-7 rounded-xl bg-green-100 border border-green-200 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <span className="text-sm font-semibold">Nenhuma duplicata histórica detectada</span>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0 mt-0.5">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-amber-900">
                        {diagnostico.totalPares} duplicata(s) detectada(s)
                      </p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        {diagnostico.mesmaFatura} mesma fatura · {diagnostico.faturasDiferentes} faturas diferentes
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setDiagnosticoExpandido(v => !v)}
                    className="text-xs text-amber-700 font-semibold shrink-0 underline underline-offset-2 transition-opacity hover:opacity-70"
                  >
                    {diagnosticoExpandido ? 'Ocultar' : 'Ver detalhes'}
                  </button>
                </div>

                {/* Resultado da correção */}
                {resultadoCorrecao && (
                  <div className={`mt-3 rounded-xl p-3 text-sm flex items-center gap-2.5 ${resultadoCorrecao.removidos >= 0 ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                    {resultadoCorrecao.removidos >= 0
                      ? <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600" />
                      : <XCircle className="w-4 h-4 shrink-0 text-red-500" />
                    }
                    <span className="font-medium">{resultadoCorrecao.mensagem}</span>
                  </div>
                )}

                {/* Confirmação de exclusão */}
                {pendingModo ? (
                  <div className="mt-3 bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
                    <p className="text-sm font-bold text-red-800">Confirmar exclusão permanente</p>
                    <p className="text-xs text-red-700 leading-relaxed">
                      {pendingModo === 'conservador'
                        ? `Serão removidos duplicados da mesma fatura (${diagnostico.mesmaFatura} par(es)). O registro mais recente e/ou categorizado manualmente é mantido.`
                        : `Serão removidos todos os ${diagnostico.totalPares} pares, incluindo ${diagnostico.faturasDiferentes} em faturas diferentes. Isso altera os totais por fatura.`
                      }
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={confirmarCorrecao}
                        disabled={corrigindo}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-red-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-red-700 transition-all disabled:opacity-50 active:scale-[0.97]"
                      >
                        <Trash2 className={`w-3.5 h-3.5 ${corrigindo ? 'animate-pulse' : ''}`} />
                        {corrigindo ? 'Removendo…' : 'Confirmar exclusão'}
                      </button>
                      <button
                        onClick={() => setPendingModo(null)}
                        disabled={corrigindo}
                        className="flex-1 bg-white border border-gray-200 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-all disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setPendingModo('conservador')}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-amber-500 text-white py-2.5 rounded-xl text-xs font-semibold hover:bg-amber-600 transition-all active:scale-[0.97]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Mesma fatura
                      <span className="bg-amber-400 px-1.5 py-0.5 rounded-full font-bold">{diagnostico.mesmaFatura}</span>
                    </button>
                    {diagnostico.faturasDiferentes > 0 && (
                      <button
                        onClick={() => setPendingModo('completo')}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-red-500 text-white py-2.5 rounded-xl text-xs font-semibold hover:bg-red-600 transition-all active:scale-[0.97]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Tudo
                        <span className="bg-red-400 px-1.5 py-0.5 rounded-full font-bold">{diagnostico.totalPares}</span>
                      </button>
                    )}
                  </div>
                )}

                {diagnosticoExpandido && (
                  <div className="mt-3 space-y-2">
                    {diagnostico.pares.map((p, i) => (
                      <div key={i} className="bg-white rounded-xl p-3 text-xs space-y-1.5 border border-amber-100">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-gray-800 truncate">{p.descricao}</span>
                          <span className="text-gray-600 font-mono shrink-0">R$ {Number(p.valor).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-gray-400 flex-wrap">
                          <span>{p.data_a}</span>
                          <span className="text-gray-300">→</span>
                          <span>{p.data_b}</span>
                          <span className="text-amber-600 font-medium">({p.dias}d)</span>
                          {!p.mesmaFatura && (
                            <span className="text-red-500 font-semibold bg-red-50 px-1.5 py-0.5 rounded-full">faturas distintas</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Seção: Parcelas divergentes */}
      <div className="mt-2">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-gray-400" />
          <h2 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Parcelamentos</h2>
        </div>

        <button
          onClick={executarDiagnosticoParcelas}
          disabled={diagnosticandoParcelas}
          className="w-full flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-700 py-3 rounded-2xl font-medium hover:bg-gray-50 transition-all disabled:opacity-50 mb-3 text-sm shadow-card active:scale-[0.98]"
        >
          <ShieldCheck className={`w-4 h-4 ${diagnosticandoParcelas ? 'animate-pulse text-primary-500' : ''}`} />
          {diagnosticandoParcelas ? 'Verificando parcelamentos…' : 'Verificar parcelamentos indevidos'}
        </button>

        {diagnosticoParcelas && (
          <div className={`rounded-2xl p-4 mb-4 ${diagnosticoParcelas.total > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-100'}`}>
            {diagnosticoParcelas.total === 0 ? (
              <div className="flex items-center gap-2.5 text-green-700">
                <div className="w-7 h-7 rounded-xl bg-green-100 border border-green-200 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <span className="text-sm font-semibold">Nenhuma transação com parcelamento divergente</span>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0 mt-0.5">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-amber-900">
                        {diagnosticoParcelas.total} transação(ões) com parcelamento divergente
                      </p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        {diagnosticoParcelas.deixavamDeSerParcela} contadas como parcela indevidamente · {diagnosticoParcelas.viravamParcela} deveriam ser parcela e não estavam marcadas · {diagnosticoParcelas.numerosDiferentes} com número de parcela errado
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setParcelasExpandido(v => !v)}
                    className="text-xs text-amber-700 font-semibold shrink-0 underline underline-offset-2 transition-opacity hover:opacity-70"
                  >
                    {parcelasExpandido ? 'Ocultar' : 'Ver detalhes'}
                  </button>
                </div>

                {resultadoCorrecaoParcelas && (
                  <div className={`mt-3 rounded-xl p-3 text-sm flex items-center gap-2.5 ${resultadoCorrecaoParcelas.corrigidos >= 0 ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                    {resultadoCorrecaoParcelas.corrigidos >= 0
                      ? <CheckCircle2 className="w-4 h-4 shrink-0 text-green-600" />
                      : <XCircle className="w-4 h-4 shrink-0 text-red-500" />
                    }
                    <span className="font-medium">{resultadoCorrecaoParcelas.mensagem}</span>
                  </div>
                )}

                {confirmarCorrecaoParcelas ? (
                  <div className="mt-3 bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
                    <p className="text-sm font-bold text-red-800">Confirmar correção</p>
                    <p className="text-xs text-red-700 leading-relaxed">
                      Serão atualizados {diagnosticoParcelas.total} registro(s) de transacoes_nubank (campos parcela_atual/total_parcelas), recalculados a partir da descrição de cada compra. Isso muda o total &ldquo;comprometido&rdquo; e os limites da tela de Parcelamentos.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={aplicarCorrecaoParcelas}
                        disabled={corrigindoParcelas}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-red-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-red-700 transition-all disabled:opacity-50 active:scale-[0.97]"
                      >
                        <ShieldCheck className={`w-3.5 h-3.5 ${corrigindoParcelas ? 'animate-pulse' : ''}`} />
                        {corrigindoParcelas ? 'Corrigindo…' : 'Confirmar correção'}
                      </button>
                      <button
                        onClick={() => setConfirmarCorrecaoParcelas(false)}
                        disabled={corrigindoParcelas}
                        className="flex-1 bg-white border border-gray-200 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-all disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3">
                    <button
                      onClick={() => setConfirmarCorrecaoParcelas(true)}
                      className="w-full flex items-center justify-center gap-1.5 bg-amber-500 text-white py-2.5 rounded-xl text-xs font-semibold hover:bg-amber-600 transition-all active:scale-[0.97]"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Corrigir {diagnosticoParcelas.total} registro(s)
                    </button>
                  </div>
                )}

                {parcelasExpandido && (
                  <div className="mt-3 space-y-2">
                    {diagnosticoParcelas.divergencias.map((d) => (
                      <div key={d.id} className="bg-white rounded-xl p-3 text-xs space-y-1.5 border border-amber-100">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-gray-800 truncate">{d.descricao}</span>
                          <span className="text-gray-600 font-mono shrink-0">R$ {Number(d.valor).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-gray-400 flex-wrap">
                          <span>{d.responsavel ?? '—'}</span>
                          <span className="text-gray-300">·</span>
                          <span>{d.projeto_fatura}</span>
                          <span className="text-gray-300">·</span>
                          <span className="font-mono">
                            {d.parcela_atual_atual ?? '—'}/{d.total_parcelas_atual ?? '—'}
                          </span>
                          <span className="text-gray-300">→</span>
                          <span className="font-mono text-amber-700 font-semibold">
                            {d.parcela_atual_correta ?? '—'}/{d.total_parcelas_correta ?? '—'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Seção: Atividades recentes */}
      <div className="mt-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-gray-400" />
          <h2 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Atividades Recentes</h2>
        </div>

        {atividades.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 py-8 text-center">
            <p className="text-sm text-gray-400">Nenhuma importação registrada</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden">
            <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
              {atividades.map(a => {
                const isErro = a.descricao.startsWith('ERRO:')
                const descricaoExibida = isErro ? a.descricao.slice(6).trim() : a.descricao
                const data = new Date(a.created_at)
                const dataStr = data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
                const horaStr = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                return (
                  <div
                    key={a.id}
                    onClick={!isErro ? () => abrirDetalhesLog(a.id) : undefined}
                    className={`px-4 py-3 flex items-start gap-3 ${isErro ? 'bg-red-50' : 'cursor-pointer hover:bg-gray-50 active:bg-gray-100 transition-colors'}`}
                  >
                    <div className="shrink-0 mt-0.5">
                      {isErro
                        ? <AlertCircle className="w-4 h-4 text-red-400" />
                        : <CheckCircle2 className="w-4 h-4 text-green-500" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${isErro ? 'text-red-700' : 'text-gray-800'}`}>
                        {descricaoExibida}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{dataStr} · {horaStr}</p>
                    </div>
                    {!isErro && a.valor != null && (
                      <span className="text-sm font-semibold text-green-700 whitespace-nowrap num">
                        R$ {Number(a.valor).toFixed(2).replace('.', ',')}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Integração via API */}
      <div className="mt-4 bg-white rounded-3xl shadow-card border border-gray-100 p-5">
        <h2 className="text-sm font-bold text-gray-900 mb-1 flex items-center gap-2">
          <Code2 className="w-4 h-4 text-gray-500" />
          Integração via API
        </h2>
        <p className="text-xs text-gray-400 mb-4 leading-relaxed">
          Importe transações automaticamente via API REST com autenticação por token Bearer.
        </p>
        <button
          onClick={() => setModalApiAberto(true)}
          className="w-full flex items-center justify-center gap-2 border border-primary-200 text-primary-600 py-3 rounded-2xl font-semibold hover:bg-primary-50 transition-all active:scale-[0.97]"
        >
          <Code2 className="w-4 h-4" />
          Ver instruções de integração
        </button>
      </div>

      {/* Modal: Instruções de Integração via API */}
      {modalApiAberto && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end justify-center z-[200] modal-overlay">
          <div className="bg-white rounded-t-3xl w-full max-h-[88vh] overflow-y-auto overflow-x-hidden modal-sheet">
            <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-4 flex items-center justify-between">
              <h2 className="text-base font-bold flex items-center gap-2">
                <Code2 className="w-4 h-4 text-primary-600" />
                Integração via API
              </h2>
              <button onClick={() => setModalApiAberto(false)} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 transition-all hover:rotate-90 duration-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-5 pb-10">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Endpoint</p>
                <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5 gap-2">
                  <code className="text-sm text-gray-800 break-all">POST /api/nubank/importar</code>
                  <button onClick={() => copiarTexto('endpoint', 'POST /api/nubank/importar')} className="shrink-0 p-1.5 rounded-lg hover:bg-gray-200 transition">
                    {copiado === 'endpoint' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-gray-400" />}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Autenticação</p>
                <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5 gap-2">
                  <code className="text-sm text-gray-800 break-all">{'Authorization: Bearer <NUBANK_IMPORT_API_KEY>'}</code>
                  <button onClick={() => copiarTexto('auth', 'Authorization: Bearer <NUBANK_IMPORT_API_KEY>')} className="shrink-0 p-1.5 rounded-lg hover:bg-gray-200 transition">
                    {copiado === 'auth' ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-gray-400" />}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">Configure a variável de ambiente <code>NUBANK_IMPORT_API_KEY</code> no servidor.</p>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Parâmetros (query string)</p>
                <div className="space-y-2">
                  {[
                    { param: 'cartao', desc: 'nubank (padrão) | cartao1 | cartao2' },
                    { param: 'categorizar', desc: 'true (padrão) | false — categorizar com IA após importar' },
                  ].map(({ param, desc }) => (
                    <div key={param} className="flex items-start gap-2">
                      <code className="text-xs bg-gray-100 text-blue-700 px-2 py-1 rounded-lg shrink-0">{param}</code>
                      <span className="text-sm text-gray-500">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Exemplo 1 — Envio de arquivo CSV</p>
                <div className="bg-gray-900 rounded-xl p-3 flex items-start gap-2">
                  <pre className="text-xs text-green-300 whitespace-pre overflow-x-auto flex-1 min-w-0">{`curl -X POST https://seu-dominio.com/api/nubank/importar?cartao=nubank \\
  -H "Authorization: Bearer SUA_API_KEY" \\
  -F "file=@extrato.csv"`}</pre>
                  <button
                    onClick={() => copiarTexto('ex1', `curl -X POST https://seu-dominio.com/api/nubank/importar?cartao=nubank \\\n  -H "Authorization: Bearer SUA_API_KEY" \\\n  -F "file=@extrato.csv"`)}
                    className="shrink-0 p-1.5 rounded-lg hover:bg-gray-700 transition"
                  >
                    {copiado === 'ex1' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-400" />}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Exemplo 2 — CSV como texto (JSON)</p>
                <div className="bg-gray-900 rounded-xl p-3 flex items-start gap-2">
                  <pre className="text-xs text-green-300 whitespace-pre overflow-x-auto flex-1 min-w-0">{`curl -X POST https://seu-dominio.com/api/nubank/importar?cartao=cartao1 \\
  -H "Authorization: Bearer SUA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"cartao":"cartao1","csv":"date,title,amount\\n2024-01-15,Compra,100.00"}'`}</pre>
                  <button
                    onClick={() => copiarTexto('ex2', `curl -X POST https://seu-dominio.com/api/nubank/importar?cartao=cartao1 \\\n  -H "Authorization: Bearer SUA_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"cartao":"cartao1","csv":"date,title,amount\\n2024-01-15,Compra,100.00"}'`)}
                    className="shrink-0 p-1.5 rounded-lg hover:bg-gray-700 transition"
                  >
                    {copiado === 'ex2' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-400" />}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Exemplo 3 — Array de transações (JSON)</p>
                <div className="bg-gray-900 rounded-xl p-3 flex items-start gap-2">
                  <pre className="text-xs text-green-300 whitespace-pre overflow-x-auto flex-1 min-w-0">{`curl -X POST https://seu-dominio.com/api/nubank/importar?cartao=cartao2 \\
  -H "Authorization: Bearer SUA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"cartao":"cartao2","transacoes":[{"date":"2024-01-15","title":"Compra","amount":100.00}]}'`}</pre>
                  <button
                    onClick={() => copiarTexto('ex3', `curl -X POST https://seu-dominio.com/api/nubank/importar?cartao=cartao2 \\\n  -H "Authorization: Bearer SUA_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"cartao":"cartao2","transacoes":[{"date":"2024-01-15","title":"Compra","amount":100.00}]}'`)}
                    className="shrink-0 p-1.5 rounded-lg hover:bg-gray-700 transition"
                  >
                    {copiado === 'ex3' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-400" />}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Formato do CSV</p>
                <div className="bg-gray-900 rounded-xl p-3 flex items-start gap-2">
                  <pre className="text-xs text-green-300 whitespace-pre overflow-x-auto flex-1 min-w-0">{`date,title,amount\n2024-01-15,Supermercado,250.00\n2024-01-20,Restaurante Jeniffer,89.90`}</pre>
                  <button
                    onClick={() => copiarTexto('csv', `date,title,amount\n2024-01-15,Supermercado,250.00\n2024-01-20,Restaurante Jeniffer,89.90`)}
                    className="shrink-0 p-1.5 rounded-lg hover:bg-gray-700 transition"
                  >
                    {copiado === 'csv' ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-400" />}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">Transações com &quot;Jeniffer&quot; no título são atribuídas à Jeniffer. Parcelas no formato <code>2/6</code> são distribuídas automaticamente pelos meses.</p>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Resposta</p>
                <div className="bg-gray-50 rounded-xl p-3 overflow-x-auto">
                  <pre className="text-xs text-gray-700 whitespace-pre">{`{
  "success": true,
  "importacao": {
    "totalLidas": 10,
    "novas": 8,
    "conciliados": 1,
    "conflitos": 0,
    "duplicatasNoArquivo": 1,
    "matheus": 6,
    "jeniffer": 2,
    "total": "1234.56",
    "mesesReprocessados": ["2024-01-01"],
    "resumoPorFatura": { ... }
  },
  "categorizacao": {
    "categorized": 8,
    "total": 8,
    "cotaDiariaEsgotada": false
  }
}`}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {detalheLogAberto && (
        <ModalPortal>
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end justify-center z-[200] modal-overlay">
          <div className="bg-white rounded-t-3xl w-full max-h-[88vh] overflow-y-auto overflow-x-hidden modal-sheet">
            <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-4 flex items-center justify-between">
              <h2 className="text-base font-bold flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary-600" />
                Detalhes da importação
              </h2>
              <button onClick={fecharDetalhes} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 transition-all hover:rotate-90 duration-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-2 pb-10">
              {!carregandoDetalhe && detalheLinhas && detalheLinhas.length > 0 && (
                <div className="space-y-2 mb-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    <input
                      type="text"
                      className="w-full bg-gray-50 border border-gray-100 rounded-xl pl-9 pr-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
                      placeholder="Buscar por descrição..."
                      value={filtroBuscaDetalhe}
                      onChange={(e) => setFiltroBuscaDetalhe(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <FilterSelect
                      value={filtroDecisaoDetalhe}
                      onChange={v => setFiltroDecisaoDetalhe(v)}
                      options={[
                        { value: '', label: 'Status (todos)' },
                        ...Array.from(new Set(detalheLinhas.map(l => l.decisao))).map(d => ({
                          value: d,
                          label: DECISAO_INFO[d].label,
                        })),
                      ]}
                    />
                    {filtrosDetalheAtivos && (
                      <button
                        onClick={() => {
                          setFiltroBuscaDetalhe('')
                          setFiltroDecisaoDetalhe('')
                          setFiltroValorMinDetalhe('')
                          setFiltroDataDetalhe('')
                        }}
                        className="shrink-0 text-xs text-red-500 hover:text-red-600 font-semibold px-2 py-2 transition-colors"
                      >
                        Limpar
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow"
                      placeholder="Valor mínimo"
                      value={filtroValorMinDetalhe}
                      onChange={(e) => setFiltroValorMinDetalhe(numericOnly(e.target.value))}
                    />
                    <div className="relative">
                      <input
                        type="date"
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-shadow appearance-none"
                        value={filtroDataDetalhe}
                        onChange={(e) => setFiltroDataDetalhe(e.target.value)}
                      />
                      {!filtroDataDetalhe && (
                        <div className="absolute inset-0 flex items-center gap-1.5 px-3 pointer-events-none">
                          <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
                          <span className="text-sm text-gray-400">Data</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {carregandoDetalhe ? (
                <div className="py-10 flex justify-center">
                  <div className="w-6 h-6 rounded-full border-[3px] border-primary-200 border-t-primary-600 animate-spin" />
                </div>
              ) : !detalheLinhas || detalheLinhas.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-gray-400">Detalhes não disponíveis — resultados de validação ficam disponíveis por até 2 dias após a importação.</p>
                </div>
              ) : detalheLinhasFiltradas && detalheLinhasFiltradas.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-gray-400">Nenhuma compra encontrada para os filtros aplicados.</p>
                </div>
              ) : (
                detalheLinhasFiltradas!.map(linha => {
                  const info = DECISAO_INFO[linha.decisao]
                  const acaoDisponivel = acaoParaLinha(linha.decisao)
                  const isRevertendo = revertendoId === linha.id
                  return (
                    <div key={linha.id} className="bg-gray-50 border border-gray-100 rounded-2xl p-3 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-gray-800 truncate">{linha.descricao}</span>
                        {linha.valor != null && (
                          <span className="text-sm font-semibold text-gray-700 whitespace-nowrap num shrink-0">
                            R$ {Number(linha.valor).toFixed(2).replace('.', ',')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {linha.data_compra && (
                            <span className="text-xs text-gray-400">
                              {new Date(linha.data_compra + 'T12:00:00').toLocaleDateString('pt-BR')}
                            </span>
                          )}
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${info.classes}`}>{info.label}</span>
                          {linha.revertido_em && (
                            <span className="text-[10px] text-gray-400">
                              revertido em {new Date(linha.revertido_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                        {linha.decisao === 'conflito' ? (
                          <span className="text-xs text-amber-600 shrink-0">Resolva pelo sino de notificações</span>
                        ) : acaoDisponivel ? (
                          <button
                            onClick={() => pedirAcaoLinha(linha.id, acaoDisponivel.acao, acaoDisponivel.destrutiva)}
                            disabled={isRevertendo}
                            className="text-xs font-semibold text-primary-600 hover:text-primary-700 disabled:opacity-50 flex items-center gap-1 shrink-0"
                          >
                            {isRevertendo ? (
                              <span className="w-3 h-3 rounded-full border-2 border-primary-200 border-t-primary-600 animate-spin" />
                            ) : acaoDisponivel.destrutiva ? (
                              <Trash2 className="w-3.5 h-3.5" />
                            ) : (
                              <RotateCcw className="w-3.5 h-3.5" />
                            )}
                            {acaoDisponivel.label}
                          </button>
                        ) : null}
                      </div>

                      {linha.registro_conflitante && (
                        <p className="text-[11px] text-gray-500 bg-white border border-gray-100 rounded-lg px-2 py-1">
                          Já existe: &quot;{linha.registro_conflitante.descricao}&quot; · R$ {Number(linha.registro_conflitante.valor).toFixed(2).replace('.', ',')} · {new Date(linha.registro_conflitante.data_compra + 'T12:00:00').toLocaleDateString('pt-BR')} · {STATUS_LABELS[linha.registro_conflitante.status] ?? linha.registro_conflitante.status.toLowerCase()}
                        </p>
                      )}

                      {erroLinha?.id === linha.id && (
                        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-2 py-1">{erroLinha.mensagem}</p>
                      )}

                      {confirmarAcao?.linhaId === linha.id && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-2.5 space-y-2">
                          <p className="text-xs text-red-700">
                            Confirma a ação &quot;{acaoDisponivel?.label}&quot;? Essa ação altera dados reais em transações.
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => executarAcaoLinha(linha.id, confirmarAcao.acao)}
                              className="flex-1 bg-red-600 text-white text-xs font-semibold py-1.5 rounded-lg hover:bg-red-700 transition-all"
                            >
                              Confirmar
                            </button>
                            <button
                              onClick={() => setConfirmarAcao(null)}
                              className="flex-1 bg-white border border-gray-200 text-gray-600 text-xs font-medium py-1.5 rounded-lg hover:bg-gray-50 transition-all"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

    </div>
  )
}
