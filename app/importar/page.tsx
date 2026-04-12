'use client'

import { useState, useRef } from 'react'
import { Upload, FileText } from 'lucide-react'
import ImportResumo from '@/components/ImportResumo'

export default function ImportarPage() {
  const [uploading, setUploading] = useState(false)
  const [resumo, setResumo] = useState<any>(null)
  const [responsavel, setResponsavel] = useState<'Matheus' | 'Jeniffer'>('Matheus')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('responsavel', responsavel)

    try {
      const response = await fetch('/api/import', {
        method: 'POST',
        body: formData,
      })
      const data = await response.json()

      if (data.success) {
        setResumo({
          matheus: data.matheus,
          jeniffer: data.jeniffer,
          total: data.total,
        })
      } else {
        alert('Erro ao importar: ' + (data.error || 'Erro desconhecido'))
      }
    } catch (error) {
      alert('Erro ao processar arquivo: ' + String(error))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-20">
      <h1 className="text-2xl font-bold mb-6">Importação de CSV</h1>

      <div className="bg-white rounded-xl shadow p-6">
        <div className="text-center mb-6">
          <FileText className="w-14 h-14 mx-auto text-gray-400 mb-2" />
          <p className="text-gray-600 font-medium">Importe o arquivo CSV do Nubank</p>
          <p className="text-sm text-gray-400 mt-1">
            Evita duplicatas automaticamente
          </p>
        </div>

        {/* Seletor de responsável */}
        <div className="mb-6">
          <p className="text-sm font-medium text-gray-700 mb-2">De quem é esse CSV?</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setResponsavel('Matheus')}
              className={`py-3 rounded-xl border-2 font-medium transition-all ${
                responsavel === 'Matheus'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              Matheus
            </button>
            <button
              onClick={() => setResponsavel('Jeniffer')}
              className={`py-3 rounded-xl border-2 font-medium transition-all ${
                responsavel === 'Jeniffer'
                  ? 'border-pink-500 bg-pink-50 text-pink-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              Jeniffer
            </button>
          </div>
        </div>

        <label className="block">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            className="hidden"
            disabled={uploading}
          />
          <div className={`w-full py-3 rounded-xl text-white font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors ${
            uploading
              ? 'bg-gray-400 cursor-not-allowed'
              : responsavel === 'Matheus'
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-pink-500 hover:bg-pink-600'
          }`}>
            <Upload className="w-5 h-5" />
            {uploading ? 'Processando...' : `Selecionar CSV de ${responsavel}`}
          </div>
        </label>
      </div>

      {resumo && <ImportResumo resumo={resumo} />}
    </div>
  )
}
