'use client'

import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'

export interface ArquivoDetalheScript {
  assunto: string | null
  arquivo: string | null
  enviado: boolean
  tentativas?: number
  erro: string | null
}

export interface ResumoImportacaoScript {
  emailsEncontrados: number
  arquivoEncontrado: boolean
  totalArquivosCsv: number
  arquivosEnviadosComSucesso: number
  arquivosComFalha: number
  detalhes: ArquivoDetalheScript[]
  sucessoGeral: boolean
}

export interface StatusExecucaoScript {
  status: 'running' | 'success' | 'error' | null
  origem?: 'api' | 'job'
  iniciadoEm?: string | null
  finalizadoEm?: string | null
  resumo?: ResumoImportacaoScript
  erro?: string
  // Mensagem pronta vinda do nível raiz da resposta, usada quando o Apps Script
  // não manda o objeto de execução completo (fora do contrato documentado).
  mensagem?: string
}

interface RespostaScript {
  success?: boolean
  sucesso?: boolean
  mensagem?: string
  error?: string
  erro?: string
  corpoBruto?: string
  emExecucao?: boolean
  arquivoEncontrado?: boolean
  envioComSucesso?: boolean
  resumo?: ResumoImportacaoScript
  status?: StatusExecucaoScript | null
}

export type TipoCartaoScript = 'nubank' | 'cartao1' | 'cartao2'

interface ImportacaoScriptContextType {
  disparando: boolean
  erro: string | null
  execucao: StatusExecucaoScript | null
  /**
   * Espelha `execucao`, mas só é preenchido quando a execução foi de fato disparada
   * pelo botão desta tela (ver `disparar`) — nunca pela checagem passiva de mount, que
   * também detecta execuções do gatilho de tempo do Apps Script. O campo `origem` que o
   * próprio Apps Script reporta não é confiável para essa distinção (execuções do
   * gatilho de tempo às vezes vêm marcadas como 'api'), então usamos esta flag local
   * como fonte da verdade para qualquer indicador global (fora de /importar).
   */
  execucaoManual: StatusExecucaoScript | null
  disparar: (cartao: TipoCartaoScript) => Promise<void>
  verificarStatusAgora: () => void
}

const ImportacaoScriptContext = createContext<ImportacaoScriptContextType>({
  disparando: false,
  erro: null,
  execucao: null,
  execucaoManual: null,
  disparar: async () => {},
  verificarStatusAgora: () => {},
})

export function useImportacaoScript() {
  return useContext(ImportacaoScriptContext)
}

// Tempo máximo fazendo polling do status antes de desistir (evita ficar consultando
// pra sempre se o Apps Script travar em "running").
const POLL_MAX_MS = 10 * 60 * 1000

// Provider montado uma única vez na raiz do app (fora das páginas) — assim o
// acionamento e o polling do Google Apps Script sobrevivem à navegação entre
// telas em vez de morrerem junto com o componente de /importar.
export function ImportacaoScriptProvider({ children }: { children: React.ReactNode }) {
  const [disparando, setDisparando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [execucao, setExecucao] = useState<StatusExecucaoScript | null>(null)
  const [execucaoManual, setExecucaoManual] = useState<StatusExecucaoScript | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollInicioRef = useRef<number | null>(null)
  const consultarRef = useRef<(agendarProximo: boolean) => Promise<void>>(async () => {})
  // Marca se a cadeia de polling em andamento pertence a um disparo manual (botão
  // desta tela) ou à checagem passiva de mount — só a primeira alimenta execucaoManual.
  const origemPollingRef = useRef<'manual' | 'passivo'>('passivo')
  // true entre o momento em que disparamos/detectamos uma execução e o momento em
  // que um poll traz um resultado definitivo (success/error) — evita que um poll
  // que ainda não viu o status "running" propagado (corrida com o Apps Script)
  // seja interpretado como "não tem nada acontecendo".
  const aguardandoResultadoRef = useRef(false)

  const pararPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current)
      pollRef.current = null
    }
    pollInicioRef.current = null
  }, [])

  // Agenda o próximo poll, mas desiste depois de POLL_MAX_MS para não ficar
  // consultando pra sempre caso o Apps Script fique preso em "running". Ao desistir,
  // avisa em vez de deixar o indicador congelado silenciosamente em "rodando".
  const agendarProximoPoll = useCallback(() => {
    if (pollInicioRef.current == null) pollInicioRef.current = Date.now()
    if (Date.now() - pollInicioRef.current > POLL_MAX_MS) {
      pollRef.current = null
      aguardandoResultadoRef.current = false
      setErro('Não foi possível confirmar o resultado da importação após alguns minutos. Toque em "Verificar status agora" ou tente novamente.')
      return
    }
    pollRef.current = setTimeout(() => consultarRef.current(true), 4000)
  }, [])

  // Aplica uma execução detectada tanto ao estado geral (usado por /importar) quanto,
  // quando a cadeia de polling atual pertence a um disparo manual, ao espelho
  // execucaoManual (usado pelo indicador global fora de /importar).
  const aplicarExecucao = useCallback((exec: StatusExecucaoScript | null) => {
    setExecucao(exec)
    if (origemPollingRef.current === 'manual') setExecucaoManual(exec)
  }, [])

  const consultarStatus = useCallback(async (agendarProximo: boolean) => {
    try {
      const res = await fetch('/api/import/google-apps-script')
      const data: RespostaScript = await res.json()
      // Em teoria data.status é sempre o objeto de execução aninhado, mas na prática
      // já vimos o Apps Script devolver só o número do HTTP status ali (fora do
      // contrato documentado) — nesse caso ignora e usa o fallback abaixo.
      const statusBruto: unknown = data.status
      const exec: StatusExecucaoScript | null =
        statusBruto && typeof statusBruto === 'object' ? (statusBruto as StatusExecucaoScript) : null

      if (exec?.status === 'running' || data.emExecucao) {
        aguardandoResultadoRef.current = true
        aplicarExecucao(exec ?? { status: 'running' })
        if (agendarProximo) agendarProximoPoll()
        return
      }
      if (exec?.status === 'success' || exec?.status === 'error') {
        aguardandoResultadoRef.current = false
        aplicarExecucao(exec)
        if (exec.status === 'success') setErro(null)
        pararPolling()
        return
      }

      // O Apps Script respondeu sem o objeto de execução aninhado — usa
      // sucesso/erro/mensagem do nível raiz como sinal em vez de ficar esperando
      // pra sempre um formato que essa implementação não está devolvendo.
      if (typeof data.sucesso === 'boolean') {
        aguardandoResultadoRef.current = false
        aplicarExecucao({
          status: data.sucesso ? 'success' : 'error',
          erro: data.sucesso ? undefined : (data.erro ?? data.mensagem),
          mensagem: data.mensagem,
        })
        if (data.sucesso) setErro(null)
        pararPolling()
        return
      }

      // Resposta trouxe só um campo de erro (ex.: o Apps Script devolveu algo que
      // não é JSON válido, ou o proxy falhou) — trata como erro definitivo em vez
      // de continuar tentando pra sempre um problema que não vai se resolver sozinho.
      if (typeof data.erro === 'string') {
        aguardandoResultadoRef.current = false
        aplicarExecucao({
          status: 'error',
          erro: data.corpoBruto ? `${data.erro} Resposta: ${data.corpoBruto.slice(0, 300)}` : data.erro,
        })
        pararPolling()
        return
      }

      // Nenhum sinal aproveitável. Se acabamos de disparar ou detectar uma execução,
      // pode ser só o Apps Script ainda não ter propagado o "running" — mantém o
      // aviso atual e continua tentando em vez de sumir com tudo de repente.
      if (aguardandoResultadoRef.current) {
        if (agendarProximo) agendarProximoPoll()
        return
      }
      aplicarExecucao(null)
      pararPolling()
    } catch {
      // Falha passageira (rede, JSON inválido etc.) — tenta de novo mais adiante
      // em vez de deixar o polling morrer silenciosamente.
      if (agendarProximo) agendarProximoPoll()
    }
  }, [pararPolling, agendarProximoPoll, aplicarExecucao])

  // Mantém uma ref sempre atualizada para o setTimeout recursivo acima poder
  // chamar a versão mais recente sem precisar declará-la antes de si mesma.
  useEffect(() => {
    consultarRef.current = consultarStatus
  }, [consultarStatus])

  // Verifica uma única vez, para o app inteiro, se já há uma execução em andamento
  // ao carregar (ex.: disparada pelo gatilho de tempo do Apps Script) — continua o
  // polling até ela terminar, independente de qual tela o usuário está.
  useEffect(() => {
    origemPollingRef.current = 'passivo'
    consultarStatus(true)
    return () => pararPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const verificarStatusAgora = useCallback(() => {
    pararPolling()
    aguardandoResultadoRef.current = true
    setErro(null)
    consultarStatus(true)
  }, [pararPolling, consultarStatus])

  const disparar = useCallback(async (cartao: TipoCartaoScript) => {
    setDisparando(true)
    setErro(null)
    pararPolling()
    try {
      const res = await fetch('/api/import/google-apps-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cartao }),
      })
      const data: RespostaScript = await res.json()

      if (res.status === 409 || data.emExecucao) {
        // Já existe uma execução em andamento — não foi este clique que a
        // disparou (pode ter sido outro acionamento ou o gatilho de tempo do Apps
        // Script), então não marca como manual para o indicador global.
        origemPollingRef.current = 'passivo'
        aguardandoResultadoRef.current = true
        aplicarExecucao(data.status ?? { status: 'running' })
        agendarProximoPoll()
        return
      }
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Erro desconhecido')

      // Disparo aceito — a execução real roda em background; acompanha via polling,
      // que continua rodando aqui no provider mesmo que o usuário saia da tela.
      // Marcada como manual: este clique é quem iniciou a execução.
      origemPollingRef.current = 'manual'
      aguardandoResultadoRef.current = true
      aplicarExecucao({ status: 'running', iniciadoEm: new Date().toISOString(), origem: 'api' })
      agendarProximoPoll()
    } catch (e) {
      aguardandoResultadoRef.current = false
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setDisparando(false)
    }
  }, [pararPolling, agendarProximoPoll, aplicarExecucao])

  return (
    <ImportacaoScriptContext.Provider value={{ disparando, erro, execucao, execucaoManual, disparar, verificarStatusAgora }}>
      {children}
    </ImportacaoScriptContext.Provider>
  )
}
