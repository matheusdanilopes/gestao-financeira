'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  Bell, X, Check, CheckCheck,
  PiggyBank, CreditCard, TrendingUp, AlertTriangle, ThumbsUp, ThumbsDown, Heart,
  CheckCircle2, XCircle, Sparkles, Clock, ShoppingBag, ShoppingBasket,
  RefreshCw, AlertCircle, Calendar, BarChart2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AUTH_DISABLED } from '@/lib/authConfig'
import { formatBRL } from '@/lib/logger'
import { getNotificacaoMeta } from '@/lib/notificationTypes'
import { buildNotifUrl, fecharPushPorIds } from '@/lib/notificationRouter'
import type { ComponentType } from 'react'

interface ConflictMetadata {
  original_id: string
  conflito_id: string
  valor_original: number
  valor_novo: number
  descricao: string
  data_compra: string
}

interface WishlistMetadata {
  wishlist_item_id: string
  nome_item?: string
}

interface Notificacao {
  id: string
  de_usuario: string
  nome_usuario: string | null
  acao: string
  descricao: string
  valor: number | null
  lida: boolean
  created_at: string
  metadata?: ConflictMetadata | WishlistMetadata | Record<string, unknown> | null
}

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
}

function getIOSVersion(): number | null {
  if (typeof navigator === 'undefined') return null
  const match = navigator.userAgent.match(/OS (\d+)_/)
  return match ? parseInt(match[1], 10) : null
}

// Força renovação da subscrição a cada 7 dias para evitar endpoints expirados.
const PUSH_REFRESH_KEY = 'push_last_register'
const PUSH_REFRESH_MS  = 7 * 24 * 60 * 60 * 1000

function deveForcarRenovacao(): boolean {
  try {
    const last = localStorage.getItem(PUSH_REFRESH_KEY)
    return !last || Date.now() - parseInt(last, 10) > PUSH_REFRESH_MS
  } catch {
    return false
  }
}

function marcarRenovacao() {
  try { localStorage.setItem(PUSH_REFRESH_KEY, String(Date.now())) } catch { /* noop */ }
}

// Mapa de ícones por tipo de notificação
const ICONES_ACAO: Record<string, ComponentType<{ className?: string }>> = {
  importacao_iniciada:          Clock,
  importacao_processando:       Clock,
  importacao_concluida:         CheckCircle2,
  importacao_erro:              XCircle,
  categorizacao_concluida:      Sparkles,
  wishlist_novo_item:           Heart,
  wishlist_item_ia:             Sparkles,
  wishlist_item_concluido:      Heart,
  lista_compra_finalizada:      ShoppingBasket,
  lista_sincronizacao:          RefreshCw,
  lista_item_compartilhado:     ShoppingBasket,
  pedido_criado:                ShoppingBag,
  pedido_pendente:              AlertCircle,
  pedido_cancelado:             XCircle,
  pedido_concluido:             CheckCircle2,
  conta_vencendo:               AlertTriangle,
  conta_atrasada:               AlertTriangle,
  pagamento_registrado:         CreditCard,
  assinatura_alterada:          Calendar,
  aporte:                       PiggyBank,
  pagar:                        CreditCard,
  receber:                      TrendingUp,
  conciliacao_conflito:         AlertTriangle,
  ia_processamento_concluido:   Sparkles,
  ia_falha:                     XCircle,
  ia_analise_pronta:            BarChart2,
}

function renderIcone(acao: string) {
  const meta = getNotificacaoMeta(acao)
  const Icon = ICONES_ACAO[acao] ?? Bell
  return <Icon className={`w-4 h-4 ${meta.corIcone}`} />
}

function formatarValor(valor: number | null): string {
  if (valor == null) return ''
  return ` — ${formatBRL(valor)}`
}

// Converte formato legado "R$ 1551.42" para "R$ 1.551,42"
function normalizarDescricao(descricao: string): string {
  return descricao.replace(/R\$ (\d+)\.(\d{2})(?!\d)/g, (_, intPart, decPart) =>
    formatBRL(parseFloat(`${intPart}.${decPart}`))
  )
}

async function registrarPush(usuarioEmail: string, forcar = false): Promise<string | null> {
  if (!VAPID_PUBLIC) return null
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null

  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub || forcar) {
      if (sub) await sub.unsubscribe()
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      })
    }
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: usuarioEmail, subscription: sub }),
    })
    if (res.ok) marcarRenovacao()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const buffer = new ArrayBuffer(rawData.length)
  const arr = new Uint8Array(buffer)
  for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i)
  return arr
}

export default memo(function NotificacoesBell() {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([])
  const [usuarioEmail, setUsuarioEmail] = useState<string | null>(null)
  const [permissaoPush, setPermissaoPush] = useState<NotificationPermission | null>(null)
  const [iosNaoInstalado, setIosNaoInstalado] = useState(false)
  const [erroPush, setErroPush] = useState<string | null>(null)
  const [resolvendo, setResolvendo] = useState<Record<string, boolean>>({})
  const dropdownRef = useRef<HTMLDivElement>(null)

  const naoLidas = notificacoes.filter(n => !n.lida).length

  const carregarNotificacoes = useCallback(async (email: string) => {
    const { data } = await supabase
      .from('notificacoes')
      .select('id, de_usuario, nome_usuario, acao, descricao, valor, lida, created_at, metadata')
      .neq('de_usuario', email)
      .order('created_at', { ascending: false })
      .limit(30)
    setNotificacoes(data ?? [])
  }, [])

  useEffect(() => {
    async function init() {
      if (AUTH_DISABLED) {
        setUsuarioEmail('demo@demo.com')
        return
      }
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) return
      setUsuarioEmail(user.email)
      await carregarNotificacoes(user.email)
      registrarServiceWorker(user.email)
    }
    init()
  }, [carregarNotificacoes])

  useEffect(() => {
    if (!usuarioEmail) return
    const channel = supabase
      .channel('notificacoes_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notificacoes' },
        (payload) => {
          const nova = payload.new as Notificacao
          if (nova.de_usuario !== usuarioEmail) {
            setNotificacoes(prev => [nova, ...prev])
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notificacoes' },
        (payload) => {
          const atualizada = payload.new as Notificacao
          setNotificacoes(prev =>
            prev.map(n => n.id === atualizada.id ? atualizada : n)
          )
        }
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [usuarioEmail])

  // Escuta pushes do SW para atualizar o sino mesmo sem Realtime reconectado
  useEffect(() => {
    if (!usuarioEmail || !('serviceWorker' in navigator)) return
    function handleSWMessage(event: MessageEvent) {
      if (event.data?.type === 'PUSH_RECEIVED') {
        void carregarNotificacoes(usuarioEmail!)
      }
    }
    navigator.serviceWorker.addEventListener('message', handleSWMessage)
    return () => navigator.serviceWorker.removeEventListener('message', handleSWMessage)
  }, [usuarioEmail, carregarNotificacoes])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAberto(false)
      }
    }
    if (aberto) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [aberto])

  async function registrarServiceWorker(email: string) {
    if (!('serviceWorker' in navigator)) return

    if (isIOS()) {
      if (!isStandalone()) {
        setIosNaoInstalado(true)
        return
      }
      // iOS push requer versão 16.4+
      const iosVer = getIOSVersion()
      if (iosVer !== null && iosVer < 16) {
        setErroPush('Notificações push requerem iOS 16.4 ou superior. Atualize o sistema.')
        return
      }
    }

    try {
      const reg = await navigator.serviceWorker.ready

      reg.addEventListener('updatefound', () => {
        const novoSW = reg.installing
        if (!novoSW) return
        novoSW.addEventListener('statechange', () => {
          if (novoSW.state === 'activated') {
            void registrarPush(email, true)
          }
        })
      })

      const perm = Notification.permission
      setPermissaoPush(perm)
      if (perm === 'granted') {
        // Força renovação da subscrição a cada 7 dias para evitar endpoints expirados
        const forcar = deveForcarRenovacao()
        const erro = await registrarPush(email, forcar)
        if (erro) setErroPush(erro)
      }
    } catch (_) {}
  }

  async function solicitarPermissaoPush() {
    if (!usuarioEmail) return
    setErroPush(null)
    const perm = await Notification.requestPermission()
    setPermissaoPush(perm)
    if (perm === 'granted') {
      const erro = await registrarPush(usuarioEmail)
      if (erro) setErroPush(erro)
    }
  }

  async function marcarComoLida(id: string) {
    await supabase.from('notificacoes').update({ lida: true }).eq('id', id)
    setNotificacoes(prev => prev.map(n => n.id === id ? { ...n, lida: true } : n))
    fecharPushPorIds([id])
  }

  async function marcarTodasLidas() {
    const ids = notificacoes.filter(n => !n.lida).map(n => n.id)
    if (!ids.length) return
    await supabase.from('notificacoes').update({ lida: true }).in('id', ids)
    setNotificacoes(prev => prev.map(n => ({ ...n, lida: true })))
    fecharPushPorIds(ids)
  }

  async function resolverConflito(notificacao_id: string, acao: 'aprovar' | 'recusar') {
    setResolvendo(prev => ({ ...prev, [notificacao_id]: true }))
    try {
      const res = await fetch('/api/conciliacao/resolver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificacao_id, acao }),
      })
      if (res.ok) {
        setNotificacoes(prev => prev.map(n => n.id === notificacao_id ? { ...n, lida: true } : n))
        fecharPushPorIds([notificacao_id])
      }
    } finally {
      setResolvendo(prev => ({ ...prev, [notificacao_id]: false }))
    }
  }

  // Handler unificado de clique: navega para rota correta, marca como lida, fecha push
  async function handleNotificacaoClick(n: Notificacao) {
    if (n.acao === 'conciliacao_conflito') return // ação inline — não navega

    if (!n.lida) await marcarComoLida(n.id)
    setAberto(false)

    const url = buildNotifUrl({ id: n.id, acao: n.acao, metadata: n.metadata as Record<string, unknown> | null })
    router.push(url)
  }

  // Ao abrir o bell, fecha pushes de importação pendentes no tray
  function handleToggleBell() {
    const abrindo = !aberto
    setAberto(abrindo)
    if (abrindo && ('serviceWorker' in navigator)) {
      navigator.serviceWorker.ready
        .then(reg => reg.active?.postMessage({ type: 'CLOSE_IMPORT_NOTIFICATIONS' }))
        .catch(() => {})
    }
  }

  if (!usuarioEmail) return null

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={handleToggleBell}
        className="relative p-2 rounded-full hover:bg-white/20 transition-colors"
        aria-label="Notificações"
      >
        <Bell className="w-6 h-6 text-gray-700 dark:text-gray-200" />
        {naoLidas > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
            {naoLidas > 99 ? '99+' : naoLidas}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute right-0 top-full mt-2 w-[340px] lg:w-[400px] max-w-[calc(100vw-16px)] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              <span className="font-semibold text-gray-800 dark:text-gray-100">Notificações</span>
              {naoLidas > 0 && (
                <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs font-bold rounded-full">
                  {naoLidas} nova{naoLidas > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {naoLidas > 0 && (
                <button
                  onClick={marcarTodasLidas}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                  title="Marcar todas como lidas"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Todas lidas</span>
                </button>
              )}
              <button
                onClick={() => setAberto(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>

          {/* iOS: precisa instalar o PWA */}
          {iosNaoInstalado && (
            <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800">
              <p className="text-xs text-amber-800 dark:text-amber-300 mb-1 font-medium">
                Instale o app para receber notificações
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                No Safari, toque em <strong>Compartilhar</strong> → <strong>Adicionar à Tela de Início</strong> e reabra o app pelo ícone.
              </p>
            </div>
          )}

          {/* Erro ao registrar push */}
          {erroPush && (
            <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border-b border-red-100 dark:border-red-800">
              <p className="text-xs text-red-700 dark:text-red-300 font-medium mb-0.5">Não foi possível ativar as notificações</p>
              <p className="text-xs text-red-600 dark:text-red-400 break-all">{erroPush}</p>
            </div>
          )}

          {/* Push notification prompt */}
          {!iosNaoInstalado && permissaoPush === 'default' && (
            <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800">
              <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
                Ative as notificações para ser avisado no celular quando o outro usuário fizer uma operação.
              </p>
              <button
                onClick={solicitarPermissaoPush}
                className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors"
              >
                Ativar notificações no celular
              </button>
            </div>
          )}

          {/* Lista */}
          <div className="max-h-[360px] lg:max-h-[520px] overflow-y-auto divide-y divide-gray-50 dark:divide-gray-800">
            {notificacoes.length === 0 ? (
              <div className="py-10 text-center">
                <Bell className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Nenhuma notificação ainda</p>
              </div>
            ) : (
              notificacoes.map(n => {
                const isConflito = n.acao === 'conciliacao_conflito'
                const emResolucao = resolvendo[n.id] ?? false
                const meta = getNotificacaoMeta(n.acao)
                const isClickavel = !isConflito

                return (
                  <div
                    key={n.id}
                    onClick={isClickavel ? () => handleNotificacaoClick(n) : undefined}
                    className={`flex items-start gap-3 px-4 py-3 border-l-4 transition-colors ${meta.corBorda} ${
                      isClickavel ? 'cursor-pointer hover:brightness-95' : ''
                    } ${
                      n.lida
                        ? 'bg-white dark:bg-gray-900 opacity-60'
                        : meta.corFundo
                    }`}
                  >
                    <div className="mt-0.5 flex-shrink-0">{renderIcone(n.acao)}</div>
                    <div className="flex-1 min-w-0">
                      {/* Rótulo do módulo */}
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                          {meta.rotulo}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 leading-snug">
                        {normalizarDescricao(n.descricao)}
                        {n.valor != null && (
                          <span className="text-gray-500 dark:text-gray-400 font-normal">
                            {formatarValor(n.valor)}
                          </span>
                        )}
                      </p>
                      {/* Ações inline de conciliação */}
                      {isConflito && n.metadata && !n.lida && (
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); resolverConflito(n.id, 'aprovar') }}
                            disabled={emResolucao}
                            className="flex items-center gap-1 px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                          >
                            <ThumbsUp className="w-3 h-3" />
                            Aprovar
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); resolverConflito(n.id, 'recusar') }}
                            disabled={emResolucao}
                            className="flex items-center gap-1 px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                          >
                            <ThumbsDown className="w-3 h-3" />
                            Recusar
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-400">
                          {n.nome_usuario ?? n.de_usuario.split('@')[0]}
                        </span>
                        <span className="text-gray-300">·</span>
                        <span className="text-xs text-gray-400">
                          {formatDistanceToNow(new Date(n.created_at), { locale: ptBR, addSuffix: true })}
                        </span>
                      </div>
                    </div>
                    {/* Botão de marcar como lida (apenas para não-clicáveis sem botões inline) */}
                    {!n.lida && isConflito && (
                      <button
                        onClick={(e) => { e.stopPropagation(); marcarComoLida(n.id) }}
                        className="flex-shrink-0 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors mt-0.5"
                        title="Marcar como lida"
                      >
                        <Check className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
})
