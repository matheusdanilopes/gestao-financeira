'use client'

import { useState, useEffect, useRef, Suspense, useCallback, type FormEvent, type ReactNode } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Heart, Plus, Check, ExternalLink, X, Star, Search, RotateCcw, Trash2 } from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import { SwipeableItem } from '@/components/SwipeableItem'
import { useWishlist, type WishlistItem } from '@/lib/useWishlist'
import { supabase } from '@/lib/supabaseClient'
import { formatBRL } from '@/lib/logger'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ── Constantes ────────────────────────────────────────────────────────────────

const PRIORIDADE = {
  alta:  { label: 'Alta',  bg: 'bg-red-50',    text: 'text-red-600',   dot: 'bg-red-400'   },
  media: { label: 'Média', bg: 'bg-amber-50',  text: 'text-amber-600', dot: 'bg-amber-400' },
  baixa: { label: 'Baixa', bg: 'bg-slate-100', text: 'text-slate-500', dot: 'bg-slate-400' },
} as const

type Prioridade = keyof typeof PRIORIDADE

const CATEGORIAS = ['Eletrônicos', 'Casa', 'Moda', 'Viagem', 'Lazer', 'Esporte', 'Saúde', 'Educação', 'Outros']

const EMOJIS = [
  '💻','📱','🎮','📷','🎧','📺','⌨️','🖥️','🎵','🎙️',
  '🏠','🛋️','🪴','🍳','🚿','🛁','🪟','🏡','🛏️','💡',
  '👗','👟','👜','💍','⌚','👒','👔','💄','👓','🧢',
  '✈️','🏖️','🗺️','🎒','🏕️','⛵','🚗','🏨','🌍','🧳',
  '🏋️','🚴','⚽','🏊','🧘','🎯','🏆','🎳','🥊','⛷️',
  '🎁','📚','🌟','💎','🍷','☕','🎂','🌸','🦋','✨',
]

const HINT_KEY = 'wishlist-swipe-hint'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatarData(iso: string) {
  try { return format(parseISO(iso), "dd MMM", { locale: ptBR }) } catch { return '' }
}

function nomeCurto(email: string | null): string {
  if (!email) return ''
  const parte = email.split('@')[0].split('.')[0].split('_')[0]
  return parte.charAt(0).toUpperCase() + parte.slice(1)
}

function corUsuario(email: string | null): string {
  if (!email) return 'bg-gray-100 text-gray-500'
  const e = email.toLowerCase()
  if (e.includes('matheus')) return 'bg-matheus-light text-matheus'
  if (e.includes('jeniffer') || e.includes('jennifer')) return 'bg-jeniffer-light text-jeniffer'
  return 'bg-gray-100 text-gray-500'
}

// Quando só um usuário é conhecido, infere o nome do parceiro pelo email atual
function inferirParceiro(emailAtual: string | null): string | null {
  if (!emailAtual) return null
  const e = emailAtual.toLowerCase()
  if (e.includes('matheus')) return 'Jeniffer'
  if (e.includes('jeniffer') || e.includes('jennifer')) return 'Matheus'
  return null
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({
  mensagem,
  icone,
  onDesfazer,
  onClose,
}: {
  mensagem: ReactNode
  icone: ReactNode
  onDesfazer: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed bottom-24 left-4 right-4 z-[300] max-w-md mx-auto toast-enter">
      <div className="flex items-center gap-3 bg-gray-900 text-white rounded-2xl px-4 py-3.5 shadow-float">
        <span className="flex-none">{icone}</span>
        <p className="flex-1 text-sm font-medium truncate">{mensagem}</p>
        <button
          type="button"
          onClick={onDesfazer}
          className="text-xs font-semibold text-primary-300 hover:text-primary-200 py-1 px-2 rounded-lg transition-colors"
        >
          Desfazer
        </button>
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
  )
}

// ── Emoji Picker ──────────────────────────────────────────────────────────────

function EmojiPicker({ selected, onSelect }: { selected: string; onSelect: (e: string) => void }) {
  return (
    <div className="grid grid-cols-10 gap-0.5 max-h-36 overflow-y-auto scrollbar-hide">
      {EMOJIS.map(e => (
        <button
          key={e}
          type="button"
          onClick={() => onSelect(e)}
          className={`text-xl p-1.5 rounded-lg transition-all active:scale-90
                      ${selected === e ? 'bg-primary-100 ring-2 ring-primary-400 scale-110' : 'hover:bg-gray-100'}`}
        >
          {e}
        </button>
      ))}
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────

type ModalForm = {
  nome: string
  emoji: string
  valor_estimado: string
  prioridade: Prioridade
  categoria: string
  nota: string
  link_ref: string
  criado_por: string | null
}

function ModalWishlist({
  item,
  criadorPadrao,
  usuariosConhecidos,
  onClose,
  onSalvar,
}: {
  item: WishlistItem | null
  criadorPadrao: string | null
  usuariosConhecidos: string[]
  onClose: () => void
  onSalvar: (form: ModalForm) => Promise<void>
}) {
  const nomeRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<ModalForm>({
    nome:           item?.nome           ?? '',
    emoji:          item?.emoji          ?? '',
    valor_estimado: item?.valor_estimado != null ? String(item.valor_estimado) : '',
    prioridade:     (item?.prioridade    ?? 'media') as Prioridade,
    categoria:      item?.categoria      ?? '',
    nota:           item?.nota           ?? '',
    link_ref:       item?.link_ref       ?? '',
    criado_por:     item?.criado_por     ?? criadorPadrao ?? null,
  })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [emojiAberto, setEmojiAberto] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => nomeRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [])

  function setField<K extends keyof ModalForm>(k: K, v: ModalForm[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.nome.trim()) return
    setErro('')
    setSalvando(true)
    try {
      await onSalvar(form)
    } catch (err) {
      const msg = err != null && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message) : 'Erro ao salvar'
      setErro(msg)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center modal-overlay"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={e => e.target === e.currentTarget && onClose()}
      >
        <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col modal-sheet sm:modal-center">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-none">
            <h2 className="text-base font-semibold text-gray-900">
              {item ? 'Editar desejo' : 'Novo desejo'}
            </h2>
            <button type="button" onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">
            <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">

              {/* Emoji + Nome */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  Nome <span className="text-red-400">*</span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEmojiAberto(v => !v)}
                    className={`flex-none w-11 h-11 rounded-xl border flex items-center justify-center text-xl
                                transition-colors ${emojiAberto ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'}`}
                    aria-label="Escolher emoji"
                  >
                    {form.emoji || '✨'}
                  </button>
                  <input
                    ref={nomeRef}
                    type="text"
                    value={form.nome}
                    onChange={e => setField('nome', e.target.value)}
                    placeholder="Ex: AirPods Pro"
                    required
                    className="flex-1 px-4 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-900
                               placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
                  />
                </div>
                {emojiAberto && (
                  <div className="mt-2 p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <EmojiPicker selected={form.emoji} onSelect={e => { setField('emoji', e); setEmojiAberto(false) }} />
                    {form.emoji && (
                      <button type="button" onClick={() => setField('emoji', '')}
                        className="mt-2 text-xs text-gray-400 hover:text-red-500 w-full text-center transition-colors">
                        Remover emoji
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Categoria */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Categoria</label>
                <div className="relative">
                  <select
                    value={form.categoria}
                    onChange={e => setField('categoria', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-900
                               bg-white focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent
                               appearance-none pr-10"
                  >
                    <option value="">Sem categoria</option>
                    {CATEGORIAS.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    ▾
                  </span>
                </div>
              </div>

              {/* Valor estimado */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Valor estimado</label>
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
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Prioridade</label>
                <div className="flex gap-2">
                  {(Object.keys(PRIORIDADE) as Prioridade[]).map(p => {
                    const cfg = PRIORIDADE[p]
                    const ativo = form.prioridade === p
                    return (
                      <button key={p} type="button" onClick={() => setField('prioridade', p)}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all duration-150
                                    ${ativo ? `${cfg.bg} ${cfg.text} border-current` : 'bg-gray-50 text-gray-400 border-transparent hover:bg-gray-100'}`}>
                        {cfg.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Nota */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Nota</label>
                <textarea
                  value={form.nota}
                  onChange={e => setField('nota', e.target.value)}
                  placeholder="Observações, contexto, qual modelo…"
                  rows={2}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 resize-none
                             placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
                />
              </div>

              {/* Link */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Link de referência</label>
                <input
                  type="text"
                  value={form.link_ref}
                  onChange={e => setField('link_ref', e.target.value)}
                  placeholder="https://..."
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-900
                             placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
                />
              </div>

              {/* Criador */}
              {usuariosConhecidos.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Adicionado por</label>
                  <div className="flex gap-2">
                    {usuariosConhecidos.map(email => {
                      const isAtivo = form.criado_por === email
                      const cor = corUsuario(email)
                      return (
                        <button
                          key={email}
                          type="button"
                          onClick={() => setField('criado_por', email)}
                          className={`flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all
                                      ${isAtivo
                                        ? `${cor} ring-2 ring-inset ring-current`
                                        : 'bg-gray-50 text-gray-600'}`}
                        >
                          <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-none
                                           ${isAtivo ? 'bg-white/40' : cor}`}>
                            {isAtivo
                              ? <Check className="w-4 h-4" strokeWidth={3} />
                              : nomeCurto(email)[0]
                            }
                          </span>
                          <span className="text-sm font-semibold truncate">{nomeCurto(email)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {erro && (
                <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2 font-medium">{erro}</p>
              )}

              {/* Ações */}
              <div className="flex gap-3 pt-1 pb-safe">
                <button type="button" onClick={onClose}
                  className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={!form.nome.trim() || salvando}
                  className="flex-1 py-3 rounded-xl bg-primary-600 text-white text-sm font-semibold disabled:opacity-50 hover:bg-primary-700 transition-colors">
                  {salvando ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}

// ── Card de desejo ────────────────────────────────────────────────────────────

function WishlistCard({
  item,
  mostraHint,
  onEditar,
  onRealizar,
  onExcluir,
  onFavoritar,
}: {
  item: WishlistItem
  mostraHint: boolean
  onEditar: (item: WishlistItem) => void
  onRealizar: (id: string) => unknown
  onExcluir: (id: string) => unknown
  onFavoritar: (id: string) => unknown
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
        {/* Emoji + nome + favorito */}
        <div className="flex items-start gap-2.5 mb-2.5">
          {item.emoji && (
            <span className="text-2xl flex-none leading-tight mt-0.5" aria-hidden="true">{item.emoji}</span>
          )}
          <p className="flex-1 text-sm font-semibold text-gray-900 leading-snug min-w-0 line-clamp-2">
            {item.nome}
          </p>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onFavoritar(item.id) }}
            className="flex-none w-10 h-10 -mt-1 -mr-1 flex items-center justify-center rounded-xl
                       hover:bg-amber-50 transition-colors active:scale-90"
            aria-label={item.favoritado ? 'Remover favorito' : 'Favoritar'}
          >
            <Star
              className={`w-5 h-5 transition-colors ${item.favoritado ? 'text-amber-400' : 'text-gray-300'}`}
              fill={item.favoritado ? 'currentColor' : 'none'}
              strokeWidth={1.8}
            />
          </button>
        </div>

        {/* Badges: prioridade + categoria */}
        <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cfg.bg} ${cfg.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full flex-none ${cfg.dot}`} />
            {cfg.label}
          </span>
          {item.categoria && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">
              {item.categoria}
            </span>
          )}
        </div>

        {/* Nota preview */}
        {item.nota && (
          <p className="text-xs text-gray-500 mb-2.5 line-clamp-1 italic">
            &ldquo;{item.nota}&rdquo;
          </p>
        )}

        {/* Rodapé: valor + link + autor + realizar */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {item.valor_estimado != null && (
              <span className="text-xs font-semibold text-gray-700 tabular-nums">
                {formatBRL(item.valor_estimado)}
              </span>
            )}
            {item.link_ref && (
              <a
                href={item.link_ref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-1 text-[11px] text-primary-600 hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                Ver
              </a>
            )}
          </div>
          <div className="flex items-center gap-2 flex-none">
            {item.criado_por && (
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-none ${corUsuario(item.criado_por)}`}
                title={nomeCurto(item.criado_por)}>
                {nomeCurto(item.criado_por)[0]}
              </span>
            )}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onRealizar(item.id) }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-green-50 text-green-600
                         text-xs font-semibold hover:bg-green-100 transition-colors active:scale-95"
              aria-label="Marcar como realizado"
            >
              <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
              Realizar
            </button>
          </div>
        </div>

        {/* Swipe hint — aparece uma vez no primeiro card */}
        {mostraHint && (
          <div className="mt-2.5 pt-2 border-t border-gray-50 flex items-center justify-end">
            <span className="text-[10px] text-gray-300 italic">← deslize para excluir</span>
          </div>
        )}
      </button>
    </SwipeableItem>
  )
}

// ── Card realizado ────────────────────────────────────────────────────────────

function CardRealizado({
  item,
  onExcluir,
  onRestaurar,
}: {
  item: WishlistItem
  onExcluir: (id: string) => unknown
  onRestaurar: (id: string) => unknown
}) {
  return (
    <SwipeableItem onDelete={() => onExcluir(item.id)}>
      <div className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        {/* Nome + restaurar */}
        <div className="flex items-start gap-2.5 mb-2">
          {item.emoji && (
            <span className="text-xl flex-none opacity-40" aria-hidden="true">{item.emoji}</span>
          )}
          <p className="flex-1 text-sm font-medium text-gray-400 line-through leading-snug min-w-0 line-clamp-2">
            {item.nome}
          </p>
          <button
            type="button"
            onClick={() => onRestaurar(item.id)}
            className="flex-none flex items-center gap-1 text-[11px] text-gray-400 hover:text-primary-600
                       font-medium transition-colors px-2 py-0.5 rounded-full hover:bg-primary-50 active:scale-95"
            aria-label="Restaurar desejo"
          >
            <RotateCcw className="w-3 h-3" />
            Restaurar
          </button>
        </div>

        {/* Metadados */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10px] text-green-600">
            <Check className="w-3 h-3" strokeWidth={2.5} />
            {item.realizado_em ? formatarData(item.realizado_em) : 'Realizado'}
          </span>
          {item.criado_por && (
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-none ${corUsuario(item.criado_por)}`}
              title={nomeCurto(item.criado_por)}>
              {nomeCurto(item.criado_por)[0]}
            </span>
          )}
          {item.valor_estimado != null && (
            <span className="text-[10px] text-gray-400 tabular-nums">
              · {formatBRL(item.valor_estimado)}
            </span>
          )}
        </div>
      </div>
    </SwipeableItem>
  )
}

// ── Conteúdo principal ────────────────────────────────────────────────────────

function WishlistContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    ativos, historico,
    adicionar, editar, marcarRealizado, desfazerRealizado, toggleFavorito, excluir,
  } = useWishlist()

  type ToastAtivo =
    | { kind: 'realizou'; id: string; nome: string }
    | { kind: 'excluiu';  id: string; nome: string }

  const [usuarioAtual, setUsuarioAtual] = useState<string | null>(null)
  const [extraUsuarios, setExtraUsuarios] = useState<string[]>([])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUsuarioAtual(user?.email ?? null))
  }, [])

  // Busca criadores conhecidos de lista_mercado_itens (parceiro pode nunca ter adicionado wishlist)
  useEffect(() => {
    if (usuarioAtual === null) return
    supabase
      .from('lista_mercado_itens')
      .select('criado_por')
      .not('criado_por', 'is', null)
      .then(({ data }) => {
        const emails = (data ?? [])
          .map((r: { criado_por: string | null }) => r.criado_por)
          .filter((e): e is string => e !== null)
        setExtraUsuarios(emails)
      })
  }, [usuarioAtual])

  const [aba, setAba] = useState<'ativos' | 'historico'>('ativos')
  const [modalAberto, setModalAberto] = useState(searchParams.get('add') === 'true')
  const [itemEditando, setItemEditando] = useState<WishlistItem | null>(null)
  const [buscaAberta, setBuscaAberta] = useState(false)
  const [busca, setBusca] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState<string | null>(null)
  const [filtroUsuario, setFiltroUsuario] = useState<string | null>(null)
  const [activeToast, setActiveToast] = useState<ToastAtivo | null>(null)
  const [pendingExcluirId, setPendingExcluirId] = useState<string | null>(null)
  const [hintVisto, setHintVisto] = useState(true)
  const toastTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingExcluirRef = useRef<string | null>(null)

  function clearToastTimer() {
    if (toastTimerRef.current) { clearTimeout(toastTimerRef.current); toastTimerRef.current = null }
  }

  function commitPendingExcluir() {
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
    if (!hintVisto && ativos.length > 0) {
      const t = setTimeout(() => {
        localStorage.setItem(HINT_KEY, '1')
        setHintVisto(true)
      }, 5000)
      return () => clearTimeout(t)
    }
  }, [hintVisto, ativos.length])

  useEffect(() => {
    if (searchParams.get('add') === 'true') router.replace('/wishlist')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // FAB do BottomNav abre o modal diretamente
  useEffect(() => {
    function handler() { setItemEditando(null); setModalAberto(true) }
    window.addEventListener('wishlist:open-add', handler)
    return () => window.removeEventListener('wishlist:open-add', handler)
  }, [])

  const categoriasUsadas = [...new Set(ativos.map(i => i.categoria).filter(Boolean) as string[])]
  const totalAtivos = ativos.reduce((s, i) => s + (i.valor_estimado ?? 0), 0)

  const usuariosConhecidos = (() => {
    const base = [...new Set([
      ...(usuarioAtual ? [usuarioAtual] : []),
      ...[...ativos, ...historico].map(i => i.criado_por).filter(Boolean) as string[],
      ...extraUsuarios,
    ])]
    // Se só um usuário é conhecido, adiciona o parceiro inferido pelo nome do email
    if (base.length < 2) {
      const parceiro = inferirParceiro(usuarioAtual)
      if (parceiro) base.push(parceiro)
    }
    return base
  })()

  const ativosFiltrados = ativos
    .filter(i => i.id !== pendingExcluirId)
    .filter(item => {
      if (filtroUsuario && item.criado_por !== filtroUsuario) return false
      if (filtroCategoria && item.categoria !== filtroCategoria) return false
      if (busca && !item.nome.toLowerCase().includes(busca.toLowerCase())) return false
      return true
    })

  const historicoDis = historico
    .filter(i => i.id !== pendingExcluirId)
    .filter(i => !filtroUsuario || i.criado_por === filtroUsuario)

  // Per-user stats: baseia nos usuários conhecidos para sempre mostrar ambos os cards,
  // mesmo que um deles ainda não tenha itens na aba atual
  function calcStats(lista: WishlistItem[], usuarios: string[]) {
    return usuarios.map(email => ({
      email,
      nome: nomeCurto(email),
      count: lista.filter(i => i.criado_por === email).length,
      total: lista.filter(i => i.criado_por === email).reduce((s, i) => s + (i.valor_estimado ?? 0), 0),
    }))
  }

  const ativosBase = ativos.filter(i => i.id !== pendingExcluirId)
  const historicoBase = historico.filter(i => i.id !== pendingExcluirId)
  const statsAtuais = calcStats(
    aba === 'ativos' ? ativosBase : historicoBase,
    usuariosConhecidos,
  )

  function abrirEditar(item: WishlistItem) {
    setItemEditando(item)
    setModalAberto(true)
  }

  function fecharModal() {
    setModalAberto(false)
    setItemEditando(null)
  }

  async function handleSalvar(form: ModalForm) {
    const campos = {
      nome:           form.nome.trim(),
      emoji:          form.emoji    || null,
      valor_estimado: form.valor_estimado ? parseFloat(form.valor_estimado) : null,
      prioridade:     form.prioridade,
      categoria:      form.categoria || null,
      nota:           form.nota.trim() || null,
      link_ref:       form.link_ref.trim() || null,
      criado_por:     form.criado_por,
    }
    if (itemEditando) await editar(itemEditando.id, campos)
    else await adicionar(campos)
    fecharModal()
  }

  async function handleRealizar(id: string) {
    commitPendingExcluir()
    clearToastTimer()
    const item = ativos.find(i => i.id === id)
    await marcarRealizado(id)
    if (item) {
      setActiveToast({ kind: 'realizou', id, nome: item.nome })
      toastTimerRef.current = setTimeout(() => setActiveToast(null), 4000)
    }
  }

  function handleExcluir(id: string) {
    commitPendingExcluir()
    clearToastTimer()
    const item = [...ativos, ...historico].find(i => i.id === id)
    if (!item) { excluir(id); return }
    pendingExcluirRef.current = id
    setPendingExcluirId(id)
    setActiveToast({ kind: 'excluiu', id, nome: item.nome })
    toastTimerRef.current = setTimeout(() => {
      commitPendingExcluir()
      setActiveToast(null)
    }, 4000)
  }

  const handleDesfazer = useCallback(async () => {
    clearToastTimer()
    if (!activeToast) return
    if (activeToast.kind === 'realizou') {
      setActiveToast(null)
      await desfazerRealizado(activeToast.id)
    } else {
      pendingExcluirRef.current = null
      setPendingExcluirId(null)
      setActiveToast(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeToast, desfazerRealizado])

  function handleFecharToast() {
    clearToastTimer()
    commitPendingExcluir()
    setActiveToast(null)
  }

  const handleFavoritar = useCallback((id: string) => {
    toggleFavorito(id, ativos)
  }, [toggleFavorito, ativos])

  return (
    <div className="min-h-screen pb-32 page-enter">
      {/* Header */}
      <div className="sticky top-0 z-10 sticky-header border-b border-gray-100 px-4 pb-3">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-2xl bg-pink-50 flex items-center justify-center flex-none">
            <Heart className="w-5 h-5 text-pink-500" strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-900 leading-none">Wishlist Familiar</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {ativos.length} {ativos.length === 1 ? 'desejo' : 'desejos'}
              {totalAtivos > 0 && (
                <span className="text-gray-500 font-medium"> · {formatBRL(totalAtivos)}</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setBuscaAberta(v => !v); if (buscaAberta) setBusca('') }}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors
                        ${buscaAberta ? 'bg-primary-100 text-primary-600' : 'text-gray-400 hover:bg-gray-100'}`}
            aria-label="Buscar"
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => { setItemEditando(null); setModalAberto(true) }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary-600 text-white text-xs font-semibold
                       hover:bg-primary-700 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            Novo
          </button>
        </div>

        {/* Busca */}
        {buscaAberta && (
          <div className="mb-3">
            <input
              autoFocus
              type="text"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar desejo…"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-900
                         placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
            />
          </div>
        )}

        {/* Filtros de categoria */}
        {categoriasUsadas.length > 0 && aba === 'ativos' && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-4 px-4 mb-3">
            <button
              type="button"
              onClick={() => setFiltroCategoria(null)}
              className={`flex-none px-3 py-1.5 rounded-full text-xs font-semibold border transition-all whitespace-nowrap
                          ${filtroCategoria === null
                            ? 'bg-gray-900 text-white border-gray-900'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
            >
              Todas
            </button>
            {categoriasUsadas.map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setFiltroCategoria(filtroCategoria === cat ? null : cat)}
                className={`flex-none px-3 py-1.5 rounded-full text-xs font-semibold border transition-all whitespace-nowrap
                            ${filtroCategoria === cat
                              ? 'bg-primary-600 text-white border-primary-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
          {(['ativos', 'historico'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => { setAba(tab); setFiltroUsuario(null) }}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all duration-150
                          ${aba === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {tab === 'ativos'
                ? `Desejos${ativos.length > 0 ? ` (${ativos.length})` : ''}`
                : `Realizados${historico.length > 0 ? ` (${historico.length})` : ''}`}
            </button>
          ))}
        </div>

        {/* Cards de usuário */}
        {usuariosConhecidos.length > 1 && (
          <div className="flex gap-2 mt-2.5">
            {statsAtuais.map(stat => {
              const isActive = filtroUsuario === stat.email
              const cor = corUsuario(stat.email)
              return (
                <button
                  key={stat.email}
                  type="button"
                  onClick={() => setFiltroUsuario(isActive ? null : stat.email)}
                  className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border transition-all text-left
                              ${isActive
                                ? `${cor} border-current`
                                : 'bg-gray-50 border-transparent hover:bg-gray-100 text-gray-700'}`}
                >
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-none ${cor}`}>
                    {stat.nome[0]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold leading-none truncate mb-0.5">{stat.nome}</p>
                    <p className={`text-[10px] leading-none ${isActive ? 'opacity-70' : 'text-gray-400'}`}>
                      {stat.count} {stat.count === 1 ? 'item' : 'itens'}
                      {stat.total > 0 && <> · {formatBRL(stat.total)}</>}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-4 pt-4">
        {(aba === 'ativos' ? ativosFiltrados : historicoDis).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-pink-50 flex items-center justify-center mb-4">
              <Heart className="w-8 h-8 text-pink-300" strokeWidth={1.5} />
            </div>
            <p className="text-sm font-semibold text-gray-700 mb-1">
              {aba === 'ativos'
                ? (busca || filtroCategoria || filtroUsuario ? 'Nenhum resultado' : 'Nenhum desejo ainda')
                : 'Nenhum desejo realizado'}
            </p>
            <p className="text-xs text-gray-400 max-w-[200px]">
              {aba === 'ativos'
                ? (busca || filtroCategoria || filtroUsuario
                    ? 'Tente outros termos ou filtros'
                    : 'Adicione coisas que vocês querem no futuro')
                : 'Seus desejos realizados aparecem aqui'}
            </p>
            {aba === 'ativos' && !busca && !filtroCategoria && !filtroUsuario && (
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
              ? ativosFiltrados.map((item, idx) => (
                  <WishlistCard
                    key={item.id}
                    item={item}
                    mostraHint={idx === 0 && !hintVisto}
                    onEditar={abrirEditar}
                    onRealizar={handleRealizar}
                    onExcluir={handleExcluir}
                    onFavoritar={handleFavoritar}
                  />
                ))
              : historicoDis.map(item => (
                  <CardRealizado
                    key={item.id}
                    item={item}
                    onExcluir={handleExcluir}
                    onRestaurar={desfazerRealizado}
                  />
                ))
            }
          </div>
        )}
      </div>

      {/* Modal */}
      {modalAberto && (
        <ModalWishlist
          item={itemEditando}
          criadorPadrao={usuarioAtual}
          usuariosConhecidos={usuariosConhecidos}
          onClose={fecharModal}
          onSalvar={handleSalvar}
        />
      )}

      {/* Toast unificado (realizou / excluiu) */}
      {activeToast && (
        <Toast
          mensagem={
            activeToast.kind === 'realizou'
              ? <><span className="text-gray-300">&ldquo;{activeToast.nome}&rdquo;</span> realizado!</>
              : <><span className="text-gray-300">&ldquo;{activeToast.nome}&rdquo;</span> removido</>
          }
          icone={
            activeToast.kind === 'realizou'
              ? <Check className="w-4 h-4 text-green-400" strokeWidth={2.5} />
              : <Trash2 className="w-4 h-4 text-red-400" strokeWidth={2} />
          }
          onDesfazer={handleDesfazer}
          onClose={handleFecharToast}
        />
      )}
    </div>
  )
}

export default function WishlistPage() {
  return (
    <Suspense>
      <WishlistContent />
    </Suspense>
  )
}
