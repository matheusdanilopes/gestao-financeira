'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, CheckCircle2, XCircle, Sparkles } from 'lucide-react'
import BottomNav from '@/components/BottomNav'

interface Resumo {
  matheus: number
  jeniffer: number
  total: string
  novas: number
  duplicatasNoArquivo: number
  totalLidas: number
  mesesSobrescritos: string[]
  mesesFuturos: string[]
}

export default function ImportarPage() {
  const [uploading, setUploading] = useState(false)
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [arrastando, setArrastando] = useState(false)
  const [categorizando, setCategorizando] = useState(false)
  const [categorizadoMsg, setCategorizadoMsg] = useState<string | null>(null)
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function categorizar() {
    setCategorizando(true)
    setCategorizadoMsg(null)
    try {
      const res = await fetch('/api/categorizar', { method: 'POST' })
      const data = await res.json()
      if (data.error) {
        setCategorizadoMsg('Erro: ' + data.error)
      } else if (data.total === 0) {
        setCategorizadoMsg('Todas as transações já estão categorizadas!')
      } else if (data.cotaDiariaEsgotada) {
        setCategorizadoMsg(
          `Cota diária do Gemini esgotada. ${data.categorized} de ${data.total} categorizadas. Tente novamente amanhã.`
        )
      } else if (data.erros?.length) {
        setCategorizadoMsg(`${data.categorized}/${data.total} categorizadas com erros em alguns lotes.`)
      } else {
        setCategorizadoMsg(`${data.categorized} transações categorizadas com IA`)
      }
    } catch {
      setCategorizadoMsg('Erro ao categorizar')
    } finally {
      setCategorizando(false)
    }
  }

  async function processarArquivo(file: File) {
    setNomeArquivo(file.name)
    setUploading(true)
    setResumo(null)
    setErro(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch('/api/import', { method: 'POST', body: formData })
      const data = await response.json()

      if (data.success) {
        setResumo({
          matheus: data.matheus,
          jeniffer: data.jeniffer,
          total: data.total,
          novas: data.novas,
          duplicatasNoArquivo: data.duplicatasNoArquivo,
          totalLidas: data.totalLidas,
          mesesSobrescritos: data.mesesSobrescritos ?? [],
          mesesFuturos: data.mesesFuturos ?? [],
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
      <h1 className="text-2xl font-bold mb-2">Importar CSV</h1>
      <p className="text-sm text-gray-500 mb-6">Faça upload do arquivo exportado pelo Nubank</p>

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
                {arrastando ? 'Solte o arquivo aqui' : 'Arraste o CSV aqui'}
              </p>
              <p className="text-sm text-gray-400 mt-0.5">ou toque para selecionar</p>
            </div>
            <span className="text-xs bg-gray-100 text-gray-500 px-3 py-1 rounded-full">.csv</span>
          </div>
        )}
      </div>

      <div className="bg-blue-50 rounded-xl p-3 mb-4 text-xs text-blue-700 space-y-1">
        <p className="font-semibold">Como exportar do Nubank:</p>
        <p>Nubank → Minha conta → Exportar gastos → Selecione o período → Baixar CSV</p>
      </div>

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
          {resumo.mesesFuturos.length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-xs text-blue-700 font-semibold mb-1">Meses futuros (mesclados sem apagar existentes):</p>
              <div className="flex flex-wrap gap-1">
                {resumo.mesesFuturos.map(m => (
                  <span key={m} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                    {m.substring(0, 7)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {resumo.duplicatasNoArquivo > 0 && (
            <p className="text-xs text-gray-400 text-center">
              {resumo.duplicatasNoArquivo} linha(s) duplicada(s) no arquivo ignoradas
            </p>
          )}
        </div>
      )}

      <BottomNav />
    </div>
  )
}
