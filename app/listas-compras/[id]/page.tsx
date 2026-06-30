'use client'

import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Plus, Minus, Check, Pencil, MoreHorizontal, Crown, Heart,
  Trash2, X, ChevronRight,
} from 'lucide-react'
import Link from 'next/link'
import ModalPortal from '@/components/ModalPortal'
import { SwipeableItem } from '@/components/SwipeableItem'
import { useItensLista, useSublistasLista, type ItemListaCompras, type ListaComMeta } from '@/lib/useListasCompras'
import { supabase } from '@/lib/supabaseClient'
import { formatBRL } from '@/lib/logger'

// ── Helpers ───────────────────────────────────────────────────────────────────

function nomeCurto(email: string | null): string {
  if (!email) return ''
  const parte = email.split('@')[0].split('.')[0].split('_')[0]
  return parte.charAt(0).toUpperCase() + parte.slice(1)
}

const USER_PALETTE = [
  'bg-violet-100 text-violet-700',
  'bg-orange-100 text-orange-700',
  'bg-teal-100 text-teal-700',
  'bg-emerald-100 text-emerald-700',
  'bg-rose-100 text-rose-700',
  'bg-sky-100 text-sky-700',
]

function emailHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function corUsuario(email: string | null): string {
  if (!email) return 'bg-gray-100 text-gray-500'
  if (email === 'conjunto') return 'bg-purple-100 text-purple-700'
  const e = email.toLowerCase()
  if (e.includes('matheus')) return 'bg-matheus-light text-matheus'
  if (e.includes('jeniffer') || e.includes('jennifer')) return 'bg-jeniffer-light text-jeniffer'
  return USER_PALETTE[emailHash(email) % USER_PALETTE.length]
}

function labelPessoa(email: string): string {
  if (email === 'conjunto') return 'Conjunto'
  return nomeCurto(email)
}

function parsearPreco(s: string): number | null {
  const num = s.replace(',', '.').trim()
  const v = parseFloat(num)
  return isNaN(v) || v < 0 ? null : v
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ mensagem, onClose }: { mensagem: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <ModalPortal>
      <div className="fixed bottom-24 left-4 right-4 z-[300] max-w-md mx-auto toast-enter">
        <div className="flex items-center gap-3 bg-gray-900 text-white rounded-2xl px-4 py-3.5 shadow-float">
          <Heart className="w-4 h-4 text-pink-400 flex-none" strokeWidth={1.8} />
          <p className="flex-1 text-sm font-medium">{mensagem}</p>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            aria-label="Fechar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </ModalPortal>
  )
}

// ── Bottom Sheet Preço Pago ───────────────────────────────────────────────────

function BottomSheetPrecoPago({
  item,
  onClose,
  onConfirmar,
}: {
  item: ItemListaCompras
  onClose: () => void
  onConfirmar: (preco: number | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [valor, setValor] = useState(
    item.preco_previsto != null ? String(item.preco_previsto).replace('.', ',') : ''
  )
  const [keyboardOffset, setKeyboardOffset] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const viewport = vv
    function update() {
      setKeyboardOffset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop))
    }
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  function handleConfirmar(preco: number | null) {
    onConfirmar(preco)
    onClose()
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[200] flex items-end modal-overlay"
        style={{ background: 'rgba(0,0,0,0.45)', paddingBottom: keyboardOffset }}
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <div className="w-full bg-white rounded-t-3xl shadow-2xl px-5 pt-2 pb-6 modal-sheet">
          <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-5" />
          <p className="text-[11px] text-gray-400 mb-0.5 font-semibold uppercase tracking-wide">Marcar como comprado</p>
          <p className="text-base font-bold text-gray-900 mb-5 truncate">{item.nome}</p>

          <form onSubmit={e => { e.preventDefault(); handleConfirmar(parsearPreco(valor)) }}>
            <p className="text-xs text-gray-500 font-medium mb-2">Preço pago <span className="text-gray-400">(opcional)</span></p>
            <div className="relative mb-4">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-semibold">R$</span>
              <input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                value={valor}
                onChange={e => setValor(e.target.value)}
                placeholder="0,00"
                className="w-full pl-10 pr-4 py-3 text-lg font-semibold text-gray-900 bg-gray-50
                           border border-gray-200 rounded-2xl focus:outline-none focus:ring-2
                           focus:ring-primary-400 focus:border-transparent num"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleConfirmar(null)}
                className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600
                           hover:bg-gray-50 active:bg-gray-100 transition-colors"
              >
                Pular
              </button>
              <button
                type="submit"
                className="flex-1 py-3 rounded-2xl bg-green-500 text-white text-sm font-semibold
                           hover:bg-green-600 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" strokeWidth={2.5} />
                Confirmar
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  )
}

// ── Bottom Sheet Editar Item ──────────────────────────────────────────────────

function BottomSheetEditarItem({
  item,
  usuariosConhecidos,
  onClose,
  onSalvar,
  onMoverWishlist,
  onExcluir,
}: {
  item: ItemListaCompras
  usuariosConhecidos: string[]
  onClose: () => void
  onSalvar: (id: string, campos: Partial<ItemListaCompras>) => void
  onMoverWishlist: (id: string) => Promise<void>
  onExcluir: (id: string) => Promise<void>
}) {
  const [nome, setNome] = useState(item.nome)
  const [quantidade, setQuantidade] = useState(item.quantidade)
  const [pessoa, setPessoa] = useState<string | null>(item.pessoa ?? null)
  const [precoPrevisto, setPrecoPrevisto] = useState(
    item.preco_previsto != null ? String(item.preco_previsto).replace('.', ',') : ''
  )
  const [precoPago, setPrecoPago] = useState(
    item.preco_pago != null ? String(item.preco_pago).replace('.', ',') : ''
  )
  const [loading, setLoading] = useState(false)

  function handleSalvar() {
    const campos: Partial<ItemListaCompras> = {
      nome: nome.trim() || item.nome,
      quantidade,
      pessoa: pessoa || null,
      preco_previsto: parsearPreco(precoPrevisto),
      preco_pago: parsearPreco(precoPago),
    }
    onSalvar(item.id, campos)
    onClose()
  }

  async function handleMoverWishlist() {
    setLoading(true)
    try {
      await onMoverWishlist(item.id)
      onClose()
    } catch { /* noop */ } finally {
      setLoading(false)
    }
  }

  async function handleExcluir() {
    setLoading(true)
    try {
      await onExcluir(item.id)
      onClose()
    } catch { /* noop */ } finally {
      setLoading(false)
    }
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[200] flex items-end modal-overlay"
        style={{ background: 'rgba(0,0,0,0.45)' }}
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <div className="w-full bg-white rounded-t-3xl shadow-2xl px-5 pt-2 pb-10 modal-sheet max-h-[90vh] overflow-y-auto">
          <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-5" />
          <p className="text-[11px] text-gray-400 mb-4 font-semibold uppercase tracking-wide">Editar item</p>

          <div className="space-y-4">
            {/* Nome */}
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Nome</label>
              <input
                type="text"
                value={nome}
                onChange={e => setNome(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5
                           focus:outline-none focus:ring-2 focus:ring-primary-400"
                maxLength={120}
              />
            </div>

            {/* Quantidade */}
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Quantidade</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setQuantidade(q => Math.max(1, q - 1))}
                  disabled={quantidade <= 1}
                  className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center
                             text-gray-600 hover:bg-gray-200 disabled:opacity-30 transition-colors"
                >
                  <Minus className="w-4 h-4" strokeWidth={2.5} />
                </button>
                <span className="text-base font-bold text-gray-900 w-8 text-center tabular-nums">{quantidade}</span>
                <button
                  type="button"
                  onClick={() => setQuantidade(q => q + 1)}
                  className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center
                             text-gray-600 hover:bg-gray-200 transition-colors"
                >
                  <Plus className="w-4 h-4" strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {/* Pessoa */}
            {usuariosConhecidos.length > 0 && (
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-2 block">
                  Pessoa <span className="font-normal text-gray-400">(opcional)</span>
                </label>
                <div className="flex gap-2 flex-wrap">
                  {usuariosConhecidos.map(email => {
                    const ativo = pessoa === email
                    const cor = corUsuario(email)
                    return (
                      <button
                        key={email}
                        type="button"
                        onClick={() => setPessoa(ativo ? null : email)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all
                                    ${ativo
                                      ? `${cor} ring-2 ring-inset ring-current`
                                      : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                      >
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-none
                                         ${ativo ? 'bg-white/40' : cor}`}>
                          {ativo
                            ? <Check className="w-3.5 h-3.5" strokeWidth={3} />
                            : labelPessoa(email)[0]
                          }
                        </span>
                        <span className="text-sm font-semibold">{labelPessoa(email)}</span>
                      </button>
                    )
                  })}
                  {/* Conjunto */}
                  {(() => {
                    const ativo = pessoa === 'conjunto'
                    return (
                      <button
                        type="button"
                        onClick={() => setPessoa(ativo ? null : 'conjunto')}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all
                                    ${ativo
                                      ? 'bg-purple-100 text-purple-700 ring-2 ring-inset ring-current'
                                      : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                      >
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-none
                                         ${ativo ? 'bg-white/40' : 'bg-purple-100 text-purple-700'}`}>
                          {ativo
                            ? <Check className="w-3.5 h-3.5" strokeWidth={3} />
                            : <Heart className="w-3.5 h-3.5" fill="currentColor" strokeWidth={0} />
                          }
                        </span>
                        <span className="text-sm font-semibold">Conjunto</span>
                      </button>
                    )
                  })()}
                </div>
              </div>
            )}

            {/* Preços */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">
                  Preço previsto <span className="font-normal text-gray-400">(opt)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-semibold">R$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={precoPrevisto}
                    onChange={e => setPrecoPrevisto(e.target.value)}
                    placeholder="0,00"
                    className="w-full pl-8 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl
                               focus:outline-none focus:ring-2 focus:ring-primary-400 num"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">
                  Preço pago <span className="font-normal text-gray-400">(opt)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-semibold">R$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={precoPago}
                    onChange={e => setPrecoPago(e.target.value)}
                    placeholder="0,00"
                    className="w-full pl-8 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl
                               focus:outline-none focus:ring-2 focus:ring-primary-400 num"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Ações */}
          <div className="mt-6 space-y-2">
            <button
              type="button"
              onClick={handleSalvar}
              className="w-full py-3 rounded-2xl bg-primary-600 text-white text-sm font-semibold
                         active:scale-95 transition-all"
            >
              Salvar
            </button>
            <button
              type="button"
              onClick={handleMoverWishlist}
              disabled={loading}
              className="w-full py-3 rounded-2xl border border-pink-200 bg-pink-50 text-pink-600
                         text-sm font-semibold flex items-center justify-center gap-2
                         hover:bg-pink-100 active:scale-95 transition-all disabled:opacity-40"
            >
              <Heart className="w-4 h-4" strokeWidth={1.8} />
              Mover p/ Wishlist
            </button>
            <button
              type="button"
              onClick={handleExcluir}
              disabled={loading}
              className="w-full py-3 rounded-2xl border border-red-100 bg-red-50 text-red-600
                         text-sm font-semibold flex items-center justify-center gap-2
                         hover:bg-red-100 active:scale-95 transition-all disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4" strokeWidth={1.8} />
              Excluir item
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}

// ── Item Row ──────────────────────────────────────────────────────────────────

function ItemRow({
  item,
  onCheckbox,
  onAlterarQtd,
  onAcoes,
  onExcluir,
}: {
  item: ItemListaCompras
  onCheckbox: (item: ItemListaCompras) => void
  onAlterarQtd: (id: string, delta: number) => void
  onAcoes: (item: ItemListaCompras) => void
  onExcluir: (id: string) => Promise<void>
}) {
  const [editandoNome, setEditandoNome] = useState(false)
  const [nomeLocal, setNomeLocal] = useState(item.nome)
  const inputNomeRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setNomeLocal(item.nome) }, [item.nome])

  function ativarEdicao() {
    if (item.status === 'comprado') return
    setEditandoNome(true)
    setTimeout(() => inputNomeRef.current?.focus(), 50)
  }

  const comprado = item.status === 'comprado'

  return (
    <SwipeableItem onDelete={() => onExcluir(item.id)} disabled={editandoNome} requireConfirmation>
      <div className={`flex items-center gap-3 px-4 bg-white border-b border-gray-50
                       transition-all duration-200 ease-smooth ${comprado ? 'opacity-40 py-2.5' : 'py-3.5'}`}>
        {/* Checkbox */}
        <button
          type="button"
          onClick={() => onCheckbox(item)}
          aria-label={comprado ? 'Desmarcar' : 'Marcar como comprado'}
          className={`flex-none w-6 h-6 rounded-full border-2 flex items-center justify-center
                      transition-all duration-150 active:scale-90
                      ${comprado
                        ? 'bg-green-500 border-green-500'
                        : 'border-gray-300 hover:border-primary-400'
                      }`}
          style={{ minWidth: 44, minHeight: 44, margin: '-9px -5px' }}
        >
          {comprado && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
        </button>

        {/* Nome + pessoa */}
        <div className="flex-1 min-w-0">
          {editandoNome ? (
            <input
              ref={inputNomeRef}
              type="text"
              value={nomeLocal}
              onChange={e => setNomeLocal(e.target.value)}
              onBlur={() => {
                setEditandoNome(false)
                // salvar via ação MoreHorizontal/editar é suficiente; aqui apenas fecha
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') { setNomeLocal(item.nome); setEditandoNome(false) }
              }}
              className="w-full text-sm font-medium text-gray-900 bg-transparent border-b border-primary-400
                         focus:outline-none py-0.5"
            />
          ) : (
            <button
              type="button"
              onClick={ativarEdicao}
              className={`text-left text-sm font-medium leading-snug flex items-start gap-1.5 w-full
                          ${comprado ? 'line-through text-gray-400' : 'text-gray-900'}`}
            >
              <span className="break-words line-clamp-2 flex-1 min-w-0">{item.nome}</span>
              {!comprado && <Pencil className="w-3 h-3 text-gray-300 flex-none mt-0.5" strokeWidth={2} />}
            </button>
          )}
          {item.pessoa && !editandoNome && (
            <span className={`inline-block mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full
                              ${corUsuario(item.pessoa)}`}>
              {nomeCurto(item.pessoa)}
            </span>
          )}
        </div>

        {/* Controles de quantidade */}
        <div className="flex items-center gap-0.5 flex-none">
          <button
            type="button"
            onClick={() => onAlterarQtd(item.id, -1)}
            disabled={item.quantidade <= 1}
            className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center
                       text-gray-600 hover:bg-gray-200 disabled:opacity-30 transition-colors active:scale-90"
            aria-label="Diminuir quantidade"
          >
            <Minus className="w-3 h-3" strokeWidth={2.5} />
          </button>
          <span className="text-sm font-semibold text-gray-900 w-6 text-center tabular-nums">
            {item.quantidade}
          </span>
          <button
            type="button"
            onClick={() => onAlterarQtd(item.id, +1)}
            className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center
                       text-gray-600 hover:bg-gray-200 transition-colors active:scale-90"
            aria-label="Aumentar quantidade"
          >
            <Plus className="w-3 h-3" strokeWidth={2.5} />
          </button>
        </div>

        {/* Botão ações */}
        {!editandoNome && (
          <button
            type="button"
            onClick={() => onAcoes(item)}
            className="flex-none w-7 h-7 rounded-lg flex items-center justify-center
                       text-gray-300 hover:bg-gray-100 hover:text-gray-500 transition-colors active:scale-90"
            aria-label="Ações do item"
          >
            <MoreHorizontal className="w-4 h-4" strokeWidth={2} />
          </button>
        )}
      </div>
    </SwipeableItem>
  )
}

// ── Input Adicionar Item ──────────────────────────────────────────────────────

function InputAdicionarItem({
  onAdicionar,
  emailAtual,
}: {
  onAdicionar: (nome: string, pessoa?: string | null) => Promise<void>
  emailAtual: string | null
}) {
  const [valor, setValor] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nome = valor.trim()
    if (!nome || loading) return
    setLoading(true)
    try {
      await onAdicionar(nome, emailAtual)
      setValor('')
    } catch { /* noop */ } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        type="text"
        value={valor}
        onChange={e => setValor(e.target.value)}
        placeholder="Adicionar item…"
        className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5
                   placeholder-gray-400 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-400
                   focus:border-transparent transition-all"
        maxLength={120}
      />
      <button
        type="submit"
        disabled={!valor.trim() || loading}
        className="w-10 h-10 flex items-center justify-center bg-primary-600 text-white
                   rounded-xl disabled:opacity-40 active:scale-95 transition-all flex-none"
        aria-label="Adicionar"
      >
        <Plus className="w-5 h-5" strokeWidth={2.5} />
      </button>
    </form>
  )
}

// ── Input Criar Sublista ──────────────────────────────────────────────────────

function InputCriarSublista({ onCriar }: { onCriar: (nome: string) => Promise<unknown> }) {
  const [aberto, setAberto] = useState(false)
  const [valor, setValor] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function abrir() {
    setAberto(true)
    setTimeout(() => inputRef.current?.focus(), 40)
  }

  function fechar() {
    setAberto(false)
    setValor('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nome = valor.trim()
    if (!nome || loading) return
    setLoading(true)
    try {
      await onCriar(nome)
      setValor('')
      inputRef.current?.focus()
    } catch { /* noop */ } finally {
      setLoading(false)
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={abrir}
        className="flex items-center gap-2 w-full px-4 py-3 rounded-2xl
                   border border-dashed border-amber-200 bg-amber-50/50
                   text-amber-600 text-sm font-medium
                   hover:bg-amber-50 active:scale-[0.98] transition-all"
      >
        <Plus className="w-4 h-4 flex-none" strokeWidth={2.5} />
        Adicionar sublista
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        value={valor}
        onChange={e => setValor(e.target.value)}
        onKeyDown={e => e.key === 'Escape' && fechar()}
        placeholder="Nome da sublista…"
        className="flex-1 text-sm bg-white border border-amber-300 rounded-xl px-3.5 py-2.5
                   placeholder-gray-400 text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-400
                   focus:border-transparent transition-all"
        maxLength={80}
      />
      <button
        type="button"
        onClick={fechar}
        className="w-10 h-10 flex items-center justify-center text-gray-400
                   hover:bg-gray-100 rounded-xl transition-all flex-none"
        aria-label="Cancelar"
      >
        <X className="w-4 h-4" strokeWidth={2.5} />
      </button>
      <button
        type="submit"
        disabled={!valor.trim() || loading}
        className="w-10 h-10 flex items-center justify-center bg-amber-500 text-white
                   rounded-xl disabled:opacity-40 active:scale-95 transition-all flex-none"
        aria-label="Criar sublista"
      >
        <Plus className="w-5 h-5" strokeWidth={2.5} />
      </button>
    </form>
  )
}

// ── Sublista Card ─────────────────────────────────────────────────────────────

function SublistaCard({
  sublista,
  onAcoes,
}: {
  sublista: ListaComMeta
  onAcoes: (sublista: ListaComMeta) => void
}) {
  const temPrevisto = sublista.totalPrevisto > 0
  const temPago = sublista.totalPago > 0

  return (
    <SwipeableItem onDelete={() => onAcoes(sublista)} requireConfirmation={false} disabled={false}>
      <div className="relative bg-white rounded-2xl border border-amber-100 shadow-sm overflow-hidden">
        <Link href={`/listas-compras/${sublista.id}`} className="block p-4 pr-12">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-none">
              <Crown className="w-4 h-4 text-amber-500" strokeWidth={1.8} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-800 truncate">{sublista.nome}</h3>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {sublista.totalItens === 0 ? (
                  <span className="text-[11px] text-gray-400">Vazia</span>
                ) : sublista.totalPendentes > 0 ? (
                  <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                    {sublista.totalPendentes} {sublista.totalPendentes === 1 ? 'pendente' : 'pendentes'}
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                    <Check className="w-2.5 h-2.5" strokeWidth={3} />
                    Concluída
                  </span>
                )}
              </div>
              {(temPrevisto || temPago) && (
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {temPrevisto && (
                    <span className="text-[11px] text-gray-400">
                      Prev: <span className="font-semibold text-gray-600 num">{formatBRL(sublista.totalPrevisto)}</span>
                    </span>
                  )}
                  {temPago && (
                    <span className="text-[11px] text-gray-400">
                      Pago: <span className="font-semibold text-green-600 num">{formatBRL(sublista.totalPago)}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </Link>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onAcoes(sublista) }}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl
                     flex items-center justify-center text-gray-400 hover:bg-gray-100
                     transition-colors active:scale-90"
          aria-label="Ações da sublista"
        >
          <MoreHorizontal className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>
    </SwipeableItem>
  )
}

// ── Bottom Sheet Ações Sublista ───────────────────────────────────────────────

function BottomSheetAcoesSublista({
  sublista,
  onClose,
  onRenomear,
  onExcluir,
}: {
  sublista: ListaComMeta
  onClose: () => void
  onRenomear: (id: string, nome: string) => Promise<void>
  onExcluir: (id: string) => Promise<void>
}) {
  const [renomeando, setRenomeando] = useState(false)
  const [nomeLocal, setNomeLocal] = useState(sublista.nome)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renomeando) setTimeout(() => inputRef.current?.focus(), 50)
  }, [renomeando])

  async function confirmarRenomear() {
    const nome = nomeLocal.trim()
    if (!nome || nome === sublista.nome) { setRenomeando(false); return }
    await onRenomear(sublista.id, nome)
    onClose()
  }

  async function handleExcluir() {
    await onExcluir(sublista.id)
    onClose()
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[200] flex items-end modal-overlay"
        style={{ background: 'rgba(0,0,0,0.45)' }}
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <div className="w-full bg-white rounded-t-3xl shadow-2xl px-5 pt-2 pb-10 modal-sheet">
          <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-4" />
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1">Sublista</p>
          <p className="text-base font-bold text-gray-900 mb-5 truncate">{sublista.nome}</p>

          {renomeando ? (
            <div className="mb-4">
              <input
                ref={inputRef}
                type="text"
                value={nomeLocal}
                onChange={e => setNomeLocal(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmarRenomear()
                  if (e.key === 'Escape') setRenomeando(false)
                }}
                className="w-full text-sm border border-amber-400 rounded-xl px-3.5 py-2.5
                           focus:outline-none focus:ring-2 focus:ring-amber-400"
                maxLength={80}
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setRenomeando(false)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmarRenomear}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold"
                >
                  Salvar
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setRenomeando(true)}
                className="flex items-center gap-3 w-full px-4 py-3.5 rounded-2xl hover:bg-gray-50
                           text-gray-700 text-sm font-semibold transition-colors active:bg-gray-100"
              >
                <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center">
                  <Pencil className="w-4 h-4 text-gray-600" strokeWidth={1.8} />
                </div>
                Renomear
              </button>
              <button
                type="button"
                onClick={handleExcluir}
                className="flex items-center gap-3 w-full px-4 py-3.5 rounded-2xl hover:bg-red-50
                           text-red-600 text-sm font-semibold transition-colors active:bg-red-100"
              >
                <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center">
                  <Trash2 className="w-4 h-4 text-red-500" strokeWidth={1.8} />
                </div>
                Excluir sublista
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function DetalheListaPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const {
    pendentes, comprados,
    totalPrevisto: totalPrevItens, totalPago: totalPagoItens,
    adicionarItem, editarItem, alterarQuantidade,
    marcarComprado, desmarcarComprado,
    excluirItem, moverParaWishlist,
  } = useItensLista(id)

  const {
    sublistas, criarSublista, renomearSublista, excluirSublista,
    totalPrevisto: totalPrevSubs, totalPago: totalPagoSubs,
  } = useSublistasLista(id)

  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; nome: string }[]>([])
  const [parentId, setParentId] = useState<string | null>(null)
  const [emailAtual, setEmailAtual] = useState<string | null>(null)
  const [usuariosConhecidos, setUsuariosConhecidos] = useState<string[]>([])
  const [itemCheckbox, setItemCheckbox] = useState<ItemListaCompras | null>(null)
  const [itemEdicao, setItemEdicao] = useState<ItemListaCompras | null>(null)
  const [sublistaAcoes, setSublistaAcoes] = useState<ListaComMeta | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const fecharToast = useCallback(() => setToastMsg(null), [])

  // Busca cadeia de ancestrais com queries simples sequenciais (até 4 níveis)
  useEffect(() => {
    setBreadcrumbs([])
    setParentId(null)

    async function fetchChain() {
      const chain: { id: string; nome: string }[] = []
      let currentId: string | null = id

      for (let i = 0; i < 4 && currentId; i++) {
        const { data } = await supabase
          .from('listas_compras')
          .select('id, nome, parent_id')
          .eq('id', currentId)
          .single()
        if (!data) break
        const row = data as { id: string; nome: string; parent_id: string | null }
        chain.unshift({ id: row.id, nome: row.nome })
        if (i === 0) setParentId(row.parent_id)
        currentId = row.parent_id
      }

      setBreadcrumbs(chain)
    }

    fetchChain()

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const email = session?.user?.email ?? null
      setEmailAtual(email)

      const [mercadoResult, wishlistResult] = await Promise.all([
        supabase.from('lista_mercado_itens').select('criado_por').not('criado_por', 'is', null),
        supabase.from('wishlist_items').select('criado_por').not('criado_por', 'is', null),
      ])
      const extrair = (rows: { criado_por: string | null }[] | null) =>
        (rows ?? []).map(r => r.criado_por).filter((e): e is string => e !== null)

      const todos = [...new Set([
        ...(email ? [email] : []),
        ...extrair(mercadoResult.data),
        ...extrair(wishlistResult.data),
      ])]
      setUsuariosConhecidos(todos)
    })
  }, [id])

  const depth = breadcrumbs.length > 0 ? breadcrumbs.length - 1 : 0
  const listaNome = breadcrumbs[breadcrumbs.length - 1]?.nome ?? ''
  const canAddSublistas = depth < 3

  // Totais: se há sublistas, agrega delas; senão usa os itens diretos
  const totalPrevisto = sublistas.length > 0 ? totalPrevSubs + totalPrevItens : totalPrevItens
  const totalPago = sublistas.length > 0 ? totalPagoSubs + totalPagoItens : totalPagoItens
  const temTotais = totalPrevisto > 0 || totalPago > 0

  function handleBack() {
    if (parentId) {
      router.push(`/listas-compras/${parentId}`)
    } else {
      router.push('/listas-compras')
    }
  }

  async function handleCheckbox(item: ItemListaCompras) {
    if (item.status === 'comprado') {
      await desmarcarComprado(item.id)
    } else {
      setItemCheckbox(item)
    }
  }

  async function handleConfirmarCompra(preco: number | null) {
    if (!itemCheckbox) return
    await marcarComprado(itemCheckbox.id, preco ?? undefined)
    setItemCheckbox(null)
  }

  async function handleMoverWishlist(itemId: string) {
    await moverParaWishlist(itemId)
    setToastMsg('Item movido para a Wishlist')
  }

  const isEmpty = pendentes.length === 0 && comprados.length === 0 && sublistas.length === 0

  return (
    <div className="min-h-screen pb-40 page-enter">
      {/* Header sticky */}
      <div className="sticky top-0 z-10 sticky-header border-b border-gray-100 px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            onClick={handleBack}
            className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center
                       text-gray-600 hover:bg-gray-200 active:scale-90 transition-all flex-none"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2.5} />
          </button>
          <div className="flex-1 min-w-0">
            {/* Breadcrumb completo: sempre visível, mostra todo o caminho até o nó atual */}
            <div className="flex items-center gap-1 flex-wrap">
              {breadcrumbs.map((crumb, i) => {
                const isCurrent = i === breadcrumbs.length - 1
                return (
                  <span key={crumb.id} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="w-3 h-3 text-gray-300 flex-none" strokeWidth={2.5} />}
                    {isCurrent ? (
                      <span className="text-lg font-bold text-gray-900 leading-tight">{crumb.nome}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => router.push(`/listas-compras/${crumb.id}`)}
                        className="text-sm font-medium text-gray-400 hover:text-amber-600 transition-colors truncate max-w-24"
                      >
                        {crumb.nome}
                      </button>
                    )}
                  </span>
                )
              })}
              {breadcrumbs.length === 0 && (
                <span className="text-lg font-bold text-gray-900">…</span>
              )}
            </div>
            {temTotais && (
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                {totalPrevisto > 0 && (
                  <span className="text-[11px] text-gray-400">
                    Prev: <span className="font-semibold text-gray-600 num">{formatBRL(totalPrevisto)}</span>
                  </span>
                )}
                {totalPago > 0 && (
                  <span className="text-[11px] text-gray-400">
                    Pago: <span className="font-semibold text-green-600 num">{formatBRL(totalPago)}</span>
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center flex-none">
            <Crown className="w-5 h-5 text-amber-600" strokeWidth={1.8} />
          </div>
        </div>
        <InputAdicionarItem onAdicionar={adicionarItem} emailAtual={emailAtual} />
      </div>

      {/* Seção Sublistas — visível quando depth < 3 */}
      {canAddSublistas && (
        <div className="px-4 pt-4">
          {sublistas.length > 0 && (
            <>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Sublistas</p>
              <div className="space-y-2 mb-3">
                {sublistas.map(sub => (
                  <SublistaCard key={sub.id} sublista={sub} onAcoes={(s) => setSublistaAcoes(s)} />
                ))}
              </div>
            </>
          )}
          <div className="mb-4">
            <InputCriarSublista onCriar={criarSublista} />
          </div>
          {sublistas.length > 0 && (pendentes.length > 0 || comprados.length > 0) && (
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Itens diretos</p>
          )}
        </div>
      )}

      {/* Estado vazio total */}
      {isEmpty && !canAddSublistas && (
        <div className="flex flex-col items-center justify-center py-16 text-center px-8">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
            <Crown className="w-8 h-8 text-amber-400" strokeWidth={1.5} />
          </div>
          <p className="text-sm font-semibold text-gray-500">Lista vazia</p>
          <p className="text-xs text-gray-400 mt-1">Adicione o primeiro item acima</p>
        </div>
      )}
      {isEmpty && canAddSublistas && null}

      {/* Lista plana de itens: pendentes primeiro, comprados ao final */}
      {(pendentes.length > 0 || comprados.length > 0) && (
        <div className={`divide-y divide-gray-50 ${canAddSublistas ? '' : 'mt-2'}`}>
          {pendentes.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              onCheckbox={handleCheckbox}
              onAlterarQtd={alterarQuantidade}
              onAcoes={setItemEdicao}
              onExcluir={excluirItem}
            />
          ))}
          {comprados.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              onCheckbox={handleCheckbox}
              onAlterarQtd={alterarQuantidade}
              onAcoes={setItemEdicao}
              onExcluir={excluirItem}
            />
          ))}
        </div>
      )}

      {/* Modal preço pago */}
      {itemCheckbox && (
        <BottomSheetPrecoPago
          item={itemCheckbox}
          onClose={() => setItemCheckbox(null)}
          onConfirmar={handleConfirmarCompra}
        />
      )}

      {/* Modal editar item */}
      {itemEdicao && (
        <BottomSheetEditarItem
          item={itemEdicao}
          usuariosConhecidos={usuariosConhecidos}
          onClose={() => setItemEdicao(null)}
          onSalvar={editarItem}
          onMoverWishlist={handleMoverWishlist}
          onExcluir={excluirItem}
        />
      )}

      {/* Modal ações sublista */}
      {sublistaAcoes && (
        <BottomSheetAcoesSublista
          sublista={sublistaAcoes}
          onClose={() => setSublistaAcoes(null)}
          onRenomear={renomearSublista}
          onExcluir={excluirSublista}
        />
      )}

      {/* Toast */}
      {toastMsg && <Toast mensagem={toastMsg} onClose={fecharToast} />}
    </div>
  )
}
