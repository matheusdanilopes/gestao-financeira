'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, CheckCircle2, XCircle, Sparkles, Clock, AlertCircle, ShieldCheck, Trash2 } from 'lucide-react'
import BottomNav from '@/components/BottomNav'
import { useCategorizacao } from '@/components/CategorizacaoProvider'

interface StatsFatura {
  noCSV: number
  inseridas: number
  ignoradas: number
  totalNoBanco: number
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
}

interface Atividade {
  id: string
  descricao: string
  valor: number | null
  created_at: string
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

type TipoCartao = 'nubank' | 'cartao1' | 'cartao2'

const CARTAO_LABELS: Record<TipoCartao, string> = {
  nubank: 'NuBank',
  cartao1: 'Cartão 1',
  cartao2: 'Cartão 2',
}

export default function ImportarPage() {
  const [cartaoSelecionado, setCartaoSelecionado] = useState<TipoCartao>('nubank')
  const [uploading, setUploading] = useState(false)
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [arrastando, setArrastando] = useState(false)
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null)
  const [atividades, setAtividades] = useState<Atividade[]>([])
  const [diagnostico, setDiagnostico] = useState<Diagnostico | null>(null)
  const [diagnosticando, setDiagnosticando] = useState(false)
  const [diagnosticoExpandido, setDiagnosticoExpandido] = useState(false)
  const [pendingModo, setPendingModo] = useState<'conservador' | 'completo' | null>(null)
  const [corrigindo, setCorrigindo] = useState(false)
  const [resultadoCorrecao, setResultadoCorrecao] = useState<{ removidos: number; mensagem: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { categorizando, categorizadoMsg, categorizar } = useCategorizacao()

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

  async function carregarAtividades() {
    try {
      const res = await fetch('/api/nubank/atividades')
      if (res.ok) {
        const data = await res.json()
        setAtividades(data.atividades ?? [])
      }
    } catch { /* silencioso */ }
  }

  useEffect(() => {
    carregarAtividades()
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
        })
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
    <div className="min-h-screen bg-gray-50 p-4 pb-20">
      <div className="sticky top-0 bg-gray-50 pt-2 pb-3 z-10">
        <h1 className="text-2xl font-bold mb-1">Importar CSV</h1>
        <p className="text-sm text-gray-500">Selecione o cartão e faça upload do arquivo CSV</p>
      </div>

      {/* Seletor de cartão */}
      <div className="bg-white rounded-2xl shadow-sm p-1 mb-4 flex gap-1">
        {(Object.keys(CARTAO_LABELS) as TipoCartao[]).map(tipo => (
          <button
            key={tipo}
            onClick={() => { setCartaoSelecionado(tipo); setResumo(null); setErro(null) }}
            className={`flex-1 py-2 px-3 rounded-xl text-sm font-semibold transition-all ${
              cartaoSelecionado === tipo
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {CARTAO_LABELS[tipo]}
          </button>
        ))}
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`bg-white rounded-2xl border-2 border-dashed transition-all cursor-pointer p-8 text-center mb-4 ${
          arrastando
            ? 'border-blue-400 bg-blue-50 scale-[1.01]'
            : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
        }`}
      >
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileInput} className="hidden" disabled={uploading} />

        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" />
            <p className="text-blue-600 font-medium">Processando {nomeArquivo}…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center transition ${arrastando ? 'bg-blue-100' : 'bg-gray-100'}`}>
              <Upload className={`w-7 h-7 ${arrastando ? 'text-blue-500' : 'text-gray-400'}`} />
            </div>
            <div>
              <p className="font-semibold text-gray-700">
                {arrastando ? 'Solte o arquivo aqui' : `Arraste o CSV do ${CARTAO_LABELS[cartaoSelecionado]}`}
              </p>
              <p className="text-sm text-gray-400 mt-0.5">ou toque para selecionar</p>
            </div>
            <span className="text-xs bg-gray-100 text-gray-500 px-3 py-1 rounded-full">.csv</span>
          </div>
        )}
      </div>

      {cartaoSelecionado === 'nubank' ? (
        <div className="bg-blue-50 rounded-xl p-3 mb-4 text-xs text-blue-700 space-y-1">
          <p className="font-semibold">Como exportar do Nubank:</p>
          <p>Nubank → Minha conta → Exportar gastos → Selecione o período → Baixar CSV</p>
        </div>
      ) : (
        <div className="bg-amber-50 rounded-xl p-3 mb-4 text-xs text-amber-700 space-y-1">
          <p className="font-semibold">Formato esperado para {CARTAO_LABELS[cartaoSelecionado]}:</p>
          <p>Colunas: <span className="font-mono bg-amber-100 px-1 rounded">date, title, amount</span> — ou — <span className="font-mono bg-amber-100 px-1 rounded">Data, Descrição, Valor</span></p>
          <p>Parcelas são detectadas automaticamente pelo padrão <span className="font-mono bg-amber-100 px-1 rounded">X/Y</span> na descrição (ex: 2/12).</p>
        </div>
      )}

      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-700 text-sm">Erro na importação</p>
            <p className="text-red-600 text-sm mt-0.5">{erro}</p>
          </div>
        </div>
      )}

      <button
        onClick={categorizar}
        disabled={categorizando}
        className="w-full flex items-center justify-center gap-2 bg-purple-600 text-white py-3 rounded-xl font-semibold hover:bg-purple-700 transition disabled:opacity-50 mb-4"
      >
        <Sparkles className="w-4 h-4" />
        {categorizando ? 'Categorizando...' : 'Categorizar com IA'}
      </button>

      {categorizadoMsg && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 mb-4 text-sm text-purple-700 text-center">
          {categorizadoMsg}
        </div>
      )}

      {resumo && (
        <div className="bg-white rounded-xl shadow p-4 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <h3 className="font-semibold text-gray-800">Importação concluída</h3>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-gray-800">{resumo.totalLidas}</p>
              <p className="text-xs text-gray-500 mt-0.5">Lidas no arquivo</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{resumo.novas}</p>
              <p className="text-xs text-gray-500 mt-0.5">Novas importadas</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-700">{resumo.matheus}</p>
              <p className="text-xs text-gray-500 mt-0.5">Matheus</p>
            </div>
            <div className="bg-pink-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-pink-700">{resumo.jeniffer}</p>
              <p className="text-xs text-gray-500 mt-0.5">Jeniffer</p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-sm text-gray-500">Valor total importado</span>
            <span className="font-bold text-gray-800">R$ {resumo.total}</span>
          </div>

          {resumo.mesesSobrescritos.length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-xs text-amber-700 font-semibold mb-1">Meses sobrescritos:</p>
              <div className="flex flex-wrap gap-1">
                {resumo.mesesSobrescritos.map(m => (
                  <span key={m} className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                    {m.substring(0, 7)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {resumo.duplicatasNoArquivo > 0 && (
            <p className="text-xs text-gray-400 text-center">
              {resumo.duplicatasNoArquivo} linha(s) ignoradas (já existiam)
            </p>
          )}

          {resumo.resumoPorFatura && Object.keys(resumo.resumoPorFatura).length > 0 && (
            <div className="pt-2 border-t space-y-2">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Verificação por fatura</p>
              {Object.entries(resumo.resumoPorFatura)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([fatura, stats]) => {
                  const label = new Date(fatura + 'T12:00:00')
                    .toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
                    .replace(/^\w/, c => c.toUpperCase())
                  const temExcesso = stats.totalNoBanco > stats.noCSV
                  return (
                    <div key={fatura} className={`rounded-lg p-3 text-xs space-y-1.5 ${temExcesso ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-700">{label}</span>
                        {temExcesso
                          ? <span className="text-amber-600 font-medium">Banco tem mais registros que o CSV</span>
                          : <span className="text-green-600 font-medium">OK</span>
                        }
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-center">
                        <div>
                          <p className="font-bold text-gray-800">{stats.noCSV}</p>
                          <p className="text-gray-400">no CSV</p>
                        </div>
                        <div>
                          <p className="font-bold text-green-700">{stats.inseridas}</p>
                          <p className="text-gray-400">inseridas</p>
                        </div>
                        <div>
                          <p className="font-bold text-gray-500">{stats.ignoradas}</p>
                          <p className="text-gray-400">ignoradas</p>
                        </div>
                        <div>
                          <p className={`font-bold ${temExcesso ? 'text-amber-700' : 'text-gray-800'}`}>{stats.totalNoBanco}</p>
                          <p className="text-gray-400">no banco</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      )}

      <div className="mt-6">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Dados Históricos</h2>
        </div>

        <button
          onClick={executarDiagnostico}
          disabled={diagnosticando}
          className="w-full flex items-center justify-center gap-2 bg-gray-100 text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-200 transition disabled:opacity-50 mb-3 text-sm"
        >
          <ShieldCheck className="w-4 h-4" />
          {diagnosticando ? 'Verificando…' : 'Verificar duplicatas históricas (±3 dias)'}
        </button>

        {diagnostico && (
          <div className={`rounded-xl p-4 mb-4 ${diagnostico.totalPares > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
            {diagnostico.totalPares === 0 ? (
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="text-sm font-medium">Nenhuma duplicata histórica detectada.</span>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800">
                        {diagnostico.totalPares} par(es) de duplicata histórica detectado(s)
                      </p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        {diagnostico.mesmaFatura} na mesma fatura · {diagnostico.faturasDiferentes} em faturas diferentes
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setDiagnosticoExpandido(v => !v)}
                    className="text-xs text-amber-700 underline shrink-0"
                  >
                    {diagnosticoExpandido ? 'Ocultar' : 'Ver detalhes'}
                  </button>
                </div>

                {/* Correction result banner */}
                {resultadoCorrecao && (
                  <div className={`mt-3 rounded-lg p-3 text-sm flex items-center gap-2 ${resultadoCorrecao.removidos >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {resultadoCorrecao.removidos >= 0
                      ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                      : <XCircle className="w-4 h-4 shrink-0" />
                    }
                    <span>{resultadoCorrecao.mensagem}</span>
                  </div>
                )}

                {/* Confirmation step */}
                {pendingModo ? (
                  <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 space-y-3">
                    <p className="text-sm font-semibold text-red-800">Confirmar exclusão permanente</p>
                    <p className="text-xs text-red-700">
                      {pendingModo === 'conservador'
                        ? `Serão removidos registros duplicados dentro da mesma fatura (${diagnostico.mesmaFatura} par(es)). Critério: mantém o mais recente e/ou categorizado manualmente.`
                        : `Serão removidos todos os pares próximos, incluindo os ${diagnostico.faturasDiferentes} par(es) em faturas diferentes. Isso altera os totais por fatura.`
                      }
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={confirmarCorrecao}
                        disabled={corrigindo}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-red-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-red-700 transition disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {corrigindo ? 'Removendo…' : 'Confirmar exclusão'}
                      </button>
                      <button
                        onClick={() => setPendingModo(null)}
                        disabled={corrigindo}
                        className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setPendingModo('conservador')}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-amber-600 text-white py-2 rounded-lg text-xs font-semibold hover:bg-amber-700 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Corrigir mesma fatura
                      <span className="bg-amber-500 px-1.5 py-0.5 rounded-full">{diagnostico.mesmaFatura}</span>
                    </button>
                    {diagnostico.faturasDiferentes > 0 && (
                      <button
                        onClick={() => setPendingModo('completo')}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-red-600 text-white py-2 rounded-lg text-xs font-semibold hover:bg-red-700 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Corrigir tudo
                        <span className="bg-red-500 px-1.5 py-0.5 rounded-full">{diagnostico.totalPares}</span>
                      </button>
                    )}
                  </div>
                )}

                {diagnosticoExpandido && (
                  <div className="mt-3 space-y-2">
                    {diagnostico.pares.map((p, i) => (
                      <div key={i} className="bg-white rounded-lg p-2.5 text-xs space-y-1 border border-amber-100">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-gray-800 truncate max-w-[70%]">{p.descricao}</span>
                          <span className="text-gray-500 font-mono">R$ {Number(p.valor).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-500">
                          <span>{p.data_a}</span>
                          <span>→</span>
                          <span>{p.data_b}</span>
                          <span className="text-amber-600">({p.dias}d)</span>
                          {!p.mesmaFatura && (
                            <span className="text-red-500 font-medium">faturas distintas</span>
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

      <div className="mt-2">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Atividades Recentes via API</h2>
        </div>

        {atividades.length === 0 ? (
          <div className="bg-white rounded-xl p-6 text-center text-sm text-gray-400">
            Nenhuma importação via API registrada ainda.
          </div>
        ) : (
          <div className="space-y-2">
            {atividades.map(a => {
              const isErro = a.descricao.startsWith('ERRO:')
              const descricaoExibida = isErro ? a.descricao.slice(6).trim() : a.descricao
              const data = new Date(a.created_at)
              const dataStr = data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
              const horaStr = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              return (
                <div
                  key={a.id}
                  className={`rounded-xl px-4 py-3 flex items-start gap-3 ${isErro ? 'bg-red-50' : 'bg-white'}`}
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
                    <span className="text-sm font-semibold text-green-700 whitespace-nowrap">
                      R$ {Number(a.valor).toFixed(2).replace('.', ',')}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}
