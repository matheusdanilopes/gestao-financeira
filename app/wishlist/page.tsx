'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Heart, Plus, Check, Trash2, ExternalLink, X, ArrowLeft } from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import { SwipeableItem } from '@/components/SwipeableItem'
import { useWishlist, type WishlistItem } from '@/lib/useWishlist'
import { formatBRL } from '@/lib/logger'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ── Constantes ─────────────────────────────────────────────────────────────

const PRIORIDADE = {
  alta:  { label: 'Alta',  bg: 'bg-red-50',    text: 'text-red-600',    dot: 'bg-red-400'    },
  media: { label: 'Média', bg: 'bg-amber-50',  text: 'text-amber-600',  dot: 'bg-amber-400'  },
  baixa: { label: 'Baixa', bg: 'bg-green-50',  text: 'text-green-600',  dot: 'bg-green-400'  },
} as const

type Prioridade = keyof typeof PRIORIDADE

function formatarData(iso: string) {
  try { return format(parseISO(iso), "dd 'de' MMM", { locale: ptBR }) } catch { return '' }
}

// ── Modal de criação / edição ─────────────────────────────────────────────

type ModalForm = {
  nome: string
  valor_estimado: string
  prioridade: Prioridade
  link_ref: string
}

function ModalWishlist({
  item,
  onClose,
  onSalvar,
}: {
  item: WishlistItem | null
  onClose: () => void
  onSalvar: (form: ModalForm) => Promise<void>
}) {
  const nomeRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<ModalForm>({
    nome:           item?.nome           ?? '',
    valor_estimado: item?.valor_estimado != null ? String(item.valor_estimado) : '',
    prioridade:     (item?.prioridade    ?? 'media') as Prioridade,
    link_ref:       item?.link_ref       ?? '',
  })
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => nomeRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [])

  function setField<K extends keyof ModalForm>(k: K, v: ModalForm[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nome.trim()) return
    setSalvando(true)
    try { await onSalvar(form) } finally { setSalvando(false) }
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center modal-overlay"
        style={{ background: 'rgba(0,0,0,0.45)' }}
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-900">
              {item ? 'Editar desejo' : 'Novo desejo'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
            {/* Nome */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Nome <span className="text-red-400">*</span>
              </label>
              <input
                ref={nomeRef}
                type="text"
                value={form.nome}
                onChange={e => setField('nome', e.target.value)}
                placeholder="Ex: AirPods Pro"
                required
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-900
                           placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              />
            </div>

            {/* Valor estimado */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Valor estimado
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">R$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.valor_estimado}
                  onChange={e => setField('valor_estimado', e.target.value)}
                  placeholder="0,00"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-900
                             placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
                />
              </div>
            </div>

            {/* Prioridade */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Prioridade
              </label>
              <div className="flex gap-2">
                {(Object.keys(PRIORIDADE) as Prioridade[]).map(p => {
                  const cfg = PRIORIDADE[p]
                  const ativo = form.prioridade === p
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setField('prioridade', p)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all duration-150
                                  ${ativo
                                    ? `${cfg.bg} ${cfg.text} border-current`
                                    : 'bg-gray-50 text-gray-400 border-transparent hover:bg-gray-100'
                                  }`}
                    >
                      {cfg.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Link de referência */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Link de referência
              </label>
              <input
                type="url"
                value={form.link_ref}
                onChange={e => setField('link_ref', e.target.value)}
                placeholder="https://..."
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-900
                           placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              />
            </div>

            {/* Ações */}
            <div className="flex gap-3 pt-1 pb-safe">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600
                           hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!form.nome.trim() || salvando}
                className="flex-1 py-3 rounded-xl bg-primary-600 text-white text-sm font-semibold
                           disabled:opacity-50 hover:bg-primary-700 transition-colors"
              >
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  )
}

// ── Card de desejo ────────────────────────────────────────────────────────

function WishlistCard({
  item,
  onEditar,
  onRealizar,
  onExcluir,
}: {
  item: WishlistItem
  onEditar: (item: WishlistItem) => void
  onRealizar: (id: string) => void
  onExcluir: (id: string) => void
}) {
  const cfg = PRIORIDADE[item.prioridade]

  return (
    <SwipeableItem onDelete={() => onExcluir(item.id)}>
      <button
        type="button"
        onClick={() => onEditar(item)}
        className="w-full text-left bg-white rounded-2xl p-4 shadow-sm border border-gray-100
                   active:bg-gray-50 transition-colors duration-150 focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-primary-400"
      >
        {/* Topo: prioridade + realizar */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${cfg.bg} ${cfg.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            {cfg.label}
          </span>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onRealizar(item.id) }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-50 text-green-600
                       text-[11px] font-semibold hover:bg-green-100 transition-colors active:scale-95"
            aria-label="Marcar como realizado"
          >
            <Check className="w-3 h-3" strokeWidth={2.5} />
            Realizar
          </button>
        </div>

        {/* Nome */}
        <p className="text-sm font-semibold text-gray-900 leading-snug mb-2 line-clamp-2">
          {item.nome}
        </p>

        {/* Rodapé: valor + link */}
        <div className="flex items-center gap-3">
          {item.valor_estimado != null && (
            <span className="text-xs font-medium text-gray-500">
              {formatBRL(item.valor_estimado)}
            </span>
          )}
          {item.link_ref && (
            <a
              href={item.link_ref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 text-xs text-primary-600 hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              Ver
            </a>
          )}
          {!item.valor_estimado && !item.link_ref && (
            <span className="text-xs text-gray-300">Toque para editar</span>
          )}
        </div>
      </button>
    </SwipeableItem>
  )
}

// ── Card de item realizado ────────────────────────────────────────────────

function CardRealizado({ item, onExcluir }: { item: WishlistItem; onExcluir: (id: string) => void }) {
  return (
    <SwipeableItem onDelete={() => onExcluir(item.id)}>
      <div className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 opacity-70">
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-green-50 text-green-600">
            <Check className="w-3 h-3" strokeWidth={2.5} />
            Realizado
          </span>
          {item.realizado_em && (
            <span className="text-[11px] text-gray-400">{formatarData(item.realizado_em)}</span>
          )}
        </div>
        <p className="text-sm font-medium text-gray-500 line-through leading-snug">{item.nome}</p>
        {item.valor_estimado != null && (
          <p className="text-xs text-gray-400 mt-1">{formatBRL(item.valor_estimado)}</p>
        )}
      </div>
    </SwipeableItem>
  )
}

// ── Conteúdo principal (com useSearchParams) ──────────────────────────────

function WishlistContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { ativos, historico, adicionar, editar, marcarRealizado, excluir } = useWishlist()

  const [aba, setAba] = useState<'ativos' | 'historico'>('ativos')
  const [modalAberto, setModalAberto] = useState(searchParams.get('add') === 'true')
  const [itemEditando, setItemEditando] = useState<WishlistItem | null>(null)

  // Limpa o ?add=true da URL após abrir
  useEffect(() => {
    if (searchParams.get('add') === 'true') {
      router.replace('/wishlist')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function abrirEditar(item: WishlistItem) {
    setItemEditando(item)
    setModalAberto(true)
  }

  function fecharModal() {
    setModalAberto(false)
    setItemEditando(null)
  }

  async function handleSalvar(form: { nome: string; valor_estimado: string; prioridade: Prioridade; link_ref: string }) {
    const campos = {
      nome:           form.nome.trim(),
      valor_estimado: form.valor_estimado ? parseFloat(form.valor_estimado) : null,
      prioridade:     form.prioridade,
      link_ref:       form.link_ref.trim() || null,
    }

    if (itemEditando) {
      await editar(itemEditando.id, campos)
    } else {
      await adicionar(campos)
    }
    fecharModal()
  }

  const itensExibidos = aba === 'ativos' ? ativos : historico

  return (
    <div className="min-h-screen pb-32">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-pink-50 flex items-center justify-center">
            <Heart className="w-5 h-5 text-pink-500" strokeWidth={1.8} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 leading-none">Wishlist Familiar</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {ativos.length} {ativos.length === 1 ? 'desejo ativo' : 'desejos ativos'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setItemEditando(null); setModalAberto(true) }}
            className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary-600 text-white text-xs font-semibold
                       hover:bg-primary-700 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            Novo
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
          {(['ativos', 'historico'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setAba(tab)}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all duration-150
                          ${aba === tab
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                          }`}
            >
              {tab === 'ativos'
                ? `Desejos${ativos.length > 0 ? ` (${ativos.length})` : ''}`
                : `Realizados${historico.length > 0 ? ` (${historico.length})` : ''}`
              }
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pt-4">
        {itensExibidos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-pink-50 flex items-center justify-center mb-4">
              <Heart className="w-8 h-8 text-pink-300" strokeWidth={1.5} />
            </div>
            <p className="text-sm font-semibold text-gray-700 mb-1">
              {aba === 'ativos' ? 'Nenhum desejo ainda' : 'Nenhum desejo realizado'}
            </p>
            <p className="text-xs text-gray-400 max-w-[200px]">
              {aba === 'ativos'
                ? 'Adicione coisas que você quer no futuro'
                : 'Seus desejos realizados aparecem aqui'
              }
            </p>
            {aba === 'ativos' && (
              <button
                type="button"
                onClick={() => { setItemEditando(null); setModalAberto(true) }}
                className="mt-5 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold
                           hover:bg-primary-700 transition-colors"
              >
                <Plus className="w-4 h-4" strokeWidth={2.5} />
                Adicionar desejo
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {aba === 'ativos'
              ? ativos.map(item => (
                  <WishlistCard
                    key={item.id}
                    item={item}
                    onEditar={abrirEditar}
                    onRealizar={marcarRealizado}
                    onExcluir={excluir}
                  />
                ))
              : historico.map(item => (
                  <CardRealizado key={item.id} item={item} onExcluir={excluir} />
                ))
            }
          </div>
        )}
      </div>

      {/* Modal */}
      {modalAberto && (
        <ModalWishlist
          item={itemEditando}
          onClose={fecharModal}
          onSalvar={handleSalvar}
        />
      )}
    </div>
  )
}

// ── Página exportada ──────────────────────────────────────────────────────

export default function WishlistPage() {
  return (
    <Suspense>
      <WishlistContent />
    </Suspense>
  )
}
