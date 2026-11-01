'use client'

import { useState, useRef, useEffect, useCallback, type FormEvent, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  ShoppingBasket, Plus, Minus, Check, Pencil, ChevronDown, ChevronUp,
  WifiOff, RefreshCw, AlertCircle, AlertTriangle, History, Camera, LayoutGrid, Undo2, Search, X,
} from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import { SwipeableItem } from '@/components/SwipeableItem'
import { CameraOCR } from '@/components/CameraOCR'
import { useListaMercado, type ItemMercado, type ResultadoAdicionar } from '@/lib/useListaMercado'
import { mensagemDuplicado } from '@/lib/listaMercadoDuplicados'
import { SETORES, SETOR_EMOJI, setorDoItem, agruparPorSetor, type Setor } from '@/lib/setoresMercado'
import { type PendingOp } from '@/lib/offlineQueue'
import { useHistoricoCompras } from '@/lib/useHistoricoCompras'
import { formatBRL, mascaraMoeda, formatarMoedaInput, parseMoeda } from '@/lib/format'
import {
  usePrecosAnteriores, precoAnteriorDe, alertaPreco, alertaTotal, type PrecoAnterior,
} from '@/lib/precosMercado'
import {
  filtrarComprados, ORDENS_COMPRADOS, ehOrdemComprados, type OrdemComprados,
} from '@/lib/compradosMercado'
import PageHeader, { PAGE_HEADER_PILL } from '@/components/PageHeader'

// ── Constantes ────────────────────────────────────────────────────────────────

const HIST_KEY = 'lista-mercado-historico'
const HINT_KEY = 'lista-mercado-swipe-hint'
const AGRUPAR_SETOR_KEY = 'lista-mercado-agrupar-setor'
const ORDEM_COMPRADOS_KEY = 'lista-mercado-ordem-comprados'
/** A partir de quantos comprados aparecem busca, filtro e ordenação. */
const MIN_COMPRADOS_FILTRO = 3
const MAX_HIST = 50
const UNDO_MS = 5000
/** Quantidade máxima lida do texto ("Leite 2"). Números maiores ficam no nome ("Farinha 500"). */
const MAX_QTD_TEXTO = 99

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

// "Leite 2" / "Leite 2x" → 2 unidades de Leite. Números grandes ("Farinha 500",
// "Leite 1000") quase sempre são peso/volume ou erro de digitação, então ficam no nome.
function parsearInput(text: string): { nome: string; quantidade: number } {
  const match = text.trim().match(/^(.+?)\s+(\d{1,3})x?$/i)
  if (match) {
    const qtd = parseInt(match[2], 10)
    if (qtd >= 1 && qtd <= MAX_QTD_TEXTO) return { nome: match[1].trim(), quantidade: qtd }
  }
  return { nome: text.trim(), quantidade: 1 }
}

function dataCurta(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

// ── Peças compartilhadas dos sheets de preço ─────────────────────────────────

/** "Última compra: R$ 4,99 · 12/10  [Usar]" — preenche o campo com um toque. */
function UltimoPreco({ anterior, onUsar }: { anterior: PrecoAnterior | null; onUsar: (preco: number) => void }) {
  if (!anterior) return null
  return (
    <button
      type="button"
      onClick={() => onUsar(anterior.preco)}
      className="w-full flex items-center justify-between gap-2 mb-2 px-3.5 py-2.5 rounded-2xl bg-gray-50
                 text-left active:bg-gray-100 transition-colors"
    >
      <span className="text-xs text-gray-500 font-medium">
        Última compra: <span className="font-bold text-gray-700 num">{formatBRL(anterior.preco)}</span>
        {dataCurta(anterior.data) && <span className="text-gray-400"> · {dataCurta(anterior.data)}</span>}
      </span>
      <span className="text-xs font-bold text-primary-600 flex-none">Usar</span>
    </button>
  )
}

function AvisoValor({ mensagem }: { mensagem: string | null }) {
  if (!mensagem) return null
  return (
    <div role="alert" className="mb-3 flex items-start gap-2 px-3.5 py-3 rounded-2xl bg-amber-50 text-amber-800">
      <AlertTriangle className="w-4 h-4 flex-none mt-0.5 text-amber-500" strokeWidth={2.2} />
      <p className="text-xs font-semibold leading-snug">
        {mensagem} <span className="font-medium">Toque de novo para confirmar.</span>
      </p>
    </div>
  )
}

/**
 * Exige um segundo toque quando o valor parece erro de digitação.
 * `tentar()` devolve true quando pode prosseguir. Mudar o valor zera a confirmação.
 */
function useConfirmacaoValor(alerta: string | null) {
  const [visto, setVisto] = useState<string | null>(null)
  const pendente = alerta != null && visto === alerta
  function tentar(): boolean {
    if (alerta && visto !== alerta) { setVisto(alerta); return false }
    return true
  }
  return { avisoVisivel: pendente ? alerta : null, pendente, tentar }
}

function Stepper({ valor, onChange }: { valor: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, valor - 1))}
        disabled={valor <= 1}
        aria-label="Diminuir quantidade"
        className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-200 disabled:opacity-30 transition-colors active:scale-90"
      >
        <Minus className="w-5 h-5" strokeWidth={2.5} />
      </button>
      <span className="flex-1 text-center text-3xl font-bold text-gray-900 tabular-nums num">{valor}</span>
      <button
        type="button"
        onClick={() => onChange(valor + 1)}
        aria-label="Aumentar quantidade"
        className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-200 transition-colors active:scale-90"
      >
        <Plus className="w-5 h-5" strokeWidth={2.5} />
      </button>
    </div>
  )
}

// ── Bottom sheet de preço ─────────────────────────────────────────────────────

function BottomSheetPreco({
  item,
  anterior,
  isOnline,
  onClose,
  onConfirmar,
}: {
  item: ItemMercado
  anterior: PrecoAnterior | null
  isOnline: boolean
  onClose: () => void
  onConfirmar: (preco: number | null, qtd: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [valor, setValor] = useState(formatarMoedaInput(item.preco_unit))
  const [qtd, setQtd] = useState(item.quantidade)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [cameraAberta, setCameraAberta] = useState(false)

  const precoNum = valor.trim() ? parseMoeda(valor) : null
  const confirmacao = useConfirmacaoValor(alertaPreco(precoNum, anterior))

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
    if (!confirmacao.tentar()) return
    onConfirmar(precoNum, qtd)
    onClose()
  }

  // Valor lido pela câmera volta para o campo — passa pela mesma conferência
  function handleCameraConfirmar(preco: number) {
    setValor(formatarMoedaInput(preco))
    setCameraAberta(false)
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
            <p className="text-xs text-gray-500 mb-0.5 font-semibold">Preço unitário de</p>
            <p className="text-base font-bold text-gray-900 mb-4 truncate">{item.nome}</p>

            <form onSubmit={e => { e.preventDefault(); handleConfirmar() }}>
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-500 mb-2">Quantidade</label>
                <Stepper valor={qtd} onChange={setQtd} />
              </div>
              <UltimoPreco anterior={anterior} onUsar={p => setValor(formatarMoedaInput(p))} />
              <div className="relative mb-3">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-semibold">R$</span>
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="decimal"
                  value={valor}
                  onChange={e => setValor(mascaraMoeda(e.target.value))}
                  onKeyDown={e => e.key === 'Escape' && onClose()}
                  placeholder="0,00"
                  enterKeyHint="done"
                  className="w-full pl-10 pr-4 py-3.5 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-900
                             placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
                />
              </div>

              <AvisoValor mensagem={confirmacao.avisoVisivel} />

              {isOnline && (
                <button
                  type="button"
                  onClick={() => setCameraAberta(true)}
                  className="w-full flex items-center justify-center gap-2 py-3 mb-4 rounded-2xl border-dashed bg-primary-50 text-primary-600 active:bg-primary-100 transition-colors active:scale-[0.99]"
                >
                  <Camera className="w-4 h-4" strokeWidth={2} />
                  <span className="text-sm font-semibold">Ler preço com câmera</span>
                </button>
              )}

              <div className="flex gap-3">
                {item.preco_unit != null && (
                  <button
                    type="button"
                    onClick={() => { onConfirmar(null, qtd); onClose() }}
                    className="px-4 py-3.5 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-500
                               hover:bg-gray-50 transition-colors active:scale-[0.97]"
                  >
                    Remover
                  </button>
                )}
                <button type="button" onClick={onClose}
                  className="flex-1 py-3.5 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors active:scale-[0.97]">
                  Cancelar
                </button>
                <button type="submit"
                  className={`flex-1 py-3.5 rounded-full text-white text-sm font-semibold transition-colors active:scale-[0.97]
                              ${confirmacao.pendente ? 'bg-amber-500 hover:bg-amber-600' : 'bg-primary-600 hover:bg-primary-700'}`}>
                  {confirmacao.pendente ? 'Confirmar mesmo assim' : 'Confirmar'}
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
  anterior,
  isOnline,
  onClose,
  onConfirmar,
}: {
  item: ItemMercado
  anterior: PrecoAnterior | null
  isOnline: boolean
  onClose: () => void
  onConfirmar: (qtd: number, preco: number | null) => void
}) {
  const precoInputRef = useRef<HTMLInputElement>(null)
  const [qtd, setQtd] = useState(item.quantidade)
  const [preco, setPreco] = useState(formatarMoedaInput(item.preco_unit))
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

  const precoNum = preco.trim() ? parseMoeda(preco) : null
  const subtotal = precoNum != null && !isNaN(precoNum) ? qtd * precoNum : null
  const confirmacao = useConfirmacaoValor(alertaPreco(precoNum, anterior))

  function handleComprado() {
    if (!confirmacao.tentar()) return
    onConfirmar(qtd, precoNum)
    onClose()
  }

  function handlePrecoCamera(valor: number) {
    setPreco(formatarMoedaInput(valor))
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
              <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center flex-none">
                <Check className="w-5 h-5 text-green-500" strokeWidth={2.5} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-gray-500 font-semibold">Conferir antes de marcar</p>
                <p className="text-base font-bold text-gray-900 truncate">{item.nome}</p>
              </div>
            </div>

            {/* Quantidade */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-500 mb-2">Quantidade</label>
              <Stepper valor={qtd} onChange={setQtd} />
            </div>

            {/* Preço unitário */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-500 mb-2">Preço unitário</label>
              <UltimoPreco anterior={anterior} onUsar={p => setPreco(formatarMoedaInput(p))} />
              <div className="relative mb-2">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-semibold">R$</span>
                <input
                  ref={precoInputRef}
                  type="text"
                  inputMode="decimal"
                  value={preco}
                  onChange={e => setPreco(mascaraMoeda(e.target.value))}
                  onKeyDown={e => {
                    if (e.key === 'Escape') onClose()
                    if (e.key === 'Enter') { e.preventDefault(); handleComprado() }
                  }}
                  placeholder="0,00"
                  enterKeyHint="done"
                  className="w-full pl-10 pr-4 py-3.5 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-900
                             placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
                />
              </div>
              {isOnline && (
                <button
                  type="button"
                  onClick={() => setCameraAberta(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border-dashed bg-green-50 text-green-700 active:bg-green-100 transition-colors active:scale-[0.99]"
                >
                  <Camera className="w-4 h-4" strokeWidth={2} />
                  <span className="text-sm font-semibold">Ler preço com câmera</span>
                </button>
              )}
            </div>

            {/* Subtotal */}
            {subtotal != null && (
              <div className="mb-4 px-4 py-3.5 rounded-2xl bg-green-50 flex items-center justify-between">
                <span className="text-sm text-green-700 font-semibold">Total do item</span>
                <span className="text-lg font-bold text-green-700 num">{formatBRL(subtotal)}</span>
              </div>
            )}

            <AvisoValor mensagem={confirmacao.avisoVisivel} />

            {/* Ações */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3.5 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors active:scale-[0.97]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleComprado}
                className={`flex-1 py-3.5 rounded-full text-white text-sm font-semibold transition-colors active:scale-[0.97]
                            flex items-center justify-center gap-2
                            ${confirmacao.pendente ? 'bg-amber-500 hover:bg-amber-600' : 'bg-primary-600 hover:bg-primary-700'}`}
              >
                <Check className="w-4 h-4" strokeWidth={2.5} />
                {confirmacao.pendente ? 'Confirmar mesmo assim' : 'Comprado'}
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
    totalCalculado > 0 ? formatarMoedaInput(totalCalculado) : ''
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

  const valorNum = parseMoeda(valor)
  const valido = !isNaN(valorNum) && valorNum >= 0
  const todosComPreco = comprados.length > 0 && comprados.every(i => i.preco_unit != null)
  const confirmacao = useConfirmacaoValor(
    valido ? alertaTotal(valorNum, totalCalculado, todosComPreco) : null,
  )

  function handleSalvar() {
    if (!valido || salvando || !confirmacao.tentar()) return
    onFinalizar(valorNum)
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

          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center flex-none">
              <ShoppingBasket className="w-5 h-5 text-emerald-600" strokeWidth={1.8} />
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
            <div className="mb-4 max-h-36 overflow-y-auto rounded-2xl border border-gray-100 divide-y divide-gray-50">
              {comprados.slice(0, 8).map(item => (
                <div key={item.id} className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-sm text-gray-700 truncate flex-1 mr-2">{item.nome}</span>
                  <span className="text-xs text-gray-400 flex-none num">
                    {item.quantidade}× {item.preco_unit != null ? formatBRL(item.preco_unit) : '—'}
                  </span>
                </div>
              ))}
              {comprados.length > 8 && (
                <div className="px-3.5 py-2 text-xs text-gray-400 text-center">
                  +{comprados.length - 8} itens
                </div>
              )}
            </div>
          )}

          {/* Valor total pago */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 mb-2">Valor total pago</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-semibold">R$</span>
              <input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                value={valor}
                onChange={e => setValor(mascaraMoeda(e.target.value))}
                onKeyDown={e => {
                  if (e.key === 'Escape') onClose()
                  if (e.key === 'Enter') { e.preventDefault(); handleSalvar() }
                }}
                placeholder="0,00"
                enterKeyHint="done"
                className="w-full pl-10 pr-4 py-3.5 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-900
                           placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
              />
            </div>
            {totalCalculado > 0 && (
              <p className="text-[11px] text-gray-400 mt-1.5 num">
                Estimado pela lista: {formatBRL(totalCalculado)}
              </p>
            )}
          </div>

          <AvisoValor mensagem={confirmacao.avisoVisivel} />

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3.5 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors active:scale-[0.97]"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!valido || salvando}
              onClick={handleSalvar}
              className={`flex-1 py-3.5 rounded-full text-white text-sm font-semibold
                          disabled:opacity-50 transition-colors active:scale-[0.97]
                          flex items-center justify-center gap-2
                          ${confirmacao.pendente ? 'bg-amber-500 hover:bg-amber-600' : 'bg-primary-600 hover:bg-primary-700'}`}
            >
              {salvando ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" strokeWidth={2.5} />
              )}
              {confirmacao.pendente ? 'Salvar mesmo assim' : 'Salvar no Histórico'}
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
            <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center flex-none">
              <RefreshCw className="w-5 h-5 text-amber-500" strokeWidth={2} />
            </div>
            <div>
              <p className="text-base font-bold text-gray-900">Operações pendentes</p>
              <p className="text-xs text-gray-400">
                {ops.length} {ops.length === 1 ? 'ação aguardando sync' : 'ações aguardando sync'}
              </p>
            </div>
          </div>

          <div className="mb-4 rounded-2xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
            {ops.map(op => (
              <div key={op.opId} className="flex items-center gap-3 px-3.5 py-3">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-none
                  ${op.type === 'create' ? 'bg-green-50 text-green-600' :
                    op.type === 'delete' ? 'bg-red-50 text-red-500' :
                    'bg-blue-50 text-blue-600'}`}>
                  {OP_LABEL[op.type]}
                </span>
                <span className="text-sm text-gray-700 truncate flex-1">{resolveNome(op)}</span>
                {op.retries > 0 && (
                  <span className="text-[10px] text-gray-400 flex-none num">{op.retries} tentativa{op.retries > 1 ? 's' : ''}</span>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-400 mb-5 text-center leading-relaxed">
            Essas ações ainda não foram salvas no servidor. Tente sincronizar ou descarte-as.
          </p>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { onClear(); onClose() }}
              className="flex-1 py-3.5 rounded-2xl border border-red-200 text-sm font-semibold text-red-500
                         hover:bg-red-50 transition-colors active:scale-[0.97]"
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={() => { onSync(); onClose() }}
              className="flex-1 py-3.5 rounded-2xl bg-amber-500 text-white text-sm font-semibold
                         hover:bg-amber-600 transition-colors active:scale-[0.97] flex items-center justify-center gap-2"
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

// ── Bottom sheet de setor ─────────────────────────────────────────────────────

function BottomSheetSetor({
  item,
  onClose,
  onEscolher,
}: {
  item: ItemMercado
  onClose: () => void
  onEscolher: (setor: Setor) => void
}) {
  const atual = setorDoItem(item)
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
            <div className="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center flex-none">
              <LayoutGrid className="w-5 h-5 text-primary-600" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <p className="text-base font-bold text-gray-900">Setor do mercado</p>
              <p className="text-xs text-gray-400 truncate">{item.nome}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {SETORES.map(setor => (
              <button
                key={setor}
                type="button"
                onClick={() => { onEscolher(setor); onClose() }}
                aria-pressed={setor === atual}
                className={`flex items-center gap-2 px-3 py-3 rounded-2xl border text-sm font-semibold text-left
                            transition-all active:scale-[0.97]
                            ${setor === atual
                              ? 'border-primary-400 bg-primary-50 text-primary-700'
                              : 'border-gray-100 text-gray-700 hover:bg-gray-50'}`}
              >
                <span aria-hidden className="text-base">{SETOR_EMOJI[setor]}</span>
                <span className="truncate">{setor}</span>
              </button>
            ))}
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
  onAbrirSetor,
}: {
  item: ItemMercado
  mostraHint: boolean
  onToggle: (id: string) => void
  onAlterarQtd: (id: string, delta: number) => void
  onEditarNome: (id: string, nome: string) => ResultadoAdicionar
  onExcluir: (id: string) => void
  onAbrirPreco: (item: ItemMercado) => void
  onAbrirConfirmarCompra: (item: ItemMercado) => void
  onAbrirSetor: (item: ItemMercado) => void
}) {
  const [editandoNome, setEditandoNome] = useState(false)
  const [nomeLocal, setNomeLocal] = useState(item.nome)
  const [erroNome, setErroNome] = useState('')
  const inputNomeRef = useRef<HTMLInputElement>(null)

  // Esconde o aviso de nome duplicado após alguns segundos
  useEffect(() => {
    if (!erroNome) return
    const t = setTimeout(() => setErroNome(''), 4000)
    return () => clearTimeout(t)
  }, [erroNome])

  useEffect(() => { setNomeLocal(item.nome) }, [item.nome])

  function ativarEdicao() {
    setErroNome('')
    setEditandoNome(true)
    setTimeout(() => inputNomeRef.current?.focus(), 50)
  }

  function salvarNome() {
    setEditandoNome(false)
    if (nomeLocal.trim() && nomeLocal.trim() !== item.nome) {
      const resultado = onEditarNome(item.id, nomeLocal.trim())
      if (resultado.ok) {
        salvarHistorico(nomeLocal.trim())
      } else {
        // Duplicado: volta ao nome original e avisa
        setNomeLocal(item.nome)
        if (resultado.motivo === 'duplicado') setErroNome(mensagemDuplicado(resultado.item))
      }
    } else {
      setNomeLocal(item.nome)
    }
  }

  // Toque principal da linha (checkbox ou nome): marca como comprado conferindo
  // qtd/preço; num item já comprado, o checkbox desmarca (com "Desfazer").
  function acaoCheckbox() {
    if (item.comprado) onToggle(item.id)
    else onAbrirConfirmarCompra(item)
  }

  const subtotal = item.quantidade * (item.preco_unit ?? 0)

  return (
    <SwipeableItem onDelete={() => onExcluir(item.id)} disabled={editandoNome}>
      <div
        className={`flex items-center gap-2 pl-4 pr-3 bg-white border-b border-gray-50
                    transition-all duration-200 ease-smooth ${item.comprado ? 'py-2' : 'py-2.5'}`}
      >
        {/* Checkbox — 44px touch target */}
        <button
          type="button"
          onClick={acaoCheckbox}
          aria-label={item.comprado ? `Desmarcar ${item.nome}` : `Marcar ${item.nome} como comprado`}
          className="flex-none flex items-center justify-center active:scale-90 transition-transform"
          style={{ minWidth: 44, minHeight: 44, margin: '0 -6px' }}
        >
          <span
            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-150
                        ${item.comprado
                          ? 'bg-green-500 border-green-500'
                          : 'border-gray-300'}`}
          >
            {item.comprado && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
          </span>
        </button>

        {/* Nome + autor */}
        <div className={`flex-1 min-w-0 ${item.comprado ? 'opacity-50' : ''}`}>
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
              autoCapitalize="sentences"
              autoCorrect="on"
              spellCheck
              enterKeyHint="done"
              className="w-full text-sm font-medium text-gray-900 bg-transparent border-b border-primary-400
                         focus:outline-none py-1.5"
            />
          ) : (
            <button
              type="button"
              onClick={item.comprado ? () => onAbrirPreco(item) : acaoCheckbox}
              className={`text-left text-sm font-medium leading-snug w-full min-h-[32px] py-1
                          ${item.comprado ? 'line-through text-gray-400' : 'text-gray-900'}`}
            >
              <span className="break-words line-clamp-2">{item.nome}</span>
            </button>
          )}
          {erroNome && !editandoNome && (
            <p role="alert" className="mt-0.5 text-[11px] text-red-500 font-medium">{erroNome}</p>
          )}
          {!editandoNome && !item.comprado && (
            <div className="flex flex-wrap items-center gap-1">
              {item.criado_por && (
                <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full
                                  ${corUsuario(item.criado_por)}`}>
                  {nomeCurto(item.criado_por)}
                </span>
              )}
              <button
                type="button"
                onClick={() => onAbrirSetor(item)}
                aria-label={`Setor: ${setorDoItem(item)}. Trocar setor`}
                className="inline-flex items-center gap-0.5 text-[11px] font-semibold px-2 py-1 rounded-full
                           bg-gray-100 text-gray-500 hover:bg-gray-200 active:scale-95 transition-all"
              >
                <span aria-hidden>{SETOR_EMOJI[setorDoItem(item)]}</span>
                {setorDoItem(item)}
              </button>
            </div>
          )}
          {mostraHint && !item.comprado && (
            <span className="block text-[10px] text-gray-300 italic mt-0.5">
              Toque no nome para marcar · ← deslize para excluir
            </span>
          )}
        </div>

        {!item.comprado && !editandoNome && (
          <>
            {/* Renomear: ação separada para não abrir o teclado por engano */}
            <button
              type="button"
              onClick={ativarEdicao}
              aria-label={`Renomear ${item.nome}`}
              className="flex-none w-9 h-9 rounded-full flex items-center justify-center text-gray-300
                         hover:text-gray-500 hover:bg-gray-50 active:bg-gray-100 transition-colors"
            >
              <Pencil className="w-4 h-4" strokeWidth={2} />
            </button>

            {/* Controles de quantidade — 36px por botão */}
            <div className="flex items-center gap-0.5 flex-none">
              <button
                type="button"
                onClick={() => onAlterarQtd(item.id, -1)}
                disabled={item.quantidade <= 1}
                className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-200 disabled:opacity-30 transition-colors active:scale-90"
                aria-label={`Diminuir quantidade de ${item.nome}`}
              >
                <Minus className="w-4 h-4" strokeWidth={2.5} />
              </button>
              <span className="text-base font-bold text-gray-900 min-w-[28px] text-center tabular-nums">
                {item.quantidade}
              </span>
              <button
                type="button"
                onClick={() => onAlterarQtd(item.id, +1)}
                className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-200 transition-colors active:scale-90"
                aria-label={`Aumentar quantidade de ${item.nome}`}
              >
                <Plus className="w-4 h-4" strokeWidth={2.5} />
              </button>
            </div>
          </>
        )}

        {/* Quantidade × preço — item comprado; toque abre o sheet para corrigir */}
        {item.comprado && (
          <button
            type="button"
            onClick={() => onAbrirPreco(item)}
            className="flex-none text-right min-w-[72px] min-h-[44px] px-1 flex flex-col items-end justify-center
                       rounded-xl active:bg-gray-50 active:scale-95 transition-all"
            aria-label={`Corrigir quantidade e preço de ${item.nome}`}
          >
            {item.preco_unit != null ? (
              <>
                <p className="text-[10px] text-gray-400 leading-none num">
                  {item.quantidade} × {formatBRL(item.preco_unit)}
                </p>
                <p className="text-sm font-bold text-gray-700 num mt-0.5">
                  {formatBRL(subtotal)}
                </p>
              </>
            ) : (
              <>
                <p className="text-[10px] text-gray-400 leading-none num">{item.quantidade} un.</p>
                <span className="text-xs text-primary-500 font-semibold mt-0.5">+ preço</span>
              </>
            )}
          </button>
        )}
      </div>
    </SwipeableItem>
  )
}

// ── Busca / filtro / ordenação dos comprados ─────────────────────────────────

function FiltrosComprados({
  busca,
  onBusca,
  soSemPreco,
  onSoSemPreco,
  qtdSemPreco,
  ordem,
  onOrdem,
}: {
  busca: string
  onBusca: (v: string) => void
  soSemPreco: boolean
  onSoSemPreco: (v: boolean) => void
  qtdSemPreco: number
  ordem: OrdemComprados
  onOrdem: (o: OrdemComprados) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="px-3 pt-2.5 pb-2 bg-gray-50 border-b border-gray-100 space-y-2">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" strokeWidth={2} />
        <input
          ref={inputRef}
          type="search"
          value={busca}
          onChange={e => onBusca(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') onBusca('')
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          placeholder="Buscar nos comprados…"
          aria-label="Buscar nos itens comprados"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className="w-full h-11 pl-10 pr-11 rounded-xl bg-white border border-gray-200 text-sm font-medium text-gray-900
                     placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent
                     [&::-webkit-search-cancel-button]:hidden"
        />
        {busca && (
          <button
            type="button"
            onClick={() => { onBusca(''); inputRef.current?.focus() }}
            aria-label="Limpar busca"
            className="absolute right-0 top-0 w-11 h-11 flex items-center justify-center text-gray-400 active:text-gray-600"
          >
            <X className="w-4 h-4" strokeWidth={2.5} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto -mx-3 px-3 scrollbar-hide">
        {(qtdSemPreco > 0 || soSemPreco) && (
          <button
            type="button"
            onClick={() => onSoSemPreco(!soSemPreco)}
            aria-pressed={soSemPreco}
            className={`flex-none h-9 px-3 rounded-full text-xs font-bold border transition-colors active:scale-95
                        ${soSemPreco
                          ? 'bg-amber-500 border-amber-500 text-white'
                          : 'bg-white border-amber-200 text-amber-700'}`}
          >
            Sem preço · {qtdSemPreco}
          </button>
        )}
        <div role="radiogroup" aria-label="Ordenar comprados" className="flex-none flex items-center gap-1 ml-auto">
          {ORDENS_COMPRADOS.map(o => (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={ordem === o.valor}
              onClick={() => onOrdem(o.valor)}
              className={`flex-none h-9 px-3 rounded-full text-xs font-semibold border transition-colors active:scale-95
                          ${ordem === o.valor
                            ? 'bg-gray-900 border-gray-900 text-white'
                            : 'bg-white border-gray-200 text-gray-600'}`}
            >
              {o.rotulo}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Barra de subtotal flutuante ───────────────────────────────────────────────

function SubtotalBar({
  total,
  semPreco,
  compradosCount,
  totalItens,
  onFinalizar,
}: {
  total: number
  semPreco: number
  compradosCount: number
  totalItens: number
  onFinalizar: () => void
}) {
  if (totalItens === 0) return null

  const progress = compradosCount / totalItens

  return (
    <div
      className="fixed left-0 right-0 z-40 px-3 pb-2 pointer-events-none"
      style={{ bottom: 'calc(4rem + var(--safe-bottom))' }}
    >
      <div className="max-w-md md:max-w-2xl lg:max-w-5xl xl:max-w-7xl mx-auto">
        <div className="subtotal-bar rounded-2xl overflow-hidden pointer-events-auto">

          {/* Barra de progresso */}
          <div className="h-[3px] bg-gray-100">
            <div
              className="h-full bg-green-500 transition-[width] duration-500 ease-out"
              style={{ width: `${progress * 100}%` }}
            />
          </div>

          {/* Conteúdo */}
          <div className="flex items-center gap-3 px-4 py-2.5">

            {/* Contagem de itens */}
            <div className="flex flex-col flex-none min-w-0">
              {compradosCount > 0 ? (
                <span className="text-xs font-medium text-gray-500 tabular-nums leading-tight">
                  <span className="font-bold text-green-600">{compradosCount}</span>
                  <span className="text-gray-400">/{totalItens}</span>
                </span>
              ) : (
                <span className="text-xs font-medium text-gray-500 tabular-nums leading-tight">
                  {totalItens} {totalItens === 1 ? 'item' : 'itens'}
                </span>
              )}
              {semPreco > 0 && (
                <span className="text-[9px] text-gray-400 font-medium tabular-nums leading-tight">
                  +{semPreco} s/preço
                </span>
              )}
            </div>

            {/* Divisor */}
            <div className="w-px h-5 bg-gray-200 flex-none" />

            {/* Valor total */}
            <div className="flex-1 min-w-0">
              {semPreco > 0 && (
                <p className="text-[10px] text-gray-500 leading-none mb-0.5 font-medium">
                  Parcial
                </p>
              )}
              <span className="text-sm font-bold text-gray-900 num">
                {formatBRL(total)}
              </span>
            </div>

            {/* CTA Finalizar */}
            {compradosCount > 0 && (
              <button
                type="button"
                onClick={onFinalizar}
                className="flex items-center gap-1.5 text-[11px] font-bold text-white
                           bg-emerald-500 hover:bg-emerald-600
                           px-3 py-2 rounded-xl transition-all ease-spring active:scale-90 flex-none"
              >
                <Check className="w-3 h-3" strokeWidth={2.5} />
                Finalizar · {compradosCount}
              </button>
            )}
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
  onAdicionar: (nome: string, quantidade: number) => Promise<ResultadoAdicionar>
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
      const resultado = await onAdicionar(nome, quantidade)
      if (!resultado.ok) {
        if (resultado.motivo === 'duplicado') {
          setErro(mensagemDuplicado(resultado.item))
          setSugestoes([])
        }
        return
      }
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

  // Sugestão só preenche o campo (mantendo a quantidade digitada): um toque
  // errado na lista não adiciona item nenhum — o usuário confirma no botão +.
  function escolherSugestao(s: string) {
    const { quantidade } = parsearInput(valor)
    setValor(quantidade > 1 ? `${s} ${quantidade}` : s)
    setSugestoes([])
    if (erro) setErro('')
    inputRef.current?.focus()
  }

  const previa = parsearInput(valor)
  const mostraPrevia = !erro && sugestoes.length === 0 && previa.nome !== '' && previa.quantidade > 1

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
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          autoComplete="off"
          enterKeyHint="send"
          className="flex-1 px-4 py-2.5 rounded-full bg-white border-0 text-sm font-medium text-gray-900
                     placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-white/60"
        />
        <button
          type="submit"
          disabled={!valor.trim()}
          aria-label="Adicionar item"
          className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-primary-600
                     disabled:opacity-60 hover:bg-primary-50 transition-all ease-smooth active:scale-90
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <Plus className="w-5 h-5" strokeWidth={2.5} />
        </button>
      </form>

      {/* Autocomplete */}
      {sugestoes.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-2xl shadow-soft-md z-20 overflow-hidden">
          {sugestoes.map(s => (
            <button
              key={s}
              type="button"
              // preventDefault mantém o foco no campo (o blur esconderia a lista)
              onPointerDown={e => e.preventDefault()}
              onClick={() => escolherSugestao(s)}
              className="w-full text-left px-4 py-3.5 text-sm text-gray-800 hover:bg-gray-50 active:bg-gray-100
                         transition-colors border-b border-gray-50 last:border-0 font-medium"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {mostraPrevia && (
        <p className="text-xs text-white/90 mt-1.5 font-medium px-1">
          Vai adicionar: <span className="font-bold">{previa.quantidade}× {previa.nome}</span>
        </p>
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
    itens: todosItens,
    adicionar, alterarQuantidade, editarNome, definirSetor,
    toggleComprado, restaurar, excluir, limparComprados,
    isOnline, pendingCount, pendingOps, syncStatus, flushQueue, clearPendingQueue,
  } = useListaMercado()
  const { salvar: salvarHistorico } = useHistoricoCompras()
  const precosAnteriores = usePrecosAnteriores()

  // ── Desfazer ──────────────────────────────────────────────────────────────
  // Exclusões ficam só ocultas por UNDO_MS e são efetivadas depois (ou quando
  // outra ação substitui o aviso / a página é fechada). Marcar/desmarcar e
  // corrigir preço são aplicados na hora e o "Desfazer" restaura o estado anterior.
  const [ocultos, setOcultos] = useState<ReadonlySet<string>>(() => new Set())
  const [undo, setUndo] = useState<{ id: number; mensagem: string } | null>(null)
  const undoRef = useRef<{ id: number; desfazer: () => void; efetivar?: () => void } | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const efetivarUndo = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = null
    const atual = undoRef.current
    undoRef.current = null
    setUndo(null)
    atual?.efetivar?.()
  }, [])

  const oferecerUndo = useCallback((mensagem: string, desfazer: () => void, efetivar?: () => void) => {
    efetivarUndo()
    const id = Date.now()
    undoRef.current = { id, desfazer, efetivar }
    setUndo({ id, mensagem })
    undoTimerRef.current = setTimeout(efetivarUndo, UNDO_MS)
  }, [efetivarUndo])

  function desfazer() {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = null
    const atual = undoRef.current
    undoRef.current = null
    setUndo(null)
    atual?.desfazer()
  }

  // Saiu da página com uma exclusão pendente: efetiva
  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoRef.current?.efetivar?.()
    undoRef.current = null
  }, [])

  const itens = ocultos.size ? todosItens.filter(i => !ocultos.has(i.id)) : todosItens

  const [pendingOpsAberto, setPendingOpsAberto] = useState(false)
  const [itemPreco, setItemPreco] = useState<ItemMercado | null>(null)
  const [itemConfirmando, setItemConfirmando] = useState<ItemMercado | null>(null)
  const [finalizandoCompra, setFinalizandoCompra] = useState(false)
  const [salvandoHistorico, setSalvandoHistorico] = useState(false)
  const [hintVisto, setHintVisto] = useState(true)
  const [compradosAbertos, setCompradosAbertos] = useState(true)
  const [buscaComprados, setBuscaComprados] = useState('')
  const [soSemPreco, setSoSemPreco] = useState(false)
  const [ordemComprados, setOrdemComprados] = useState<OrdemComprados>('recentes')
  // Quando cada item foi marcado nesta sessão — base da ordem "Recentes"
  const [marcadoEm, setMarcadoEm] = useState<Record<string, number>>({})
  const [successToast, setSuccessToast] = useState(false)
  const [itemSetor, setItemSetor] = useState<ItemMercado | null>(null)
  const [agruparSetor, setAgruparSetor] = useState(false)

  // Preferência de agrupamento por setor, salva por aparelho
  useEffect(() => {
    try {
      if (localStorage.getItem(AGRUPAR_SETOR_KEY) === '1') setAgruparSetor(true)
      const ordemSalva = localStorage.getItem(ORDEM_COMPRADOS_KEY)
      if (ehOrdemComprados(ordemSalva)) setOrdemComprados(ordemSalva)
    } catch { /* storage indisponível */ }
  }, [])

  function escolherOrdemComprados(ordem: OrdemComprados) {
    setOrdemComprados(ordem)
    try { localStorage.setItem(ORDEM_COMPRADOS_KEY, ordem) } catch { /* ignore */ }
  }

  function registrarMarcacao(id: string) {
    setMarcadoEm(prev => ({ ...prev, [id]: Date.now() }))
  }

  function alternarAgrupamento() {
    setAgruparSetor(v => {
      const novo = !v
      try { localStorage.setItem(AGRUPAR_SETOR_KEY, novo ? '1' : '0') } catch { /* ignore */ }
      return novo
    })
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

  const comprados = itens.filter(i => i.comprado)
  const compradosSemPreco = comprados.filter(i => i.preco_unit == null).length
  const mostraFiltrosComprados = comprados.length >= MIN_COMPRADOS_FILTRO
  // Filtro "sem preço" se desfaz sozinho quando não sobra item sem preço
  const filtroSemPrecoAtivo = soSemPreco && compradosSemPreco > 0
  const filtrandoComprados = mostraFiltrosComprados && (buscaComprados.trim() !== '' || filtroSemPrecoAtivo)
  const compradosVisiveis = mostraFiltrosComprados
    ? filtrarComprados(comprados, {
        busca: buscaComprados,
        soSemPreco: filtroSemPrecoAtivo,
        ordem: ordemComprados,
        marcadoEm,
      })
    : filtrarComprados(comprados, { busca: '', soSemPreco: false, ordem: 'recentes', marcadoEm })
  const pendentes = itens.filter(i => !i.comprado)
  const todosVisiveis = [...pendentes, ...comprados]
  const total    = todosVisiveis.reduce((s, i) => s + i.quantidade * (i.preco_unit ?? 0), 0)
  const semPreco = todosVisiveis.filter(i => i.preco_unit == null).length
  const totalComprados = comprados.reduce((s, i) => s + i.quantidade * (i.preco_unit ?? 0), 0)

  function snapshot(item: ItemMercado) {
    return { comprado: item.comprado, quantidade: item.quantidade, preco_unit: item.preco_unit }
  }

  function handleToggle(id: string) {
    const item = itens.find(i => i.id === id)
    if (!item) return
    const antes = snapshot(item)
    toggleComprado(id, itens)
    if (!item.comprado) registrarMarcacao(id)
    oferecerUndo(
      item.comprado ? `"${item.nome}" voltou para pendentes` : `"${item.nome}" marcado como comprado`,
      () => restaurar(id, antes),
    )
  }
  const handleQtd = useCallback((id: string, d: number) => alterarQuantidade(id, d, itens), [alterarQuantidade, itens])

  function handleExcluir(id: string) {
    const item = itens.find(i => i.id === id)
    if (!item) return
    setOcultos(prev => new Set(prev).add(id))
    oferecerUndo(
      `"${item.nome}" excluído`,
      () => setOcultos(prev => { const n = new Set(prev); n.delete(id); return n }),
      () => {
        excluir(id)
        setOcultos(prev => { const n = new Set(prev); n.delete(id); return n })
      },
    )
  }

  // Aplica qtd e preço de uma vez (um único salvamento) e oferece "Desfazer"
  function aplicarCompra(item: ItemMercado, campos: { comprado: boolean; quantidade: number; preco_unit: number | null }, mensagem: string) {
    const antes = snapshot(item)
    restaurar(item.id, campos)
    oferecerUndo(mensagem, () => restaurar(item.id, antes))
  }

  function handleConfirmarCompra(qtd: number, preco: number | null) {
    if (!itemConfirmando) return
    const item = itens.find(i => i.id === itemConfirmando.id) ?? itemConfirmando
    registrarMarcacao(item.id)
    aplicarCompra(item, { comprado: true, quantidade: Math.max(1, qtd), preco_unit: preco },
      `"${item.nome}" marcado como comprado`)
  }

  function handleCorrigirPreco(preco: number | null, qtd: number) {
    if (!itemPreco) return
    const item = itens.find(i => i.id === itemPreco.id) ?? itemPreco
    if (preco === item.preco_unit && qtd === item.quantidade) return
    aplicarCompra(item, { comprado: item.comprado, quantidade: Math.max(1, qtd), preco_unit: preco },
      `"${item.nome}" atualizado`)
  }

  async function handleFinalizar(valorTotal: number) {
    efetivarUndo()
    setSalvandoHistorico(true)
    try {
      await salvarHistorico(itens, valorTotal)
      await limparComprados(itens)
      setBuscaComprados('')
      setSoSemPreco(false)
      setMarcadoEm({})
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
      <PageHeader
        title="Lista de Mercado"
        icon={ShoppingBasket}
        subtitle={
          <div className="flex items-center gap-2 flex-wrap">
            <p>
              {pendentes.length} {pendentes.length === 1 ? 'item pendente' : 'itens pendentes'}
              {comprados.length > 0 && (
                <span> · {comprados.length} comprado{comprados.length > 1 ? 's' : ''}</span>
              )}
            </p>
            {totalItens > 0 && comprados.length > 0 && (
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full num">
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
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={alternarAgrupamento}
              aria-pressed={agruparSetor}
              aria-label="Organizar por setor do mercado"
              className={`${PAGE_HEADER_PILL} ${agruparSetor ? '!bg-white !text-primary-700' : ''}`}
            >
              <LayoutGrid className="w-3.5 h-3.5" strokeWidth={2} />
              <span>Setores</span>
            </button>
            <button
              type="button"
              onClick={() => router.push('/lista-mercado/historico')}
              aria-label="Histórico de compras"
              className={PAGE_HEADER_PILL}
            >
              <History className="w-3.5 h-3.5" strokeWidth={2} />
              <span>Histórico</span>
            </button>
          </div>
        }
      >
        <InputAdicionar onAdicionar={adicionar} />
      </PageHeader>

      {/* Lista */}
      {itens.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center px-8">
          <div className={`w-16 h-16 rounded-3xl flex items-center justify-center mb-4 ${!isOnline ? 'bg-amber-50' : 'bg-green-50'}`}>
            {!isOnline
              ? <WifiOff className="w-7 h-7 text-amber-300" strokeWidth={1.5} />
              : <ShoppingBasket className="w-7 h-7 text-green-300" strokeWidth={1.5} />
            }
          </div>
          <p className="text-sm font-semibold text-gray-700 mb-1.5">
            {!isOnline ? 'Sem dados salvos offline' : 'Lista vazia'}
          </p>
          <p className="text-xs text-gray-400 leading-relaxed max-w-[220px]">
            {!isOnline
              ? 'Abra o app online ao menos uma vez para carregar sua lista'
              : 'Adicione os itens que precisam ser comprados'}
          </p>
        </div>
      ) : (
        <div className="bg-white mt-2 rounded-2xl mx-4 overflow-hidden shadow-soft">
          {/* Pendentes (agrupados por setor ou em lista única) */}
          {(agruparSetor ? agruparPorSetor(pendentes) : [{ setor: null, itens: pendentes }]).map(grupo => (
            <div key={grupo.setor ?? 'todos'}>
              {grupo.setor && (
                <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100">
                  <span aria-hidden className="text-sm">{SETOR_EMOJI[grupo.setor]}</span>
                  <span className="text-xs font-bold text-gray-600 flex-1 tracking-tight">{grupo.setor}</span>
                  <span className="text-[10px] font-semibold text-gray-400 tabular-nums">{grupo.itens.length}</span>
                </div>
              )}
              {grupo.itens.map(item => {
                const idx = pendentes.indexOf(item)
                return (
                  <div key={item.id} className="list-item-enter" style={{ animationDelay: `${Math.min(idx, 5) * 25}ms` }}>
                    <ItemRow
                      item={item}
                      mostraHint={idx === 0 && !hintVisto}
                      onToggle={handleToggle}
                      onAlterarQtd={handleQtd}
                      onEditarNome={editarNome}
                      onExcluir={handleExcluir}
                      onAbrirPreco={setItemPreco}
                      onAbrirConfirmarCompra={setItemConfirmando}
                      onAbrirSetor={setItemSetor}
                    />
                  </div>
                )
              })}
            </div>
          ))}

          {/* Comprados */}
          {comprados.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setCompradosAbertos(v => !v)}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 bg-gray-50 border-t border-b border-gray-100
                           hover:bg-gray-100 transition-colors"
              >
                <span className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-none">
                  <Check className="w-3 h-3 text-white" strokeWidth={3} />
                </span>
                <span className="text-xs font-bold text-gray-500 flex-1 text-left tracking-tight">
                  Comprados · {filtrandoComprados
                    ? `${compradosVisiveis.length} de ${comprados.length}`
                    : comprados.length}
                </span>
                {!filtrandoComprados && compradosSemPreco > 0 && (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full tabular-nums">
                    {compradosSemPreco} s/ preço
                  </span>
                )}
                {compradosAbertos
                  ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 flex-none" strokeWidth={2} />
                  : <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-none" strokeWidth={2} />
                }
              </button>
              {compradosAbertos && mostraFiltrosComprados && (
                <FiltrosComprados
                  busca={buscaComprados}
                  onBusca={setBuscaComprados}
                  soSemPreco={filtroSemPrecoAtivo}
                  onSoSemPreco={setSoSemPreco}
                  qtdSemPreco={compradosSemPreco}
                  ordem={ordemComprados}
                  onOrdem={escolherOrdemComprados}
                />
              )}
              {compradosAbertos && compradosVisiveis.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <p className="text-sm text-gray-500 font-medium">Nenhum comprado encontrado</p>
                  <button
                    type="button"
                    onClick={() => { setBuscaComprados(''); setSoSemPreco(false) }}
                    className="mt-2 min-h-[44px] px-4 text-sm font-bold text-primary-600 active:text-primary-700"
                  >
                    Limpar busca
                  </button>
                </div>
              )}
              {compradosAbertos && compradosVisiveis.map(item => (
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
                  onAbrirSetor={setItemSetor}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Bottom sheet de setor */}
      {itemSetor && (
        <BottomSheetSetor
          item={itemSetor}
          onClose={() => setItemSetor(null)}
          onEscolher={setor => definirSetor(itemSetor.id, setor)}
        />
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
          anterior={precoAnteriorDe(precosAnteriores, itemConfirmando.nome)}
          isOnline={isOnline}
          onClose={() => setItemConfirmando(null)}
          onConfirmar={handleConfirmarCompra}
        />
      )}

      {/* Bottom sheet de preço (para itens já comprados) */}
      {itemPreco && (
        <BottomSheetPreco
          item={itemPreco}
          anterior={precoAnteriorDe(precosAnteriores, itemPreco.nome)}
          isOnline={isOnline}
          onClose={() => setItemPreco(null)}
          onConfirmar={handleCorrigirPreco}
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

      {/* Toast de sucesso ao salvar histórico */}
      {successToast && (
        <div className="fixed bottom-24 left-4 right-4 z-[300] max-w-md mx-auto toast-enter">
          <div className="flex items-center gap-3 bg-emerald-600 text-white rounded-2xl px-4 py-3.5 shadow-float">
            <div className="w-7 h-7 rounded-xl bg-white/20 flex items-center justify-center flex-none">
              <Check className="w-4 h-4" strokeWidth={2.5} />
            </div>
            <p className="flex-1 text-sm font-semibold">Compra salva no histórico!</p>
            <button
              type="button"
              onClick={() => router.push('/lista-mercado/historico')}
              className="text-xs font-bold text-emerald-200 hover:text-white py-1 px-2.5 rounded-lg bg-white/15 hover:bg-white/25 transition-colors"
            >
              Ver
            </button>
          </div>
        </div>
      )}

      {/* Desfazer — fica logo acima da barra de subtotal, ao alcance do polegar */}
      {undo && !successToast && (
        <div
          key={undo.id}
          className="fixed left-3 right-3 z-[60] max-w-md mx-auto toast-enter"
          style={{ bottom: `calc(${totalItens > 0 ? '8.5rem' : '5rem'} + var(--safe-bottom))` }}
        >
          <div role="status" className="flex items-center gap-3 bg-gray-900 text-white rounded-2xl pl-4 pr-2 py-2 shadow-float">
            <p className="flex-1 min-w-0 text-sm font-medium truncate">{undo.mensagem}</p>
            <button
              type="button"
              onClick={desfazer}
              className="flex-none flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl bg-white/15
                         text-sm font-bold text-amber-300 active:bg-white/25 transition-colors"
            >
              <Undo2 className="w-4 h-4" strokeWidth={2.5} />
              Desfazer
            </button>
          </div>
        </div>
      )}

      {/* Barra de subtotal */}
      <SubtotalBar
        total={total}
        semPreco={semPreco}
        compradosCount={comprados.length}
        totalItens={totalItens}
        onFinalizar={() => setFinalizandoCompra(true)}
      />
    </div>
  )
}
