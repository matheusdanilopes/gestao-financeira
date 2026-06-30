'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { useGlobalSync } from './useGlobalSync'

export type ListaCompras = {
  id: string
  nome: string
  status: 'ativa' | 'arquivada'
  criado_por: string | null
  created_at: string
  updated_at: string
}

export type ListaComMeta = ListaCompras & {
  totalItens: number
  totalPendentes: number
  totalPrevisto: number
  totalPago: number
}

export type ItemListaCompras = {
  id: string
  lista_id: string
  nome: string
  quantidade: number
  pessoa: string | null
  preco_previsto: number | null
  preco_pago: number | null
  status: 'pendente' | 'comprado'
  created_at: string
  updated_at: string
  data_compra: string | null
}

type ItemMeta = {
  lista_id: string
  preco_previsto: number | null
  preco_pago: number | null
  status: string
  quantidade: number
}

async function getUsuario(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.user?.email ?? null
  } catch {
    return null
  }
}

// ── useListasCompras — gerencia a lista de listas (tela Minhas Listas) ─────────

export function useListasCompras() {
  const [listas, setListas] = useState<ListaCompras[]>([])
  const [itensMeta, setItensMeta] = useState<ItemMeta[]>([])
  const listasRef = useRef<ListaCompras[]>([])
  useEffect(() => { listasRef.current = listas }, [listas])

  useGlobalSync({
    cacheKey: 'listas-compras',
    tables: ['listas_compras', 'listas_compras_itens'],
    fetcher: async () => {
      const [listasResult, itensResult] = await Promise.all([
        supabase.from('listas_compras').select('*').order('created_at', { ascending: false }),
        supabase.from('listas_compras_itens').select('lista_id, preco_previsto, preco_pago, status, quantidade'),
      ])
      if (listasResult.error) throw listasResult.error
      return { listas: listasResult.data ?? [], itens: itensResult.data ?? [] }
    },
    onData: (data: unknown) => {
      const d = data as { listas: ListaCompras[]; itens: ItemMeta[] }
      setListas(d.listas)
      setItensMeta(d.itens)
    },
  })

  const listasComMeta: ListaComMeta[] = listas.map(lista => {
    const itens = itensMeta.filter(i => i.lista_id === lista.id)
    return {
      ...lista,
      totalItens: itens.length,
      totalPendentes: itens.filter(i => i.status === 'pendente').length,
      totalPrevisto: itens.reduce((s, i) => s + (i.preco_previsto ?? 0) * i.quantidade, 0),
      totalPago: itens
        .filter(i => i.status === 'comprado')
        .reduce((s, i) => s + (i.preco_pago ?? 0) * i.quantidade, 0),
    }
  })

  const ativas = listasComMeta.filter(l => l.status === 'ativa')
  const arquivadas = listasComMeta.filter(l => l.status === 'arquivada')

  const criarLista = useCallback(async (nome: string) => {
    const criado_por = await getUsuario()
    const tempId = crypto.randomUUID()
    const now = new Date().toISOString()
    const tempLista: ListaCompras = { id: tempId, nome: nome.trim(), status: 'ativa', criado_por, created_at: now, updated_at: now }
    setListas(prev => [tempLista, ...prev])

    const { data, error } = await supabase
      .from('listas_compras')
      .insert([{ nome: nome.trim(), criado_por }])
      .select()
      .single()

    if (error) {
      setListas(prev => prev.filter(l => l.id !== tempId))
      throw error
    }
    setListas(prev => prev.map(l => l.id === tempId ? (data as ListaCompras) : l))
    return data as ListaCompras
  }, [])

  const renomearLista = useCallback(async (id: string, nome: string) => {
    const snapshot = listasRef.current
    setListas(prev => prev.map(l => l.id === id ? { ...l, nome: nome.trim() } : l))
    const { error } = await supabase
      .from('listas_compras')
      .update({ nome: nome.trim(), updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      setListas(snapshot)
      throw error
    }
  }, [])

  const arquivarLista = useCallback(async (id: string) => {
    const snapshot = listasRef.current
    setListas(prev => prev.map(l => l.id === id ? { ...l, status: 'arquivada' } : l))
    const { error } = await supabase
      .from('listas_compras')
      .update({ status: 'arquivada', updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      setListas(snapshot)
      throw error
    }
  }, [])

  const desarquivarLista = useCallback(async (id: string) => {
    const snapshot = listasRef.current
    setListas(prev => prev.map(l => l.id === id ? { ...l, status: 'ativa' } : l))
    const { error } = await supabase
      .from('listas_compras')
      .update({ status: 'ativa', updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      setListas(snapshot)
      throw error
    }
  }, [])

  const excluirLista = useCallback(async (id: string) => {
    const snapshot = listasRef.current
    setListas(prev => prev.filter(l => l.id !== id))
    const { error } = await supabase.from('listas_compras').delete().eq('id', id)
    if (error) {
      setListas(snapshot)
      throw error
    }
  }, [])

  return { ativas, arquivadas, criarLista, renomearLista, arquivarLista, desarquivarLista, excluirLista }
}

// ── useItensLista — gerencia itens de uma lista específica (tela Detalhe) ─────

export function useItensLista(listaId: string) {
  const [itens, setItens] = useState<ItemListaCompras[]>([])
  const itensRef = useRef<ItemListaCompras[]>([])
  useEffect(() => { itensRef.current = itens }, [itens])

  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pendingRef = useRef<Record<string, Partial<ItemListaCompras>>>({})

  useGlobalSync({
    cacheKey: `lista-itens-${listaId}`,
    tables: ['listas_compras_itens'],
    fetcher: async () => {
      const { data, error } = await supabase
        .from('listas_compras_itens')
        .select('*')
        .eq('lista_id', listaId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    onData: (data) => setItens(data as ItemListaCompras[]),
  })

  const _salvar = useCallback((id: string, campos: Partial<ItemListaCompras>) => {
    setItens(prev => prev.map(i => i.id === id ? { ...i, ...campos } : i))
    pendingRef.current[id] = { ...(pendingRef.current[id] ?? {}), ...campos }
    if (timersRef.current[id]) clearTimeout(timersRef.current[id])
    timersRef.current[id] = setTimeout(async () => {
      const updates = pendingRef.current[id]
      delete pendingRef.current[id]
      if (!updates) return
      await supabase
        .from('listas_compras_itens')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
    }, 400)
  }, [])

  const adicionarItem = useCallback(async (nome: string, pessoa?: string | null) => {
    const tempId = crypto.randomUUID()
    const now = new Date().toISOString()
    const tempItem: ItemListaCompras = {
      id: tempId, lista_id: listaId, nome: nome.trim(), quantidade: 1,
      pessoa: pessoa ?? null, preco_previsto: null, preco_pago: null,
      status: 'pendente', created_at: now, updated_at: now, data_compra: null,
    }
    setItens(prev => [...prev, tempItem])

    const { data, error } = await supabase
      .from('listas_compras_itens')
      .insert([{ lista_id: listaId, nome: nome.trim(), pessoa: pessoa ?? null }])
      .select()
      .single()

    if (error) {
      setItens(prev => prev.filter(i => i.id !== tempId))
      throw error
    }
    setItens(prev => prev.map(i => i.id === tempId ? (data as ItemListaCompras) : i))
  }, [listaId])

  const editarItem = useCallback((id: string, campos: Partial<ItemListaCompras>) => {
    _salvar(id, campos)
  }, [_salvar])

  const alterarQuantidade = useCallback((id: string, delta: number) => {
    const item = itensRef.current.find(i => i.id === id)
    if (!item) return
    const novaQtd = Math.max(1, item.quantidade + delta)
    if (novaQtd === item.quantidade) return
    _salvar(id, { quantidade: novaQtd })
  }, [_salvar])

  const marcarComprado = useCallback(async (id: string, preco_pago?: number | null) => {
    const snapshot = itensRef.current
    const now = new Date().toISOString()
    setItens(prev => prev.map(i =>
      i.id === id ? { ...i, status: 'comprado', data_compra: now, preco_pago: preco_pago ?? i.preco_pago } : i
    ))
    const { error } = await supabase
      .from('listas_compras_itens')
      .update({
        status: 'comprado',
        data_compra: now,
        preco_pago: preco_pago ?? null,
        updated_at: now,
      })
      .eq('id', id)
    if (error) {
      setItens(snapshot)
      throw error
    }
  }, [])

  const desmarcarComprado = useCallback(async (id: string) => {
    const snapshot = itensRef.current
    setItens(prev => prev.map(i =>
      i.id === id ? { ...i, status: 'pendente', data_compra: null, preco_pago: null } : i
    ))
    const { error } = await supabase
      .from('listas_compras_itens')
      .update({ status: 'pendente', data_compra: null, preco_pago: null, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      setItens(snapshot)
      throw error
    }
  }, [])

  const excluirItem = useCallback(async (id: string) => {
    const snapshot = itensRef.current
    setItens(prev => prev.filter(i => i.id !== id))
    const { error } = await supabase.from('listas_compras_itens').delete().eq('id', id)
    if (error) {
      setItens(snapshot)
      throw error
    }
  }, [])

  const moverParaWishlist = useCallback(async (id: string) => {
    const snapshot = itensRef.current
    setItens(prev => prev.filter(i => i.id !== id))
    const res = await fetch('/api/listas-compras/mover-wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: id }),
    })
    if (!res.ok) {
      setItens(snapshot)
      throw new Error('Erro ao mover para Wishlist')
    }
  }, [])

  const pendentes = itens.filter(i => i.status === 'pendente')
  const comprados = itens.filter(i => i.status === 'comprado')
  const totalPrevisto = itens.reduce((s, i) => s + (i.preco_previsto ?? 0) * i.quantidade, 0)
  const totalPago = comprados.reduce((s, i) => s + (i.preco_pago ?? 0) * i.quantidade, 0)

  return {
    itens, pendentes, comprados, totalPrevisto, totalPago,
    adicionarItem, editarItem, alterarQuantidade,
    marcarComprado, desmarcarComprado,
    excluirItem, moverParaWishlist,
  }
}
