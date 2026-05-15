'use client'

import { useState, useEffect, useRef, type FormEvent } from 'react'
import {
  Heart, ShoppingBasket, X, ChevronLeft,
  Plus, Minus, Check, Loader2,
} from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import { supabase } from '@/lib/supabaseClient'

type View = 'menu' | 'wishlist' | 'mercado'

const PRIORIDADES = [
  { value: 'alta'  as const, label: 'Alta',  active: 'bg-red-100 text-red-600 ring-red-300'     },
  { value: 'media' as const, label: 'Média', active: 'bg-amber-100 text-amber-600 ring-amber-300' },
  { value: 'baixa' as const, label: 'Baixa', active: 'bg-slate-100 text-slate-600 ring-slate-300'  },
]

const QUICK_EMOJIS = [
  '💻','📱','🎮','👗','🏠','✈️',
  '🏋️','📚','🎁','🌟','💎','🍷',
]

async function getUsuario(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.email ?? null
}

// ── Quick Add Wishlist / Pedido ───────────────────────────────────────────────

function QuickAddWishlist({
  onClose,
  onBack,
}: {
  onClose: () => void
  onBack: () => void
}) {
  const nomeRef = useRef<HTMLInputElement>(null)
  const [nome, setNome] = useState('')
  const [prioridade, setPrioridade] = useState<'alta' | 'media' | 'baixa'>('media')
  const [emoji, setEmoji] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    const t = setTimeout(() => nomeRef.current?.focus(), 200)
    return () => clearTimeout(t)
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim()) return
    setSalvando(true)
    setErro('')
    try {
      const criado_por = await getUsuario()
      const { error } = await supabase.from('wishlist_items').insert([{
        nome:       nome.trim(),
        emoji:      emoji || null,
        prioridade,
        categoria:  null,
        favoritado: false,
        realizado:  false,
        criado_por,
      }])
      if (error) throw error
      window.dispatchEvent(new CustomEvent('wishlist:refresh'))
      onClose()
    } catch {
      setErro('Erro ao salvar. Tente novamente.')
      setSalvando(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 fab-form-enter">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Voltar"
        >
          <ChevronLeft className="w-5 h-5 text-gray-500" />
        </button>
        <h3 className="text-base font-bold text-gray-900">💖 Novo Desejo</h3>
      </div>

      <input
        ref={nomeRef}
        value={nome}
        onChange={e => setNome(e.target.value)}
        placeholder={isPedido ? 'O que você quer pedir?' : 'O que você deseja?'}
        className="input-base"
        maxLength={80}
        required
      />

      <div className="flex gap-1.5 flex-wrap">
        {QUICK_EMOJIS.map(e => (
          <button
            key={e}
            type="button"
            onClick={() => setEmoji(prev => prev === e ? '' : e)}
            className={`text-xl p-1.5 rounded-xl transition-all active:scale-90
                        ${emoji === e
                          ? 'bg-primary-100 ring-2 ring-primary-400 scale-110'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
          >
            {e}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        {PRIORIDADES.map(p => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPrioridade(p.value)}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ring-1
                        ${prioridade === p.value
                          ? `${p.active} ring-2 scale-[1.03]`
                          : 'bg-gray-50 text-gray-400 ring-gray-100 dark:bg-gray-800 dark:ring-gray-700'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {erro && <p className="text-xs text-red-500">{erro}</p>}

      <button
        type="submit"
        disabled={salvando || !nome.trim()}
        className="flex items-center justify-center gap-2 py-3.5 rounded-2xl
                   bg-primary-600 text-white font-semibold text-sm
                   disabled:opacity-50 active:scale-[0.98] transition-all duration-150
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2"
      >
        {salvando
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <Check className="w-4 h-4" strokeWidth={2.5} />}
        {salvando ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  )
}

// ── Quick Add Lista Mercado ───────────────────────────────────────────────────

function QuickAddMercado({
  onClose,
  onBack,
}: {
  onClose: () => void
  onBack: () => void
}) {
  const nomeRef = useRef<HTMLInputElement>(null)
  const [nome, setNome] = useState('')
  const [quantidade, setQuantidade] = useState(1)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    const t = setTimeout(() => nomeRef.current?.focus(), 200)
    return () => clearTimeout(t)
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim()) return
    setSalvando(true)
    setErro('')
    try {
      const criado_por = await getUsuario()
      const { error } = await supabase.from('lista_mercado_itens').insert([{
        nome:       nome.trim(),
        quantidade,
        preco_unit: null,
        comprado:   false,
        criado_por,
      }])
      if (error) throw error
      window.dispatchEvent(new CustomEvent('lista-mercado:refresh'))
      onClose()
    } catch {
      setErro('Erro ao salvar. Tente novamente.')
      setSalvando(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 fab-form-enter">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Voltar"
        >
          <ChevronLeft className="w-5 h-5 text-gray-500" />
        </button>
        <h3 className="text-base font-bold text-gray-900">🛒 Lista de Mercado</h3>
      </div>

      <input
        ref={nomeRef}
        value={nome}
        onChange={e => setNome(e.target.value)}
        placeholder="Nome do item"
        className="input-base"
        maxLength={60}
        required
      />

      <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-2xl px-4 py-3">
        <span className="text-sm font-medium text-gray-700">Quantidade</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setQuantidade(q => Math.max(1, q - 1))}
            className="w-8 h-8 rounded-xl bg-white dark:bg-gray-700 shadow-sm border border-gray-100
                       dark:border-gray-600 flex items-center justify-center active:scale-90 transition-all"
          >
            <Minus className="w-3.5 h-3.5 text-gray-600" />
          </button>
          <span className="w-8 text-center font-bold text-gray-900 text-base num">
            {quantidade}
          </span>
          <button
            type="button"
            onClick={() => setQuantidade(q => q + 1)}
            className="w-8 h-8 rounded-xl bg-primary-600
                       flex items-center justify-center active:scale-90 transition-all"
          >
            <Plus className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>

      {erro && <p className="text-xs text-red-500">{erro}</p>}

      <button
        type="submit"
        disabled={salvando || !nome.trim()}
        className="flex items-center justify-center gap-2 py-3.5 rounded-2xl
                   bg-green-600 text-white font-semibold text-sm
                   disabled:opacity-50 active:scale-[0.98] transition-all duration-150
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-2"
      >
        {salvando
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <Check className="w-4 h-4" strokeWidth={2.5} />}
        {salvando ? 'Salvando…' : 'Adicionar à lista'}
      </button>
    </form>
  )
}

// ── Menu grid ─────────────────────────────────────────────────────────────────

const OPCOES = [
  {
    id:    'wishlist' as const,
    label: 'Wishlist',
    emoji: '💖',
    bg:    'bg-pink-50  dark:bg-pink-950/40',
    cor:   'text-pink-700 dark:text-pink-400',
    ring:  'ring-pink-100 dark:ring-pink-900/50',
    Icon:  Heart,
  },
  {
    id:    'mercado'  as const,
    label: 'Lista de Mercado',
    emoji: '🛒',
    bg:    'bg-green-50   dark:bg-green-950/40',
    cor:   'text-green-700  dark:text-green-400',
    ring:  'ring-green-100  dark:ring-green-900/50',
    Icon:  ShoppingBasket,
  },
]

// ── Main component ────────────────────────────────────────────────────────────

export default function FabQuickLaunchSheet({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<View>('menu')

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (view !== 'menu') setView('menu')
        else onClose()
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [view, onClose])

  return (
    <ModalPortal>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[199] fab-sheet-overlay"
        style={{ background: 'rgba(0,0,0,0.45)' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Lançamento rápido"
        className="fixed bottom-0 left-0 right-0 z-[200] fab-sheet"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <div className="bg-white dark:bg-gray-900 rounded-t-[28px] shadow-2xl mx-auto max-w-lg overflow-hidden">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-9 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
          </div>

          <div className="px-5 pb-5 pt-2">
            {view === 'menu' && (
              <div className="fab-form-enter">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-base font-bold text-gray-900">
                      Lançamento Rápido
                    </h2>
                    <p className="text-xs text-gray-400 mt-0.5">O que deseja registrar?</p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800
                               transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    aria-label="Fechar"
                  >
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {OPCOES.map(({ id, label, emoji, bg, cor, ring }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setView(id)}
                      className={`flex flex-col items-center gap-2.5 p-4 rounded-2xl
                                  ${bg} ring-1 ${ring}
                                  active:scale-95 transition-all duration-150
                                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400`}
                    >
                      <span className="text-2xl leading-none select-none">{emoji}</span>
                      <span className={`text-xs font-bold ${cor} text-center leading-tight`}>
                        {label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {view === 'wishlist' && (
              <QuickAddWishlist onClose={onClose} onBack={() => setView('menu')} />
            )}

            {view === 'mercado' && (
              <QuickAddMercado onClose={onClose} onBack={() => setView('menu')} />
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
