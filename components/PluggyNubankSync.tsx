'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { Link2, RefreshCw, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'

// O widget da Pluggy acessa `window`/`document` na carga — importar sem SSR.
const PluggyConnect = dynamic(() => import('react-pluggy-connect').then(m => m.PluggyConnect), { ssr: false })

interface PluggyStatus {
  connected: boolean
  itemId?: string
  connectorName?: string
  status?: string
  needsUserAction?: boolean
  lastSyncAt?: string | null
  lastSuccessfulSyncAt?: string | null
  lastErrorMessage?: string | null
}

function formatarRelativo(iso?: string | null): string | null {
  if (!iso) return null
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutos = Math.round(diffMs / 60_000)
  if (minutos < 1) return 'agora mesmo'
  if (minutos < 60) return `há ${minutos} min`
  const horas = Math.round(minutos / 60)
  if (horas < 24) return `há ${horas}h`
  const dias = Math.round(horas / 24)
  return `há ${dias}d`
}

export default function PluggyNubankSync() {
  const [status, setStatus] = useState<PluggyStatus | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [conectando, setConectando] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [connectToken, setConnectToken] = useState<string | null>(null)
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [modalInfoAberto, setModalInfoAberto] = useState(false)

  const carregarStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/pluggy/status')
      if (res.ok) setStatus(await res.json())
    } catch { /* silencioso */ } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregarStatus() }, [carregarStatus])

  async function abrirWidget(itemIdParaReconectar?: string) {
    setErroAcao(null)
    setConectando(true)
    try {
      const res = await fetch('/api/pluggy/connect-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemIdParaReconectar ? { itemId: itemIdParaReconectar } : {}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Falha ao gerar token de conexão.')
      setConnectToken(data.connectToken)
    } catch (err) {
      setErroAcao(err instanceof Error ? err.message : String(err))
      setConectando(false)
    }
  }

  async function onWidgetSuccess(data: { item: { id: string } }) {
    try {
      const res = await fetch('/api/pluggy/item-created', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: data.item.id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Falha ao salvar a conexão.')
      }
    } catch (err) {
      setErroAcao(err instanceof Error ? err.message : String(err))
    } finally {
      setConnectToken(null)
      setConectando(false)
      await carregarStatus()
    }
  }

  async function sincronizarAgora() {
    setSincronizando(true)
    setErroAcao(null)
    try {
      const res = await fetch('/api/pluggy/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || data.status === 'error') throw new Error(data.error ?? data.erro ?? 'Falha ao sincronizar.')
    } catch (err) {
      setErroAcao(err instanceof Error ? err.message : String(err))
    } finally {
      setSincronizando(false)
      await carregarStatus()
    }
  }

  if (carregando) {
    return (
      <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 mb-4 animate-pulse">
        <div className="h-4 bg-gray-100 rounded-full w-48" />
      </div>
    )
  }

  const precisaReconectar = status?.connected && status.needsUserAction

  return (
    <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-800">Sincronização automática (Pluggy)</h3>
        </div>
        <button
          onClick={() => setModalInfoAberto(true)}
          className="text-gray-300 hover:text-gray-500 transition-colors"
          aria-label="Como funciona a sincronização automática"
        >
          <Info className="w-4 h-4" />
        </button>
      </div>

      {!status?.connected && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Conecte a conta Nubank principal para importar as compras do cartão automaticamente, sem precisar de CSV.
          </p>
          <button
            onClick={() => abrirWidget()}
            disabled={conectando}
            className="w-full py-2 px-3 rounded-xl text-sm font-semibold bg-primary-600 text-white shadow-sm active:scale-[0.97] disabled:opacity-60"
          >
            {conectando ? 'Abrindo conexão…' : 'Conectar Nubank automaticamente'}
          </button>
          <p className="text-[11px] text-amber-600">
            Roda no plano gratuito da Pluggy — sincroniza no máximo 1x por dia, sem tempo real. Use CSV ou o botão &quot;Sincronizar agora&quot; quando precisar de dados mais recentes.
          </p>
        </div>
      )}

      {status?.connected && precisaReconectar && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-xs font-semibold text-amber-800">A conexão com o {status.connectorName ?? 'Nubank'} precisa ser refeita</p>
            {status.lastErrorMessage && <p className="text-[11px] text-amber-700 mt-0.5">{status.lastErrorMessage}</p>}
            <button
              onClick={() => abrirWidget(status.itemId)}
              disabled={conectando}
              className="mt-2 text-xs font-semibold bg-amber-600 text-white px-3 py-1.5 rounded-lg active:scale-[0.97] disabled:opacity-60"
            >
              {conectando ? 'Abrindo…' : 'Reconectar'}
            </button>
          </div>
        </div>
      )}

      {status?.connected && !precisaReconectar && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
            <span>
              {status.connectorName ?? 'Nubank'} conectado · última sincronização{' '}
              {formatarRelativo(status.lastSuccessfulSyncAt ?? status.lastSyncAt) ?? 'ainda não sincronizado'}
              {' '}· próxima automática em até 24h
            </span>
          </div>
          <button
            onClick={sincronizarAgora}
            disabled={sincronizando}
            className="w-full py-2 px-3 rounded-xl text-sm font-semibold bg-gray-50 text-gray-700 border border-gray-200 active:scale-[0.97] disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${sincronizando ? 'animate-spin' : ''}`} />
            {sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}
          </button>
        </div>
      )}

      {erroAcao && (
        <p className="text-[11px] text-red-600 mt-2">{erroAcao}</p>
      )}

      {connectToken && (
        <PluggyConnect
          connectToken={connectToken}
          updateItem={status?.itemId}
          onSuccess={onWidgetSuccess}
          onError={(err: { message: string }) => {
            setErroAcao(err.message)
            setConnectToken(null)
            setConectando(false)
          }}
          onClose={() => {
            setConnectToken(null)
            setConectando(false)
          }}
        />
      )}

      {modalInfoAberto && (
        <ModalPortal>
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setModalInfoAberto(false)}>
            <div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-gray-800">Como funciona a sincronização automática</h3>
              <ul className="text-xs text-gray-600 space-y-2 list-disc pl-4">
                <li>Usa o plano gratuito/dev da Pluggy — não é tempo real, roda no máximo 1x por dia.</li>
                <li>Se o Nubank pedir login ou aprovação (MFA) novamente, a conexão precisa ser refeita manualmente aqui na tela.</li>
                <li>Não há garantia de disponibilidade contínua — em caso de falha, tente &quot;Sincronizar agora&quot; ou importe o CSV normalmente.</li>
              </ul>
              <button
                onClick={() => setModalInfoAberto(false)}
                className="w-full py-2 rounded-xl text-sm font-semibold bg-gray-100 text-gray-700"
              >
                Entendi
              </button>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  )
}
