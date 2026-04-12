'use client'

import { useState, useRef } from 'react'
import { Upload, FileText } from 'lucide-react'
import ImportResumo from '@/components/ImportResumo'
import BottomNav from '@/components/BottomNav'

export default function ImportarPage() {
  const [uploading, setUploading] = useState(false)
  const [resumo, setResumo] = useState<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)

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

      <div className="bg-white rounded-xl shadow p-8 text-center">
        <div className="mb-6">
          <FileText className="w-16 h-16 mx-auto text-gray-400 mb-2" />
          <p className="text-gray-600">Importe o arquivo CSV do Nubank</p>
          <p className="text-sm text-gray-400 mt-1">
            O sistema identifica automaticamente os responsáveis e evita duplicatas
          </p>
        </div>

        <label className="inline-block">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            className="hidden"
            disabled={uploading}
          />
          <div className="bg-blue-600 text-white px-6 py-3 rounded-lg cursor-pointer hover:bg-blue-700 transition flex items-center gap-2">
            <Upload className="w-5 h-5" />
            {uploading ? 'Processando...' : 'Selecionar CSV'}
          </div>
        </label>
      </div>

      {resumo && <ImportResumo resumo={resumo} />}
      <BottomNav />
    </div>
  )
}
