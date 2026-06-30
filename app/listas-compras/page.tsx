'use client'

import { useState, useRef, useEffect, type FormEvent } from 'react'
import Link from 'next/link'
import {
  Crown, Plus, Archive, ArchiveRestore, Trash2,
  MoreHorizontal, Check, Pencil, ShoppingBag,
} from 'lucide-react'
import ModalPortal from '@/components/ModalPortal'
import { SwipeableItem } from '@/components/SwipeableItem'
import { useListasCompras, type ListaComMeta } from '@/lib/useListasCompras'
import { formatBRL } from '@/lib/logger'

// ── Helpers ───────────────────────────────────────────────────────────────────

function nomeCurto(email: string | null): string {
  if (!email) return ''
  const parte = email.split('@')[0].split('.')[0].split('_')[0]
  return parte.charAt(0).toUpperCase() + parte.slice(1)
}

// ── Input Nova Lista ──────────────────────────────────────────────────────────

function InputNovaLista({ onCriar }: { onCriar: (nome: string) => Promise<unknown> }) {
  const [valor, setValor] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nome = valor.trim()
    if (!nome || loading) return
    setLoading(true)
    try {
      await onCriar(nome)
      setValor('')
    } catch { /* noop */ } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        value={valor}
        onChange={e => setValor(e.target.value)}
        placeholder="Nome da nova lista…"
        className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5
                   placeholder-gray-400 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-400
                   focus:border-transparent transition-all"
        maxLength={80}
      />
      <button
        type="submit"
        disabled={!valor.trim() || loading}
        className="flex items-center gap-1.5 bg-primary-600 text-white text-sm font-semibold
                   px-3.5 py-2.5 rounded-xl disabled:opacity-40 active:scale-95 transition-all"
        aria-label="Criar lista"
      >
        <Plus className="w-4 h-4" strokeWidth={2.5} />
        <span>Criar</span>
      </button>
    </form>
  )
}

// ── Bottom Sheet Ações da Lista ───────────────────────────────────────────────

function BottomSheetAcoes({
  lista,
  onClose,
  onRenomear,
  onArquivar,
  onDesarquivar,
  onExcluir,
}: {
  lista: ListaComMeta
  onClose: () => void
  onRenomear: (id: string, nome: string) => Promise<void>
  onArquivar: (id: string) => Promise<void>
  onDesarquivar: (id: string) => Promise<void>
  onExcluir: (id: string) => Promise<void>
}) {
  const [renomeando, setRenomeando] = useState(false)
  const [nomeLocal, setNomeLocal] = useState(lista.nome)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renomeando) setTimeout(() => inputRef.current?.focus(), 50)
  }, [renomeando])

  async function confirmarRenomear() {
    const nome = nomeLocal.trim()
    if (!nome || nome === lista.nome) { setRenomeando(false); return }
    await onRenomear(lista.id, nome)
    onClose()
  }

  async function handleArquivar() {
    lista.status === 'ativa' ? await onArquivar(lista.id) : await onDesarquivar(lista.id)
    onClose()
  }

  async function handleExcluir() {
    await onExcluir(lista.id)
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
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1">Lista</p>
          <p className="text-base font-bold text-gray-900 mb-5 truncate">{lista.nome}</p>

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
                className="w-full text-sm border border-primary-400 rounded-xl px-3.5 py-2.5
                           focus:outline-none focus:ring-2 focus:ring-primary-400"
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
                  className="flex-1 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold"
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
                onClick={handleArquivar}
                className="flex items-center gap-3 w-full px-4 py-3.5 rounded-2xl hover:bg-gray-50
                           text-gray-700 text-sm font-semibold transition-colors active:bg-gray-100"
              >
                <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center">
                  {lista.status === 'ativa'
                    ? <Archive className="w-4 h-4 text-amber-600" strokeWidth={1.8} />
                    : <ArchiveRestore className="w-4 h-4 text-amber-600" strokeWidth={1.8} />
                  }
                </div>
                {lista.status === 'ativa' ? 'Arquivar' : 'Desarquivar'}
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
                Excluir lista
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}

// ── Card de Lista ─────────────────────────────────────────────────────────────

function ListaCard({
  lista,
  onAcoes,
}: {
  lista: ListaComMeta
  onAcoes: (lista: ListaComMeta) => void
}) {
  const temPrevisto = lista.totalPrevisto > 0
  const temPago = lista.totalPago > 0

  return (
    <SwipeableItem onDelete={() => onAcoes(lista)} requireConfirmation={false} disabled={false}>
      <div className="relative bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <Link href={`/listas-compras/${lista.id}`} className="block p-4 pr-12">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-none
                            ${lista.status === 'arquivada' ? 'bg-gray-100' : 'bg-amber-50'}`}>
              {lista.status === 'arquivada'
                ? <Archive className="w-5 h-5 text-gray-400" strokeWidth={1.8} />
                : <ShoppingBag className="w-5 h-5 text-amber-600" strokeWidth={1.8} />
              }
            </div>
            <div className="flex-1 min-w-0">
              <h3 className={`text-sm font-bold truncate ${lista.status === 'arquivada' ? 'text-gray-400' : 'text-gray-900'}`}>
                {lista.nome}
              </h3>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {lista.totalSublistas > 0 ? (
                  <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                    {lista.totalSublistas} {lista.totalSublistas === 1 ? 'sublista' : 'sublistas'}
                  </span>
                ) : lista.totalItens === 0 ? (
                  <span className="text-[11px] text-gray-400">Vazia</span>
                ) : lista.totalPendentes > 0 ? (
                  <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                    {lista.totalPendentes} {lista.totalPendentes === 1 ? 'pendente' : 'pendentes'}
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                    <Check className="w-2.5 h-2.5" strokeWidth={3} />
                    Concluída
                  </span>
                )}
              </div>
              {(temPrevisto || temPago) && (
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  {temPrevisto && (
                    <span className="text-[11px] text-gray-400">
                      Prev: <span className="font-semibold text-gray-600 num">{formatBRL(lista.totalPrevisto)}</span>
                    </span>
                  )}
                  {temPago && (
                    <span className="text-[11px] text-gray-400">
                      Pago: <span className="font-semibold text-green-600 num">{formatBRL(lista.totalPago)}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </Link>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onAcoes(lista) }}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl
                     flex items-center justify-center text-gray-400 hover:bg-gray-100
                     transition-colors active:scale-90"
          aria-label="Ações da lista"
        >
          <MoreHorizontal className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>
    </SwipeableItem>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function ListasComprasPage() {
  const { ativas, arquivadas, criarLista, renomearLista, arquivarLista, desarquivarLista, excluirLista } = useListasCompras()
  const [aba, setAba] = useState<'pendentes' | 'concluidas'>('pendentes')
  const [listaAcoes, setListaAcoes] = useState<ListaComMeta | null>(null)

  return (
    <div className="min-h-screen pb-40 page-enter">
      {/* Header sticky */}
      <div className="sticky top-0 z-10 sticky-header border-b border-gray-100 px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center flex-none">
            <Crown className="w-5 h-5 text-amber-600" strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-900 leading-none">Listas da Princesa</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {ativas.length} {ativas.length === 1 ? 'lista ativa' : 'listas ativas'}
              {arquivadas.length > 0 && ` · ${arquivadas.length} arquivada${arquivadas.length > 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        <InputNovaLista onCriar={criarLista} />
      </div>

      {/* Tabs */}
      <div className="px-4 pt-3 pb-1">
        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
          <button
            type="button"
            onClick={() => setAba('pendentes')}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all duration-150
                        ${aba === 'pendentes'
                          ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
            Pendentes{ativas.length > 0 ? ` (${ativas.length})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setAba('concluidas')}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all duration-150
                        ${aba === 'concluidas'
                          ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
            Arquivadas{arquivadas.length > 0 ? ` (${arquivadas.length})` : ''}
          </button>
        </div>
      </div>

      {/* Listas ativas */}
      {aba === 'pendentes' && (
        <div className="px-4 pt-3 space-y-3">
          {ativas.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
                <Crown className="w-8 h-8 text-amber-400" strokeWidth={1.5} />
              </div>
              <p className="text-sm font-semibold text-gray-500">Nenhuma lista ainda</p>
              <p className="text-xs text-gray-400 mt-1">Crie sua primeira lista acima</p>
            </div>
          )}
          {ativas.map(lista => (
            <ListaCard
              key={lista.id}
              lista={lista}
              onAcoes={setListaAcoes}
            />
          ))}
        </div>
      )}

      {/* Listas arquivadas */}
      {aba === 'concluidas' && (
        <div className="px-4 pt-3 space-y-3">
          {arquivadas.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                <Archive className="w-8 h-8 text-gray-400" strokeWidth={1.5} />
              </div>
              <p className="text-sm font-semibold text-gray-500">Nenhuma lista arquivada</p>
            </div>
          )}
          {arquivadas.map(lista => (
            <ListaCard
              key={lista.id}
              lista={lista}
              onAcoes={setListaAcoes}
            />
          ))}
        </div>
      )}

      {/* Bottom sheet ações */}
      {listaAcoes && (
        <BottomSheetAcoes
          lista={listaAcoes}
          onClose={() => setListaAcoes(null)}
          onRenomear={renomearLista}
          onArquivar={arquivarLista}
          onDesarquivar={desarquivarLista}
          onExcluir={excluirLista}
        />
      )}
    </div>
  )
}
