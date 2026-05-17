'use client'

import { useState, useRef, useEffect, useCallback, type FormEvent, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  ShoppingBasket, Plus, Minus, Check, Trash2, X, Pencil, ChevronDown, ChevronUp,
  WifiOff, RefreshCw, AlertCircle, History, Camera,
} from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import { SwipeableItem } from '@/components/SwipeableItem'
import { CameraOCR } from '@/components/CameraOCR'
import { useListaMercado, type ItemMercado } from '@/lib/useListaMercado'
import { type PendingOp } from '@/lib/offlineQueue'
import { useHistoricoCompras } from '@/lib/useHistoricoCompras'
import { formatBRL } from '@/lib/logger'

// ── Constantes ────────────────────────────────────────────────────────────────

const HIST_KEY = 'lista-mercado-historico'
const HINT_KEY = 'lista-mercado-swipe-hint'
const MAX_HIST = 50

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
  const e = email.toLowerCase()
  if (e.includes('matheus')) return 'bg-matheus-light text-matheus'
  if (e.includes('jeniffer') || e.includes('jennifer')) return 'bg-jeniffer-light text-jeniffer'
  return USER_PALETTE[emailHash(email) % USER_PALETTE.length]
}

function salvarHistorico(nome: string) {
  try {
    const raw = localStorage.getItem(HIST_KEY)
    const hist: string[] = raw ? JSON.parse(raw) : []
    const updated = [nome, ...hist.filter(n => n.toLowerCase() !== nome.toLowerCase())].slice(0, MAX_HIST)
    localStorage.setItem(HIST_KEY, JSON.stringify(updated))
  } catch { /* noop */ }
}

function carregarHistorico(): string[] {
  try {
    const raw = localStorage.getItem(HIST_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function parsearInput(text: string): { nome: string; quantidade: number } {
  const match = text.match(/^(.+?)\s+(\d+)x?$/i)
  if (match) {
    const qtd = parseInt(match[2], 10)
    if (qtd >= 1 && qtd <= 999) return { nome: match[1].trim(), quantidade: qtd }
  }
  return { nome: text.trim(), quantidade: 1 }
}

// ── Bottom sheet de preço ─────────────────────────────────────────────────────

function BottomSheetPreco({
  item,
  onClose,
  onConfirmar,
}: {
  item: ItemMercado
  onClose: () => void
  onConfirmar: (preco: number | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [valor, setValor] = useState(item.preco_unit != null ? String(item.preco_unit).replace('.', ',') : '')
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [cameraAberta, setCameraAberta] = useState(false)

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

  function handleConfirmar() {
    const num = valor.replace(',', '.').trim()
    onConfirmar(num ? parseFloat(num) : null)
    onClose()
  }

  // Confirma direto a partir da câmera — sem segunda confirmação no sheet
  function handleCameraConfirmar(preco: number) {
    onConfirmar(preco)
    onClose()
  }

  return (
    <>
      <ModalPortal>
        <div
          className="fixed inset-0 z-[200] flex items-end modal-overlay"
          style={{ background: 'rgba(0,0,0,0.45)', paddingBottom: keyboardOffset }}
          onClick={e => e.target === e.currentTarget && onClose()}
        >
          <div className="w-full bg-white rounded-t-3xl shadow-2xl px-5 pt-2 pb-6 modal-sheet">
            <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-5" />
            <p className="text-xs text-gray-500 mb-1 font-medium">Preço unitário de</p>
            <p className="text-base font-semibold text-gray-900 mb-4 truncate">{item.nome}</p>

            <form onSubmit={e => { e.preventDefault(); handleConfirmar() }}>
              <div className="relative mb-3">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">R$</span>
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="decimal"
                  value={valor}
                  onChange={e => setValor(e.target.value)}
                  onKeyDown={e => e.key === 'Escape' && onClose()}
                  placeholder="0,00"
                  className="w-full pl-10 pr-4 py-3.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-900
                             placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
                />
              </div>

              <button
                type="button"
                onClick={() => setCameraAberta(true)}
                className="w-full flex items-center justify-center gap-2 py-3 mb-4 rounded-xl
                           border border-dashed border-primary-300 bg-primary-50 text-primary-600
                           active:bg-primary-100 transition-colors"
              >
                <Camera className="w-4 h-4" />
                <span className="text-sm font-semibold">Ler preço com câmera</span>
              </button>

              <div className="flex gap-3">
                {item.preco_unit != null && (
                  <button
                    type="button"
                    onClick={() => { onConfirmar(null); onClose() }}
                    className="px-4 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500
                               hover:bg-gray-50 transition-colors"
                  >
                    Remover
                  </button>
                )}
                <button type="button" onClick={onClose}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
                <button type="submit"
                  className="flex-1 py-3 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors">
                  Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>

      {cameraAberta && (
        <CameraOCR
          onConfirmar={handleCameraConfirmar}
          onClose={() => setCameraAberta(false)}
        />
      )}
    </>
  )
}


// ── Bottom sheet de confirmar compra ─────────────────────────────────────────

function BottomSheetConfirmarCompra({
  item,
  onClose,
  onConfirmar,
}: {
  item: ItemMercado
  onClose: () => void
  onConfirmar: (qtd: number, preco: number | null) => void
}) {
  const precoInputRef = useRef<HTMLInputElement>(null)
  const [qtd, setQtd] = useState(item.quantidade)
  const [preco, setPreco] = useState(item.preco_unit != null ? String(item.preco_unit).replace('.', ',') : '')
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [cameraAberta, setCameraAberta] = useState(false)

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

  const precoNum = preco.trim() ? parseFloat(preco.replace(',', '.')) : null
  const subtotal = precoNum != null && !isNaN(precoNum) ? qtd * precoNum : null

  function handlePrecoCamera(valor: number) {
    setPreco(valor.toFixed(2).replace('.', ','))
    setCameraAberta(false)
    setTimeout(() => precoInputRef.current?.focus(), 100)
  }

  return (
    <>
      <ModalPortal>
        <div
          className="fixed inset-0 z-[200] flex items-end modal-overlay"
          style={{ background: 'rgba(0,0,0,0.45)', paddingBottom: keyboardOffset }}
          onClick={e => e.target === e.currentTarget && onClose()}
        >
          <div className="w-full bg-white rounded-t-3xl shadow-2xl px-5 pt-2 pb-6 modal-sheet">
            <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-5" />

            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center flex-none">
                <Check className="w-4.5 h-4.5 text-green-500" strokeWidth={2.5} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">Conferir antes de marcar</p>
                <p className="text-base font-semibold text-gray-900 truncate">{item.nome}</p>
              </div>
            </div>

            {/* Quantidade */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 mb-2">Quantidade</label>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setQtd(q => Math.max(1, q - 1))}
                  disabled={qtd <= 1}
                  className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-600
                             hover:bg-gray-200 disabled:opacity-30 transition-colors active:scale-90"
                >
                  <Minus className="w-5 h-5" strokeWidth={2.5} />
                </button>
                <span className="flex-1 text-center text-3xl font-bold text-gray-900 tabular-nums">{qtd}</span>
                <button
                  type="button"
                  onClick={() => setQtd(q => q + 1)}
                  className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-600
                             hover:bg-gray-200 transition-colors active:scale-90"
                >
                  <Plus className="w-5 h-5" strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {/* Preço unitário */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 mb-2">Preço unitário</label>
              <div className="relative mb-2">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">R$</span>
                <input
                  ref={precoInputRef}
                  type="text"
                  inputMode="decimal"
                  value={preco}
                  onChange={e => setPreco(e.target.value)}
                  onKeyDown={e => e.key === 'Escape' && onClose()}
                  placeholder="0,00"
                  className="w-full pl-10 pr-4 py-3.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-900
                             placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
                />
              </div>
              <button
                type="button"
                onClick={() => setCameraAberta(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl
                           border border-dashed border-green-300 bg-green-50 text-green-700
                           active:bg-green-100 transition-colors"
              >
                <Camera className="w-4 h-4" />
                <span className="text-sm font-semibold">Ler preço com câmera</span>
              </button>
            </div>

            {/* Subtotal */}
            {subtotal != null && (
              <div className="mb-4 px-4 py-3 rounded-2xl bg-green-50 flex items-center justify-between">
                <span className="text-sm text-green-700 font-medium">Total do item</span>
                <span className="text-lg font-bold text-green-700 tabular-nums">{formatBRL(subtotal)}</span>
              </div>
            )}

            {/* Ações */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => { onConfirmar(qtd, precoNum); onClose() }}
                className="flex-1 py-3.5 rounded-xl bg-green-500 text-white text-sm font-semibold
                           hover:bg-green-600 transition-colors active:scale-95 flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" strokeWidth={2.5} />
                Comprado
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>

      {cameraAberta && (
        <CameraOCR
          onConfirmar={handlePrecoCamera}
          onClose={() => setCameraAberta(false)}
        />
      )}
    </>
  )
}

// ── Bottom sheet de finalizar compra ─────────────────────────────────────────

function BottomSheetFinalizarCompra({
  comprados,
  totalCalculado,
  salvando,
  onClose,
  onFinalizar,
}: {
  comprados: ItemMercado[]
  totalCalculado: number
  salvando: boolean
  onClose: () => void
  onFinalizar: (valorTotal: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [valor, setValor] = useState(
    totalCalculado > 0 ? totalCalculado.toFixed(2).replace('.', ',') : ''
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

  const valorNum = parseFloat(valor.replace(',', '.'))
  const valido = !isNaN(valorNum) && valorNum >= 0

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[200] flex items-end modal-overlay"
        style={{ background: 'rgba(0,0,0,0.45)', paddingBottom: keyboardOffset }}
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <div className="w-full bg-white rounded-t-3xl shadow-2xl px-5 pt-2 pb-6 modal-sheet">
          <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-5" />

          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-2xl bg-green-50 flex items-center justify-center flex-none">
              <ShoppingBasket className="w-5 h-5 text-green-600" strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-base font-bold text-gray-900">Finalizar Compra</p>
              <p className="text-xs text-gray-400">
                {comprados.length} {comprados.length === 1 ? 'item comprado' : 'itens comprados'}
              </p>
            </div>
          </div>

          {/* Resumo de itens */}
          {comprados.length > 0 && (
            <div className="mb-4 max-h-36 overflow-y-auto rounded-xl border border-gray-100 divide-y divide-gray-50">
              {comprados.slice(0, 8).map(item => (
                <div key={item.id} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm text-gray-700 truncate flex-1 mr-2">{item.nome}</span>
                  <span className="text-xs text-gray-400 flex-none tabular-nums">
                    {item.quantidade}× {item.preco_unit != null ? formatBRL(item.preco_unit) : '—'}
                  </span>
                </div>
              ))}
              {comprados.length > 8 && (
                <div className="px-3 py-2 text-xs text-gray-400 text-center">
                  +{comprados.length - 8} itens
                </div>
              )}
            </div>
          )}

          {/* Valor total pago */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 mb-2">Valor total pago</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">R$</span>
              <input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                value={valor}
                onChange={e => setValor(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && onClose()}
                placeholder="0,00"
                className="w-full pl-10 pr-4 py-3.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-900
                           placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
              />
            </div>
            {totalCalculado > 0 && (
              <p className="text-[11px] text-gray-400 mt-1.5">
                Estimado pela lista: {formatBRL(totalCalculado)}
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!valido || salvando}
              onClick={() => valido && onFinalizar(valorNum)}
              className="flex-1 py-3.5 rounded-xl bg-green-500 text-white text-sm font-semibold
                         hover:bg-green-600 disabled:opacity-50 transition-colors active:scale-95
                         flex items-center justify-center gap-2"
            >
              {salvando ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" strokeWidth={2.5} />
              )}
              Salvar no Histórico
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}

// ── Bottom sheet de operações pendentes ──────────────────────────────────────

const OP_LABEL: Record<string, string> = {
  create: 'Adicionar',
  update: 'Atualizar',
  delete: 'Excluir',
}

function BottomSheetPendingOps({
  ops,
  itens,
  onClose,
  onSync,
  onClear,
}: {
  ops: PendingOp[]
  itens: ItemMercado[]
  onClose: () => void
  onSync: () => void
  onClear: () => void
}) {
  function resolveNome(op: PendingOp): string {
    if (op.type === 'create' && op.payload) {
      return (op.payload as ItemMercado).nome ?? op.itemId
    }
    const item = itens.find(i => i.id === op.itemId)
    return item?.nome ?? op.itemId
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[200] flex items-end modal-overlay"
        style={{ background: 'rgba(0,0,0,0.45)' }}
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <div className="w-full bg-white rounded-t-3xl shadow-2xl px-5 pt-2 pb-8 modal-sheet">
          <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-5" />

          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center flex-none">
              <RefreshCw className="w-4.5 h-4.5 text-orange-500" strokeWidth={2} />
            </div>
            <div>
              <p className="text-base font-bold text-gray-900">Operações pendentes</p>
              <p className="text-xs text-gray-400">
                {ops.length} {ops.length === 1 ? 'ação aguardando sync' : 'ações aguardando sync'}
              </p>
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
            {ops.map(op => (
              <div key={op.opId} className="flex items-center gap-3 px-3 py-2.5">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-none
                  ${op.type === 'create' ? 'bg-green-50 text-green-600' :
                    op.type === 'delete' ? 'bg-red-50 text-red-500' :
                    'bg-blue-50 text-blue-600'}`}>
                  {OP_LABEL[op.type]}
                </span>
                <span className="text-sm text-gray-700 truncate flex-1">{resolveNome(op)}</span>
                {op.retries > 0 && (
                  <span className="text-[10px] text-gray-400 flex-none">{op.retries} tentativa{op.retries > 1 ? 's' : ''}</span>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-400 mb-4 text-center">
            Essas ações ainda não foram salvas no servidor. Tente sincronizar ou descarte-as.
          </p>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { onClear(); onClose() }}
              className="flex-1 py-3.5 rounded-xl border border-red-200 text-sm font-semibold text-red-500
                         hover:bg-red-50 transition-colors"
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={() => { onSync(); onClose() }}
              className="flex-1 py-3.5 rounded-xl bg-orange-500 text-white text-sm font-semibold
                         hover:bg-orange-600 transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" strokeWidth={2.5} />
              Sincronizar agora
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}

// ── Linha de item ─────────────────────────────────────────────────────────────

function ItemRow({
  item,
  mostraHint,
  onToggle,
  onAlterarQtd,
  onEditarNome,
  onExcluir,
  onAbrirPreco,
  onAbrirConfirmarCompra,
}: {
  item: ItemMercado
  mostraHint: boolean
  onToggle: (id: string) => void
  onAlterarQtd: (id: string, delta: number) => void
  onEditarNome: (id: string, nome: string) => void
  onExcluir: (id: string) => void
  onAbrirPreco: (item: ItemMercado) => void
  onAbrirConfirmarCompra: (item: ItemMercado) => void
}) {
  const [editandoNome, setEditandoNome] = useState(false)
  const [nomeLocal, setNomeLocal] = useState(item.nome)
  const inputNomeRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setNomeLocal(item.nome) }, [item.nome])

  function ativarEdicao() {
    setEditandoNome(true)
    setTimeout(() => inputNomeRef.current?.focus(), 50)
  }

  function salvarNome() {
    setEditandoNome(false)
    if (nomeLocal.trim() && nomeLocal.trim() !== item.nome) {
      onEditarNome(item.id, nomeLocal.trim())
      salvarHistorico(nomeLocal.trim())
    } else {
      setNomeLocal(item.nome)
    }
  }

  const subtotal = item.quantidade * (item.preco_unit ?? 0)

  return (
    <SwipeableItem onDelete={() => onExcluir(item.id)} disabled={editandoNome} requireConfirmation>
      <div
        className={`flex items-center gap-3 px-4 bg-white border-b border-gray-50
                    transition-opacity duration-200 ${item.comprado ? 'opacity-50 py-2' : 'py-3.5'}`}
      >
        {/* Checkbox — 44px touch target */}
        <button
          type="button"
          onClick={() => item.comprado ? onToggle(item.id) : onAbrirConfirmarCompra(item)}
          aria-label={item.comprado ? 'Desmarcar' : 'Marcar como comprado'}
          className={`flex-none w-6 h-6 rounded-full border-2 flex items-center justify-center
                      transition-all duration-150 active:scale-90
                      ${item.comprado
                        ? 'bg-green-500 border-green-500'
                        : 'border-gray-300 hover:border-primary-400'
                      }`}
          style={{ minWidth: 44, minHeight: 44, margin: '-9px -5px' }}
        >
          {item.comprado && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
        </button>

        {/* Nome + autor */}
        <div className="flex-1 min-w-0">
          {editandoNome ? (
            <input
              ref={inputNomeRef}
              type="text"
              value={nomeLocal}
              onChange={e => setNomeLocal(e.target.value)}
              onBlur={salvarNome}
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
                          ${item.comprado ? 'line-through text-gray-400' : 'text-gray-900'}`}
            >
              <span className="break-words line-clamp-2 flex-1 min-w-0">{item.nome}</span>
              <Pencil className="w-3 h-3 text-gray-300 flex-none mt-0.5" strokeWidth={2} />
            </button>
          )}
          {item.criado_por && !editandoNome && !item.comprado && (
            <span className={`inline-block mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full
                              ${corUsuario(item.criado_por)}`}>
              {nomeCurto(item.criado_por)}
            </span>
          )}
          {mostraHint && !item.comprado && (
            <span className="block text-[10px] text-gray-300 italic mt-0.5">← deslize para excluir</span>
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

        {/* Preço / subtotal — só exibe após o item ser tickado */}
        {item.comprado && (
          <button
            type="button"
            onClick={() => onAbrirPreco(item)}
            className="flex-none text-right min-w-[64px]"
            aria-label="Definir preço"
          >
            {item.preco_unit != null ? (
              <div>
                <p className="text-[11px] text-gray-400 leading-none tabular-nums">
                  {formatBRL(item.preco_unit)}/un
                </p>
                <p className="text-sm font-semibold text-gray-900 tabular-nums mt-0.5">
                  {formatBRL(subtotal)}
                </p>
              </div>
            ) : (
              <span className="text-xs text-primary-500 font-medium">+ preço</span>
            )}
          </button>
        )}
      </div>
    </SwipeableItem>
  )
}

// ── Rodapé com total ──────────────────────────────────────────────────────────

function TotalRodape({
  total,
  semPreco,
  compradosCount,
  totalComprados,
  onFinalizar,
}: {
  total: number
  semPreco: number
  compradosCount: number
  totalComprados: number
  onFinalizar: () => void
}) {
  return (
    <div className="fixed bottom-16 left-0 right-0 z-40 px-4 pb-2 pointer-events-none">
      <div className="max-w-md md:max-w-2xl lg:max-w-5xl xl:max-w-7xl mx-auto">
        <div className="bg-white rounded-2xl shadow-float border border-gray-100 px-4 py-3 pointer-events-auto">
          <div className="flex items-center gap-4">
            {compradosCount > 0 && (
              <button
                type="button"
                onClick={onFinalizar}
                className="flex items-center gap-1.5 text-xs font-semibold text-green-600
                           hover:text-green-700 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-xl transition-colors"
              >
                <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                Finalizar ({compradosCount})
              </button>
            )}
            <div className="flex-1 flex items-end justify-end gap-3">
              {semPreco > 0 && (
                <span className="text-[11px] text-gray-400 font-medium tabular-nums">
                  +{semPreco} s/ preço
                </span>
              )}
              <div className="text-right">
                {semPreco > 0 && (
                  <p className="text-[10px] text-gray-400 leading-none mb-0.5">parcial</p>
                )}
                <span className="text-lg font-bold text-gray-900 tabular-nums">{formatBRL(total)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Input com autocomplete ────────────────────────────────────────────────────

function InputAdicionar({
  onAdicionar,
}: {
  onAdicionar: (nome: string, quantidade: number) => Promise<void>
}) {
  const [valor, setValor] = useState('')
  const [historico, setHistorico] = useState<string[]>([])
  const [sugestoes, setSugestoes] = useState<string[]>([])
  const [erro, setErro] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setHistorico(carregarHistorico())
  }, [])

  useEffect(() => {
    function handler() { inputRef.current?.focus() }
    window.addEventListener('lista-mercado:open-add', handler)
    return () => window.removeEventListener('lista-mercado:open-add', handler)
  }, [])

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setValor(v)
    if (erro) setErro('')
    if (v.trim().length >= 2) {
      const termo = v.trim().toLowerCase()
      setSugestoes(
        historico
          .filter(n => n.toLowerCase().includes(termo) && n.toLowerCase() !== termo)
          .slice(0, 5)
      )
    } else {
      setSugestoes([])
    }
  }

  async function submeter(texto: string) {
    const { nome, quantidade } = parsearInput(texto)
    if (!nome) return
    setErro('')
    try {
      await onAdicionar(nome, quantidade)
      salvarHistorico(nome)
      setHistorico(carregarHistorico())
      setValor('')
      setSugestoes([])
      inputRef.current?.focus()
    } catch {
      setErro('Erro ao adicionar')
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    await submeter(valor)
  }

  return (
    <div className="relative">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={valor}
          onChange={handleChange}
          onBlur={() => setTimeout(() => setSugestoes([]), 150)}
          placeholder="Adicionar item… (ex: Leite 2)"
          className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-900
                     placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
        />
        <button
          type="submit"
          disabled={!valor.trim()}
          aria-label="Adicionar item"
          className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center text-white
                     disabled:opacity-40 hover:bg-primary-700 transition-colors active:scale-95
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
        >
          <Plus className="w-5 h-5" strokeWidth={2.5} />
        </button>
      </form>

      {/* Autocomplete */}
      {sugestoes.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-gray-100 shadow-card-md z-20 overflow-hidden">
          {sugestoes.map(s => (
            <button
              key={s}
              type="button"
              onMouseDown={() => submeter(s)}
              className="w-full text-left px-4 py-2.5 text-sm text-gray-800 hover:bg-gray-50 transition-colors
                         border-b border-gray-50 last:border-0 font-medium"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {erro && (
        <p className="text-xs text-red-500 mt-1.5 font-medium">{erro}</p>
      )}
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function ListaMercadoPage() {
  const router = useRouter()
  const {
    itens,
    adicionar, alterarQuantidade, definirPreco, editarNome,
    toggleComprado, excluir, limparComprados,
    isOnline, pendingCount, pendingOps, syncStatus, flushQueue, clearPendingQueue,
  } = useListaMercado()
  const { salvar: salvarHistorico } = useHistoricoCompras()

  const [pendingOpsAberto, setPendingOpsAberto] = useState(false)
  const [itemPreco, setItemPreco] = useState<ItemMercado | null>(null)
  const [itemConfirmando, setItemConfirmando] = useState<ItemMercado | null>(null)
  const [finalizandoCompra, setFinalizandoCompra] = useState(false)
  const [salvandoHistorico, setSalvandoHistorico] = useState(false)
  const [hintVisto, setHintVisto] = useState(true)
  const [deleteToast, setDeleteToast] = useState<{ id: string; nome: string } | null>(null)
  const [pendingExcluirId, setPendingExcluirId] = useState<string | null>(null)
  const [compradosAbertos, setCompradosAbertos] = useState(true)
  const [successToast, setSuccessToast] = useState(false)
  const deleteTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingExcluirRef = useRef<string | null>(null)

  function clearDeleteTimer() {
    if (deleteTimerRef.current) { clearTimeout(deleteTimerRef.current); deleteTimerRef.current = null }
  }

  function commitDelete() {
    if (pendingExcluirRef.current) {
      excluir(pendingExcluirRef.current)
      pendingExcluirRef.current = null
      setPendingExcluirId(null)
    }
  }

  useEffect(() => {
    if (!localStorage.getItem(HINT_KEY)) setHintVisto(false)
  }, [])

  useEffect(() => {
    if (!hintVisto && itens.length > 0) {
      const t = setTimeout(() => {
        localStorage.setItem(HINT_KEY, '1')
        setHintVisto(true)
      }, 5000)
      return () => clearTimeout(t)
    }
  }, [hintVisto, itens.length])

  const comprados = itens.filter(i => i.comprado && i.id !== pendingExcluirId)
  const pendentes = itens.filter(i => !i.comprado && i.id !== pendingExcluirId)
  const todosVisiveis = [...pendentes, ...comprados]
  const total    = todosVisiveis.reduce((s, i) => s + i.quantidade * (i.preco_unit ?? 0), 0)
  const semPreco = todosVisiveis.filter(i => i.preco_unit == null).length
  const totalComprados = comprados.reduce((s, i) => s + i.quantidade * (i.preco_unit ?? 0), 0)

  const handleToggle = useCallback((id: string) => toggleComprado(id, itens), [toggleComprado, itens])
  const handleQtd    = useCallback((id: string, d: number) => alterarQuantidade(id, d, itens), [alterarQuantidade, itens])
  function handleExcluir(id: string) {
    commitDelete()
    clearDeleteTimer()
    const item = itens.find(i => i.id === id)
    if (!item) { excluir(id); return }
    pendingExcluirRef.current = id
    setPendingExcluirId(id)
    setDeleteToast({ id, nome: item.nome })
    deleteTimerRef.current = setTimeout(() => {
      commitDelete()
      setDeleteToast(null)
    }, 4000)
  }

  function handleDesfazerExclusao() {
    clearDeleteTimer()
    pendingExcluirRef.current = null
    setPendingExcluirId(null)
    setDeleteToast(null)
  }

  function handleFecharDeleteToast() {
    clearDeleteTimer()
    commitDelete()
    setDeleteToast(null)
  }

  function handleConfirmarCompra(qtd: number, preco: number | null) {
    if (!itemConfirmando) return
    const id = itemConfirmando.id
    if (qtd !== itemConfirmando.quantidade) {
      alterarQuantidade(id, qtd - itemConfirmando.quantidade, itens)
    }
    definirPreco(id, preco)
    toggleComprado(id, itens)
  }

  async function handleFinalizar(valorTotal: number) {
    setSalvandoHistorico(true)
    try {
      await salvarHistorico(itens, valorTotal)
      await limparComprados(itens)
      setFinalizandoCompra(false)
      setSuccessToast(true)
      setTimeout(() => setSuccessToast(false), 3500)
    } catch {
      // silently fail — user can retry
    } finally {
      setSalvandoHistorico(false)
    }
  }

  const totalItens = pendentes.length + comprados.length

  return (
    <div className="min-h-screen pb-40 page-enter">
      {/* Header */}
      <div className="sticky top-0 z-10 sticky-header border-b border-gray-100 px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center flex-none">
            <ShoppingBasket className="w-5 h-5 text-green-600" strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-900 leading-none">Lista de Mercado</h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <p className="text-xs text-gray-400">
                {pendentes.length} {pendentes.length === 1 ? 'item pendente' : 'itens pendentes'}
                {comprados.length > 0 && (
                  <span> · {comprados.length} comprado{comprados.length > 1 ? 's' : ''}</span>
                )}
              </p>
              {totalItens > 0 && comprados.length > 0 && (
                <span className="text-[10px] font-semibold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full tabular-nums">
                  {comprados.length}/{totalItens}
                </span>
              )}
              {!isOnline && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                  <WifiOff className="w-2.5 h-2.5" strokeWidth={2.5} />
                  Offline{pendingCount > 0 ? ` · ${pendingCount}` : ''}
                </span>
              )}
              {isOnline && syncStatus === 'syncing' && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" strokeWidth={2.5} />
                  Sincronizando
                </span>
              )}
              {isOnline && syncStatus === 'error' && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">
                  <AlertCircle className="w-2.5 h-2.5" strokeWidth={2.5} />
                  Erro de sync
                </span>
              )}
              {isOnline && syncStatus === 'pending' && (
                <button
                  type="button"
                  onClick={() => setPendingOpsAberto(true)}
                  className="flex items-center gap-1 text-[10px] font-semibold text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full active:bg-orange-100 transition-colors"
                >
                  <RefreshCw className="w-2.5 h-2.5" strokeWidth={2.5} />
                  {pendingCount} pendente{pendingCount > 1 ? 's' : ''}
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push('/lista-mercado/historico')}
            aria-label="Histórico de compras"
            className="flex items-center gap-1.5 flex-none px-3 py-1.5 rounded-xl
                       bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            <History className="w-3.5 h-3.5 text-gray-500" strokeWidth={2} />
            <span className="text-xs font-semibold text-gray-600">Histórico</span>
          </button>
        </div>

        <InputAdicionar onAdicionar={adicionar} />
      </div>

      {/* Lista */}
      {itens.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center px-8">
          <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center mb-4">
            <ShoppingBasket className="w-8 h-8 text-green-300" strokeWidth={1.5} />
          </div>
          <p className="text-sm font-semibold text-gray-700 mb-1">Lista vazia</p>
          <p className="text-xs text-gray-400">
            Adicione os itens que precisam ser comprados
          </p>
        </div>
      ) : (
        <div className="bg-white mt-2 rounded-2xl mx-4 overflow-hidden shadow-sm border border-gray-100">
          {/* Pendentes */}
          {pendentes.map((item, idx) => (
            <ItemRow
              key={item.id}
              item={item}
              mostraHint={idx === 0 && !hintVisto}
              onToggle={handleToggle}
              onAlterarQtd={handleQtd}
              onEditarNome={editarNome}
              onExcluir={handleExcluir}
              onAbrirPreco={setItemPreco}
              onAbrirConfirmarCompra={setItemConfirmando}
            />
          ))}

          {/* Comprados */}
          {comprados.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setCompradosAbertos(v => !v)}
                className="w-full flex items-center gap-2 px-4 py-2 bg-gray-50 border-t border-b border-gray-100
                           hover:bg-gray-100 transition-colors"
              >
                <Check className="w-3.5 h-3.5 text-green-500 flex-none" strokeWidth={2.5} />
                <span className="text-xs font-semibold text-gray-500 flex-1 text-left">
                  Comprados ({comprados.length})
                </span>
                {compradosAbertos
                  ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 flex-none" strokeWidth={2} />
                  : <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-none" strokeWidth={2} />
                }
              </button>
              {compradosAbertos && comprados.map(item => (
                <ItemRow
                  key={item.id}
                  item={item}
                  mostraHint={false}
                  onToggle={handleToggle}
                  onAlterarQtd={handleQtd}
                  onEditarNome={editarNome}
                  onExcluir={handleExcluir}
                  onAbrirPreco={setItemPreco}
                  onAbrirConfirmarCompra={setItemConfirmando}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Bottom sheet de operações pendentes */}
      {pendingOpsAberto && (
        <BottomSheetPendingOps
          ops={pendingOps}
          itens={itens}
          onClose={() => setPendingOpsAberto(false)}
          onSync={flushQueue}
          onClear={clearPendingQueue}
        />
      )}

      {/* Bottom sheet de confirmar compra */}
      {itemConfirmando && (
        <BottomSheetConfirmarCompra
          item={itemConfirmando}
          onClose={() => setItemConfirmando(null)}
          onConfirmar={handleConfirmarCompra}
        />
      )}

      {/* Bottom sheet de preço (para itens já comprados) */}
      {itemPreco && (
        <BottomSheetPreco
          item={itemPreco}
          onClose={() => setItemPreco(null)}
          onConfirmar={preco => definirPreco(itemPreco.id, preco)}
        />
      )}

      {/* Finalizar compra */}
      {finalizandoCompra && (
        <BottomSheetFinalizarCompra
          comprados={comprados}
          totalCalculado={totalComprados}
          salvando={salvandoHistorico}
          onClose={() => setFinalizandoCompra(false)}
          onFinalizar={handleFinalizar}
        />
      )}

      {/* Toast de exclusão com undo */}
      {deleteToast && (
        <div className="fixed bottom-24 left-4 right-4 z-[300] max-w-md mx-auto toast-enter">
          <div className="flex items-center gap-3 bg-gray-900 text-white rounded-2xl px-4 py-3.5 shadow-float">
            <Trash2 className="w-4 h-4 text-red-400 flex-none" strokeWidth={2} />
            <p className="flex-1 text-sm font-medium truncate">
              <span className="text-gray-300">&ldquo;{deleteToast.nome}&rdquo;</span> removido
            </p>
            <button
              type="button"
              onClick={handleDesfazerExclusao}
              className="text-xs font-semibold text-primary-300 hover:text-primary-200 py-1 px-2 rounded-lg transition-colors"
            >
              Desfazer
            </button>
            <button
              type="button"
              onClick={handleFecharDeleteToast}
              className="text-gray-500 hover:text-gray-300 transition-colors"
              aria-label="Fechar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Toast de sucesso ao salvar histórico */}
      {successToast && (
        <div className="fixed bottom-24 left-4 right-4 z-[300] max-w-md mx-auto toast-enter">
          <div className="flex items-center gap-3 bg-green-600 text-white rounded-2xl px-4 py-3.5 shadow-float">
            <Check className="w-4 h-4 flex-none" strokeWidth={2.5} />
            <p className="flex-1 text-sm font-semibold">Compra salva no histórico!</p>
            <button
              type="button"
              onClick={() => router.push('/lista-mercado/historico')}
              className="text-xs font-semibold text-green-200 hover:text-white py-1 px-2 rounded-lg transition-colors"
            >
              Ver
            </button>
          </div>
        </div>
      )}

      {/* Rodapé */}
      <TotalRodape
        total={total}
        semPreco={semPreco}
        compradosCount={comprados.length}
        totalComprados={totalComprados}
        onFinalizar={() => setFinalizandoCompra(true)}
      />
    </div>
  )
}
