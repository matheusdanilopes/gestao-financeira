'use client'

import { useState } from 'react'

type Resultado = {
  total: number
  atualizadas: number
  semAlteracao: number
  conflitosRemovidos: number
  erros: string[]
  erro?: string
}

export default function RegenerarHashesPage() {
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function executar() {
    if (
      !confirm(
        'Isso vai recalcular o hash_linha de TODAS as compras e remover duplicatas geradas pelo conflito. Confirmar?'
      )
    )
      return

    setCarregando(true)
    setResultado(null)

    try {
      const res = await fetch('/api/admin/regenerar-hashes', { method: 'POST' })
      const json = await res.json()
      setResultado(json)
    } catch (err: unknown) {
      setResultado({ total: 0, atualizadas: 0, semAlteracao: 0, conflitosRemovidos: 0, erros: [], erro: String(err) })
    } finally {
      setCarregando(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-start justify-center pt-20 px-4">
      <div className="bg-white rounded-2xl shadow-md p-8 w-full max-w-lg">
        <h1 className="text-xl font-bold text-gray-800 mb-2">Regenerar hashes das compras</h1>
        <p className="text-sm text-gray-500 mb-6">
          Recalcula o <code className="bg-gray-100 px-1 rounded">hash_linha</code> de todas as
          transações usando o formato atual (descrição normalizada + valor em{' '}
          <code className="bg-gray-100 px-1 rounded">toFixed(2)</code>). Registros cujo novo hash
          conflita com uma linha já existente são removidos como duplicatas.
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-sm text-amber-800">
          <strong>Atenção:</strong> operação irreversível. Execute apenas uma vez após a migração do
          formato de hash.
        </div>

        <button
          onClick={executar}
          disabled={carregando}
          className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {carregando ? 'Processando…' : 'Executar migração'}
        </button>

        {resultado && (
          <div className="mt-6 space-y-3 text-sm">
            {resultado.erro ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                <strong>Erro:</strong> {resultado.erro}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Total" valor={resultado.total} cor="gray" />
                  <Stat label="Atualizadas" valor={resultado.atualizadas} cor="green" />
                  <Stat label="Sem alteração" valor={resultado.semAlteracao} cor="blue" />
                  <Stat label="Duplicatas removidas" valor={resultado.conflitosRemovidos} cor="amber" />
                </div>

                {resultado.erros.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="font-semibold text-red-700 mb-2">
                      {resultado.erros.length} erro(s):
                    </p>
                    <ul className="text-red-600 space-y-1 text-xs font-mono">
                      {resultado.erros.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {resultado.erros.length === 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 font-medium text-center">
                    Migração concluída sem erros.
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

function Stat({ label, valor, cor }: { label: string; valor: number; cor: string }) {
  const colors: Record<string, string> = {
    gray: 'bg-gray-50 text-gray-700',
    green: 'bg-green-50 text-green-700',
    blue: 'bg-blue-50 text-blue-700',
    amber: 'bg-amber-50 text-amber-700',
  }
  return (
    <div className={`rounded-lg p-3 ${colors[cor]}`}>
      <p className="text-xs opacity-70">{label}</p>
      <p className="text-2xl font-bold">{valor}</p>
    </div>
  )
}
