'use client'

import { useState, useEffect, useRef, useCallback, type FormEvent, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Heart, ShoppingBasket, X, ChevronLeft,
  Plus, Minus, Check, Loader2, Camera,
  Image as ImageIcon, Sparkles, PenLine, AlertCircle, RotateCcw,
} from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import { supabase } from '@/lib/supabaseClient'
import { notificarWishlist } from '@/lib/notificacoes'
import { compressImage, abortTimeout, callAnalyze } from '@/lib/imageUtils'
import { useOnline } from '@/lib/useOnline'

type View = 'menu' | 'wishlist-method' | 'wishlist' | 'wishlist-ai' | 'mercado'
type AIStatus = 'idle' | 'uploading' | 'done' | 'error'

const PRIORIDADES = [
  { value: 'alta'  as const, label: 'Alta',  active: 'bg-red-100 text-red-600 ring-red-300'     },
  { value: 'media' as const, label: 'Média', active: 'bg-amber-100 text-amber-600 ring-amber-300' },
  { value: 'baixa' as const, label: 'Baixa', active: 'bg-slate-100 text-slate-600 ring-slate-300'  },
]

const CATEGORIAS = ['Eletrônicos', 'Casa', 'Moda', 'Viagem', 'Lazer', 'Esporte', 'Saúde', 'Educação', 'Outros']

async function getUsuario(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.email ?? null
}

// ── Quick Add Wishlist ────────────────────────────────────────────────────────

function QuickAddWishlist({
  onClose,
  onBack,
}: {
  onClose: () => void
  onBack: () => void
}) {
  const nomeRef = useRef<HTMLInputElement>(null)
  const [nome, setNome] = useState('')
  const [valor, setValor] = useState('')
  const [categoria, setCategoria] = useState('')
  const [prioridade, setPrioridade] = useState<'alta' | 'media' | 'baixa'>('media')
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
      const { data, error } = await supabase.from('wishlist_items').insert([{
        nome:           nome.trim(),
        valor_estimado: valor ? parseFloat(valor.replace(',', '.')) : null,
        categoria:      categoria || null,
        prioridade,
        favoritado:     false,
        realizado:      false,
        criado_por,
      }]).select('id').single()
      if (error) throw error
      if (data && criado_por) notificarWishlist(data.id, nome.trim(), criado_por)
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
        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Novo Desejo</h3>
      </div>

      <input
        ref={nomeRef}
        value={nome}
        onChange={e => setNome(e.target.value)}
        placeholder="Descrição do item"
        className="input-base"
        maxLength={80}
        required
      />

      <div className="input-base flex items-center gap-1.5">
        <span className="text-sm text-gray-400 shrink-0">R$</span>
        <input
          type="number"
          inputMode="decimal"
          value={valor}
          onChange={e => setValor(e.target.value)}
          placeholder="0,00"
          className="flex-1 bg-transparent outline-none min-w-0"
          min="0"
          step="0.01"
        />
      </div>

      <select
        value={categoria}
        onChange={e => setCategoria(e.target.value)}
        className="input-base"
      >
        <option value="">Sem categoria</option>
        {CATEGORIAS.map(cat => (
          <option key={cat} value={cat}>{cat}</option>
        ))}
      </select>

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
        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">🛒 Lista de Mercado</h3>
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
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Quantidade</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setQuantidade(q => Math.max(1, q - 1))}
            className="w-8 h-8 rounded-xl bg-white dark:bg-gray-700 shadow-sm border border-gray-100
                       dark:border-gray-600 flex items-center justify-center active:scale-90 transition-all"
          >
            <Minus className="w-3.5 h-3.5 text-gray-600" />
          </button>
          <span className="w-8 text-center font-bold text-gray-900 dark:text-gray-100 text-base num">
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

// ── Wishlist Method Selector ──────────────────────────────────────────────────

function WishlistMethodSelector({
  onManual,
  onAI,
  onBack,
}: {
  onManual: () => void
  onAI: () => void
  onBack: () => void
}) {
  return (
    <div className="flex flex-col gap-4 fab-form-enter">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Voltar"
        >
          <ChevronLeft className="w-5 h-5 text-gray-500" />
        </button>
        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Novo Desejo</h3>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onManual}
          className="flex items-center gap-4 p-4 rounded-2xl bg-gray-50 dark:bg-gray-800
                     ring-1 ring-gray-100 dark:ring-gray-700
                     active:scale-[0.98] transition-all duration-150
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
        >
          <div className="w-10 h-10 rounded-xl bg-white dark:bg-gray-700 shadow-sm
                          flex items-center justify-center flex-none">
            <PenLine className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Adicionar Manualmente</p>
            <p className="text-xs text-gray-400 mt-0.5">Preencha os dados do item</p>
          </div>
        </button>

        <button
          type="button"
          onClick={onAI}
          className="flex items-center gap-4 p-4 rounded-2xl bg-violet-50 dark:bg-violet-950/40
                     ring-1 ring-violet-100 dark:ring-violet-900/50
                     active:scale-[0.98] transition-all duration-150
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/60 shadow-sm
                          flex items-center justify-center flex-none">
            <Sparkles className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">Identificar com IA</p>
            <p className="text-xs text-violet-400 dark:text-violet-500 mt-0.5">Tire uma foto ou escolha da galeria</p>
          </div>
        </button>
      </div>
    </div>
  )
}

// ── Wishlist AI Capture ───────────────────────────────────────────────────────
// Mirrors the share-receiver flow: create pending item → upload image →
// fire /api/share-receiver/analyze (same service used by auto-analyze loop) →
// dispatch wishlist:refresh → close. The wishlist page handles realtime updates.

function WishlistAICapture({
  onClose,
  onBack,
  onFallback,
}: {
  onClose: () => void
  onBack: () => void
  onFallback: () => void
}) {
  const router = useRouter()
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  const [status, setStatus] = useState<AIStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const processFile = useCallback(async (file: File) => {
    const objectUrl = URL.createObjectURL(file)
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return objectUrl })
    setStatus('uploading')
    setErrorMsg('')

    try {
      const { base64, mimeType } = await compressImage(file)
      const criado_por = await getUsuario()

      // 1. Create item with ai_status 'pendente' — identical to share-receiver/route.ts
      const { data: newItem, error: insertError } = await supabase.from('wishlist_items').insert([{
        nome:       'Identificando…',
        prioridade: 'media',
        ai_status:  'pendente',
        fonte:      'compartilhamento',
        favoritado: false,
        realizado:  false,
        criado_por,
      }]).select('id').single()

      if (insertError || !newItem) throw insertError ?? new Error('insert')

      // 2. Upload image — same endpoint used by share-receiver (sets imagem_url)
      await fetch('/api/wishlist-items/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: newItem.id, imageBase64: base64, imageMimeType: mimeType }),
        signal: abortTimeout(20000),
      })

      // 3. Fire analyze in background — same service as share-recebido/page.tsx and auto-analyze loop.
      //    imageBase64 provided directly so the server skips CDN download (faster path).
      callAnalyze(newItem.id, base64, mimeType, criado_por).catch(() => {})

      // 4. Notify + trigger realtime — wishlist page auto-analyze and realtime handle the rest
      if (criado_por) notificarWishlist(newItem.id, 'Identificando…', criado_por)
      window.dispatchEvent(new CustomEvent('wishlist:refresh'))

      setStatus('done')
    } catch (e) {
      setStatus('error')
      setErrorMsg(
        e instanceof DOMException && e.name === 'AbortError'
          ? 'Tempo esgotado. Tente novamente.'
          : 'Erro ao enviar. Tente novamente.',
      )
    }
  }, [])

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  function resetToIdle() {
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    setStatus('idle')
    setErrorMsg('')
  }

  // ── idle: pick source ──
  if (status === 'idle') {
    return (
      <div className="flex flex-col gap-4 fab-form-enter">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Voltar"
          >
            <ChevronLeft className="w-5 h-5 text-gray-500" />
          </button>
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Identificar com IA</h3>
        </div>

        <div className="flex flex-col items-center py-2 gap-2">
          <div className="w-14 h-14 rounded-2xl bg-violet-50 dark:bg-violet-950/40 flex items-center justify-center">
            <Sparkles className="w-7 h-7 text-violet-500" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center leading-relaxed">
            Selecione uma foto do produto para identificação automática
          </p>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex-1 flex flex-col items-center gap-2.5 py-5 rounded-2xl
                       bg-gray-50 dark:bg-gray-800 ring-1 ring-gray-100 dark:ring-gray-700
                       active:scale-[0.98] transition-all duration-150"
          >
            <Camera className="w-6 h-6 text-gray-600 dark:text-gray-300" />
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Câmera</span>
          </button>

          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            className="flex-1 flex flex-col items-center gap-2.5 py-5 rounded-2xl
                       bg-gray-50 dark:bg-gray-800 ring-1 ring-gray-100 dark:ring-gray-700
                       active:scale-[0.98] transition-all duration-150"
          >
            <ImageIcon className="w-6 h-6 text-gray-600 dark:text-gray-300" />
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Galeria</span>
          </button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileChange}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    )
  }

  // ── uploading ──
  if (status === 'uploading') {
    return (
      <div className="flex flex-col gap-4 fab-form-enter">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 flex-none" />
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Enviando…</h3>
        </div>

        {previewUrl ? (
          <div className="relative w-full h-36 rounded-2xl overflow-hidden bg-gray-100 dark:bg-gray-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-6 h-6 text-white animate-spin" />
              <span className="text-white text-xs font-medium">Enviando…</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center py-8 gap-3">
            <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Enviando…</p>
          </div>
        )}
      </div>
    )
  }

  // ── done ──
  if (status === 'done') {
    return (
      <div className="flex flex-col items-center gap-4 py-2 fab-form-enter">
        <div className="w-14 h-14 rounded-full bg-green-50 dark:bg-green-950/40 flex items-center justify-center">
          <Check className="w-7 h-7 text-green-500" strokeWidth={2.5} />
        </div>
        <div className="text-center">
          <p className="text-base font-bold text-gray-800 dark:text-gray-100">Enviado!</p>
          <p className="text-xs text-gray-400 mt-1">Identificando produto em segundo plano…</p>
        </div>
        <button
          type="button"
          onClick={() => { onClose(); router.push('/wishlist?ordem=mais-novo') }}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl
                     bg-primary-600 text-white font-semibold text-sm
                     active:scale-[0.98] transition-all duration-150"
        >
          Ver na Wishlist
        </button>
      </div>
    )
  }

  // ── error ──
  return (
    <div className="flex flex-col gap-4 fab-form-enter">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-gray-500" />
        </button>
        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Erro</h3>
      </div>

      <div className="flex flex-col items-center py-3 gap-3">
        <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-950/40 flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-red-400" />
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
          {errorMsg || 'Algo deu errado. Tente novamente.'}
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={resetToIdle}
          className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl
                     bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200
                     font-semibold text-sm active:scale-[0.98] transition-all duration-150"
        >
          <RotateCcw className="w-4 h-4" />
          Tentar novamente
        </button>
        <button
          type="button"
          onClick={onFallback}
          className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl
                     bg-primary-600 text-white font-semibold text-sm
                     active:scale-[0.98] transition-all duration-150"
        >
          <PenLine className="w-4 h-4" />
          Manual
        </button>
      </div>
    </div>
  )
}

// ── Menu grid ─────────────────────────────────────────────────────────────────

const OPCOES = [
  {
    id:         'wishlist' as const,
    targetView: 'wishlist-method' as View,
    label:      'Wishlist',
    emoji:      '💖',
    bg:         'bg-pink-50  dark:bg-pink-950/40',
    cor:        'text-pink-700 dark:text-pink-400',
    ring:       'ring-pink-100 dark:ring-pink-900/50',
    Icon:       Heart,
  },
  {
    id:         'mercado' as const,
    targetView: 'mercado' as View,
    label:      'Lista de Mercado',
    emoji:      '🛒',
    bg:         'bg-green-50   dark:bg-green-950/40',
    cor:        'text-green-700  dark:text-green-400',
    ring:       'ring-green-100  dark:ring-green-900/50',
    Icon:       ShoppingBasket,
  },
]

// ── Main component ────────────────────────────────────────────────────────────

export default function FabQuickLaunchSheet({ onClose }: { onClose: () => void }) {
  const isOnline = useOnline()
  const [view, setView] = useState<View>('menu')

  // When offline: redirect away from wishlist-related views
  useEffect(() => {
    if (!isOnline && (view === 'wishlist' || view === 'wishlist-method' || view === 'wishlist-ai')) {
      setView('menu')
    }
  }, [isOnline, view])

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (view === 'menu') onClose()
      else if (view === 'wishlist' || view === 'wishlist-ai') setView('wishlist-method')
      else setView('menu')
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [view, onClose])

  // Offline: filter to only mercado option
  const opcoesVisiveis = isOnline ? OPCOES : OPCOES.filter(o => o.id === 'mercado')

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
                    <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
                      Lançamento Rápido
                    </h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {isOnline ? 'O que deseja registrar?' : 'Disponível offline'}
                    </p>
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

                <div className={`grid gap-3 ${opcoesVisiveis.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {opcoesVisiveis.map(({ id, targetView, label, emoji, bg, cor, ring }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setView(targetView)}
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

            {view === 'wishlist-method' && (
              <WishlistMethodSelector
                onManual={() => setView('wishlist')}
                onAI={() => setView('wishlist-ai')}
                onBack={() => setView('menu')}
              />
            )}

            {view === 'wishlist' && (
              <QuickAddWishlist onClose={onClose} onBack={() => setView('wishlist-method')} />
            )}

            {view === 'wishlist-ai' && (
              <WishlistAICapture
                onClose={onClose}
                onBack={() => setView('wishlist-method')}
                onFallback={() => setView('wishlist')}
              />
            )}

            {view === 'mercado' && (
              <QuickAddMercado
                onClose={onClose}
                onBack={isOnline ? () => setView('menu') : onClose}
              />
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
