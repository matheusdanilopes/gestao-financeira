'use client'

import { useState, useCallback } from 'react'
import { supabase } from './supabaseClient'
import { useGlobalSync } from './useGlobalSync'
import { notificarWishlist } from './notificacoes'

export type WishlistItem = {
  id: string
  nome: string
  emoji: string | null
  valor_estimado: number | null
  prioridade: 'baixa' | 'media' | 'alta'
  categoria: string | null
  nota: string | null
  link_ref: string | null
  favoritado: boolean
  realizado: boolean
  realizado_em: string | null
  criado_por: string | null
  created_at: string
  updated_at: string
}

const PRIORIDADE_ORDEM: Record<string, number> = { alta: 0, media: 1, baixa: 2 }

async function getUsuario(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.email ?? null
}

export function useWishlist() {
  const [itens, setItens] = useState<WishlistItem[]>([])

  useGlobalSync({
    cacheKey: 'wishlist',
    tables: ['wishlist_items'],
    fetcher: async () => {
      const { data, error } = await supabase
        .from('wishlist_items')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    onData: (data) => setItens(data as WishlistItem[]),
  })

  const ativos = [...itens]
    .filter(i => !i.realizado)
    .sort((a, b) => {
      if (a.favoritado !== b.favoritado) return a.favoritado ? -1 : 1
      return PRIORIDADE_ORDEM[a.prioridade] - PRIORIDADE_ORDEM[b.prioridade]
    })

  const historico = [...itens]
    .filter(i => i.realizado)
    .sort((a, b) =>
      new Date(b.realizado_em ?? b.created_at).getTime() -
      new Date(a.realizado_em ?? a.created_at).getTime()
    )

  const adicionar = useCallback(async (campos: {
    nome: string
    emoji?: string | null
    valor_estimado?: number | null
    prioridade?: 'baixa' | 'media' | 'alta'
    categoria?: string | null
    nota?: string | null
    link_ref?: string | null
    criado_por?: string | null
  }) => {
    const criado_por = campos.criado_por ?? await getUsuario()
    const payload = {
      nome:           campos.nome.trim(),
      emoji:          campos.emoji          ?? null,
      valor_estimado: campos.valor_estimado ?? null,
      prioridade:     campos.prioridade     ?? 'media',
      categoria:      campos.categoria      ?? null,
      nota:           campos.nota           ?? null,
      link_ref:       campos.link_ref       ?? null,
      favoritado:     false,
      realizado:      false,
      criado_por,
    }
    const tempId = crypto.randomUUID()
    const now = new Date().toISOString()
    const tempItem: WishlistItem = { ...payload, id: tempId, created_at: now, updated_at: now, realizado_em: null }
    setItens(prev => [tempItem, ...prev])

    const { data, error } = await supabase
      .from('wishlist_items')
      .insert([payload])
      .select()
      .single()

    if (error) {
      setItens(prev => prev.filter(i => i.id !== tempId))
      throw error
    }
    setItens(prev => prev.map(i => i.id === tempId ? (data as WishlistItem) : i))
    if (criado_por) notificarWishlist((data as WishlistItem).id, campos.nome.trim(), criado_por)
  }, [])

  const editar = useCallback(async (
    id: string,
    campos: Partial<Omit<WishlistItem, 'id' | 'created_at'>>
  ) => {
    setItens(prev => prev.map(i => i.id === id ? { ...i, ...campos } : i))
    const { error } = await supabase
      .from('wishlist_items')
      .update({ ...campos, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  }, [])

  const marcarRealizado = useCallback(async (id: string) => {
    const now = new Date().toISOString()
    setItens(prev => prev.map(i => i.id === id ? { ...i, realizado: true, realizado_em: now } : i))
    const { error } = await supabase
      .from('wishlist_items')
      .update({ realizado: true, realizado_em: now, updated_at: now })
      .eq('id', id)
    if (error) throw error
  }, [])

  const desfazerRealizado = useCallback(async (id: string) => {
    setItens(prev => prev.map(i =>
      i.id === id ? { ...i, realizado: false, realizado_em: null } : i
    ))
    const { error } = await supabase
      .from('wishlist_items')
      .update({ realizado: false, realizado_em: null, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  }, [])

  const toggleFavorito = useCallback(async (id: string, itensAtual: WishlistItem[]) => {
    const item = itensAtual.find(i => i.id === id)
    if (!item) return
    const novoFav = !item.favoritado
    setItens(prev => prev.map(i => i.id === id ? { ...i, favoritado: novoFav } : i))
    await supabase
      .from('wishlist_items')
      .update({ favoritado: novoFav, updated_at: new Date().toISOString() })
      .eq('id', id)
  }, [])

  const excluir = useCallback(async (id: string) => {
    setItens(prev => prev.filter(i => i.id !== id))
    await supabase.from('wishlist_items').delete().eq('id', id)
  }, [])

  return { ativos, historico, adicionar, editar, marcarRealizado, desfazerRealizado, toggleFavorito, excluir }
}
