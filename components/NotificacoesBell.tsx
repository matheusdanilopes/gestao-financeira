'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, X, Check, CheckCheck, PiggyBank, CreditCard, TrendingUp, BellOff, BellRing } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AUTH_DISABLED } from '@/lib/authConfig'

interface Notificacao {
  id: string
  de_usuario: string
  nome_usuario: string | null
  acao: string
  descricao: string
  valor: number | null
  lida: boolean
  created_at: string
}

// Chave pública VAPID — segura para ser embutida no código do cliente
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  || 'BDnHVc8WTIUWZKjh2tuazldgVjCXrhN8FrsZHfovhmIhW1Rm5_j-iDWtzEqrAQMzogD7KvBd9sgFkkQpV34tO-M'

function iconeAcao(acao: string) {
  if (acao === 'aporte') return <PiggyBank className="w-4 h-4 text-green-500" />
  if (acao === 'pagar') return <CreditCard className="w-4 h-4 text-blue-500" />
  if (acao === 'receber') return <TrendingUp className="w-4 h-4 text-purple-500" />
  return <Bell className="w-4 h-4 text-gray-400" />
}

function corAcao(acao: string) {
  if (acao === 'aporte') return 'border-l-green-400'
  if (acao === 'pagar') return 'border-l-blue-400'
  if (acao === 'receber') return 'border-l-purple-400'
  return 'border-l-gray-300'
}

function formatarValor(valor: number | null): string {
  if (valor == null) return ''
  return ` — R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const arr = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i)
  return arr.buffer
}

async function registrarPush(usuarioEmail: string): Promise<'ok' | 'sem-suporte' | 'erro'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'sem-suporte'

  try {
    // Garante que o service worker está ativo antes de assinar
    const reg = await navigator.serviceWorker.ready

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      })
    }

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // sub.toJSON() serializa endpoint + keys corretamente
      body: JSON.stringify({ usuario: usuarioEmail, subscription: sub.toJSON() }),
    })

    return res.ok ? 'ok' : 'erro'
  } catch (err) {
    console.error('[push] Falha ao registrar subscription:', err)
    return 'erro'
  }
}

export default function NotificacoesBell() {
  const [aberto, setAberto] = useState(false)
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([])
  const [usuarioEmail, setUsuarioEmail] = useState<string | null>(null)
  const [permissaoPush, setPermissaoPush] = useState<NotificationPermission | null>(null)
  const [pushStatus, setPushStatus] = useState<'idle' | 'registrando' | 'ativo' | 'erro'>('idle')
  const dropdownRef = useRef<HTMLDivElement>(null)

  const naoLidas = notificacoes.filter(n => !n.lida).length

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
      await inicializarServiceWorker(user.email)
    }
    init()
  }, [])

  useEffect(() => {
    if (!usuarioEmail) return
    const channel = supabase
      .channel('notificacoes_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificacoes' }, (payload) => {
        const nova = payload.new as Notificacao
        if (nova.de_usuario !== usuarioEmail) {
          setNotificacoes(prev => [nova, ...prev])
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notificacoes' }, (payload) => {
        const atualizada = payload.new as Notificacao
        setNotificacoes(prev => prev.map(n => n.id === atualizada.id ? atualizada : n))
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [usuarioEmail])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAberto(false)
      }
    }
    if (aberto) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [aberto])

  async function carregarNotificacoes(email: string) {
    const { data } = await supabase
      .from('notificacoes')
      .select('*')
      .neq('de_usuario', email)
      .order('created_at', { ascending: false })
      .limit(50)
    setNotificacoes(data ?? [])
  }

  async function inicializarServiceWorker(email: string) {
    if (!('serviceWorker' in navigator)) return
    try {
      await navigator.serviceWorker.register('/sw.js')
      const perm = Notification.permission
      setPermissaoPush(perm)
      if (perm === 'granted') {
        setPushStatus('registrando')
        const resultado = await registrarPush(email)
        setPushStatus(resultado === 'ok' ? 'ativo' : 'erro')
      }
    } catch (err) {
      console.error('[sw] Falha ao registrar service worker:', err)
    }
  }

  async function solicitarPermissaoPush() {
    if (!usuarioEmail) return
    const perm = await Notification.requestPermission()
    setPermissaoPush(perm)
    if (perm === 'granted') {
      setPushStatus('registrando')
      const resultado = await registrarPush(usuarioEmail)
      setPushStatus(resultado === 'ok' ? 'ativo' : 'erro')
    } else {
      setPushStatus('idle')
    }
  }

  async function marcarComoLida(id: string) {
    await supabase.from('notificacoes').update({ lida: true }).eq('id', id)
    setNotificacoes(prev => prev.map(n => n.id === id ? { ...n, lida: true } : n))
  }

  async function marcarTodasLidas() {
    const ids = notificacoes.filter(n => !n.lida).map(n => n.id)
    if (!ids.length) return
    await supabase.from('notificacoes').update({ lida: true }).in('id', ids)
    setNotificacoes(prev => prev.map(n => ({ ...n, lida: true })))
  }

  if (!usuarioEmail) return null

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setAberto(v => !v)}
        className="relative p-2 rounded-full hover:bg-black/10 transition-colors"
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
        <div className="absolute right-0 top-full mt-2 w-[340px] max-w-[calc(100vw-16px)] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden">

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

          {/* Status do push */}
          {permissaoPush === 'default' && (
            <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800">
              <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
                Ative para receber alertas no celular quando o outro usuário registrar uma operação.
              </p>
              <button
                onClick={solicitarPermissaoPush}
                className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                Ativar notificações no celular
              </button>
            </div>
          )}

          {permissaoPush === 'granted' && pushStatus === 'registrando' && (
            <div className="px-4 py-2 bg-yellow-50 border-b border-yellow-100 flex items-center gap-2">
              <span className="text-xs text-yellow-700">Ativando notificações…</span>
            </div>
          )}

          {permissaoPush === 'granted' && pushStatus === 'ativo' && (
            <div className="px-4 py-2 bg-green-50 dark:bg-green-900/20 border-b border-green-100 dark:border-green-800 flex items-center gap-2">
              <BellRing className="w-3.5 h-3.5 text-green-600" />
              <span className="text-xs text-green-700 dark:text-green-300">Notificações ativas neste dispositivo</span>
            </div>
          )}

          {permissaoPush === 'granted' && pushStatus === 'erro' && (
            <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border-b border-red-100 dark:border-red-800">
              <div className="flex items-center gap-2 mb-1.5">
                <BellOff className="w-3.5 h-3.5 text-red-500" />
                <span className="text-xs font-semibold text-red-700 dark:text-red-300">Falha ao ativar push</span>
              </div>
              <button
                onClick={solicitarPermissaoPush}
                className="w-full py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {permissaoPush === 'denied' && (
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
              <BellOff className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-xs text-gray-500">Notificações bloqueadas nas configurações do navegador</span>
            </div>
          )}

          {/* Lista */}
          <div className="max-h-[360px] overflow-y-auto divide-y divide-gray-50 dark:divide-gray-800">
            {notificacoes.length === 0 ? (
              <div className="py-10 text-center">
                <Bell className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Nenhuma notificação ainda</p>
              </div>
            ) : (
              notificacoes.map(n => (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 border-l-4 transition-colors ${corAcao(n.acao)} ${
                    n.lida ? 'bg-white dark:bg-gray-900 opacity-60' : 'bg-blue-50/40 dark:bg-blue-900/10'
                  }`}
                >
                  <div className="mt-0.5 flex-shrink-0">{iconeAcao(n.acao)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100 leading-snug">
                      {n.descricao}{formatarValor(n.valor)}
                    </p>
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
                  {!n.lida && (
                    <button
                      onClick={() => marcarComoLida(n.id)}
                      className="flex-shrink-0 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors mt-0.5"
                      title="Marcar como lida"
                    >
                      <Check className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
