'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { descricaoFechamento } from '@/lib/fatura'
import { Settings, LogOut, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import BottomNav from '@/components/BottomNav'

export default function ConfiguracoesPage() {
  const [diaVencimento, setDiaVencimento] = useState(10)
  const [ajusteFechamento, setAjusteFechamento] = useState(0)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const router = useRouter()

  useEffect(() => { carregarConfigs() }, [])

  async function carregarConfigs() {
    const { data } = await supabase.from('configuracoes').select('chave, valor')
    if (data) {
      const dv = data.find((c: any) => c.chave === 'dia_vencimento')
      const af = data.find((c: any) => c.chave === 'ajuste_fechamento')
      if (dv) setDiaVencimento(parseInt(dv.valor))
      if (af) setAjusteFechamento(parseInt(af.valor))
    }
  }

  async function salvar() {
    setSalvando(true)
    setMensagem('')
    await supabase.from('configuracoes').upsert(
      [
        { chave: 'dia_vencimento', valor: String(diaVencimento) },
        { chave: 'ajuste_fechamento', valor: String(ajusteFechamento) },
      ],
      { onConflict: 'chave' }
    )
    setMensagem('Configurações salvas com sucesso!')
    setSalvando(false)
    setTimeout(() => setMensagem(''), 3000)
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
