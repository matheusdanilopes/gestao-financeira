'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { supabase } from './supabaseClient'
import { useGlobalSync } from './useGlobalSync'

export type ListaCompras = {
  id: string
  nome: string
  status: 'ativa' | 'arquivada'
  criado_por: string | null
  parent_id: string | null
  created_at: string
  updated_at: string
}

export type ListaComMeta = ListaCompras & {
  totalItens: number
  totalPendentes: number
  totalPrevisto: number
  totalPago: number
  totalSublistas: number
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

type TotaisLista = {
  totalItens: number
  totalPendentes: number
  totalPrevisto: number
  totalPago: number
}

type ItemMeta = {
  lista_id: string
  preco_previsto: number | null
  preco_pago: number | null
  status: string
  quantidade: number
}

/**
 * Agrega os itens por lista numa única passada.
 *
 * Antes cada lista varria o array inteiro de itens 5x (um filter + 3 reduces
 * sobre o resultado), o que dava O(listas x itens) — perceptível em contas com
 * muitas listas, já que os itens de todas elas vêm no mesmo array.
 */
function agregarItensPorLista(itens: ItemMeta[]): Map<string, TotaisLista> {
  const porLista = new Map<string, TotaisLista>()
  for (const item of itens) {
    let t = porLista.get(item.lista_id)
    if (!t) {
      t = { totalItens: 0, totalPendentes: 0, totalPrevisto: 0, totalPago: 0 }
      porLista.set(item.lista_id, t)
    }
    t.totalItens++
    if (item.status === 'pendente') t.totalPendentes++
    else if (item.status === 'comprado') t.totalPago += (item.preco_pago ?? 0) * item.quantidade
    t.totalPrevisto += (item.preco_previsto ?? 0) * item.quantidade
  }
  return porLista
}

const TOTAIS_VAZIOS: TotaisLista = {
  totalItens: 0, totalPendentes: 0, totalPrevisto: 0, totalPago: 0,
}

async function getUsuario(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.user?.email ?? null
  } catch {
    return null
  }
}

// ── useListasCompras — gerencia a lista de listas raiz (tela Minhas Listas) ────

export function useListasCompras() {
  const [listas, setListas] = useState<ListaCompras[]>([])
  const [itensMeta, setItensMeta] = useState<ItemMeta[]>([])
  const [sublistasMeta, setSublistasMeta] = useState<{ id: string; parent_id: string }[]>([])
  const listasRef = useRef<ListaCompras[]>([])
  useEffect(() => { listasRef.current = listas }, [listas])

  const sync = useGlobalSync({
    cacheKey: 'listas-compras',
    tables: ['listas_compras', 'listas_compras_itens'],
    fetcher: async () => {
      const listasResult = await supabase
        .from('listas_compras')
        .select('*')
        .is('parent_id', null)
        .order('created_at', { ascending: false })
      if (listasResult.error) throw listasResult.error

      // Busca itens só das listas raiz carregadas acima — evita trazer a
      // tabela inteira de itens (que cresce com todo o histórico de compras)
      // só para calcular contadores/totais das listas visíveis nesta tela.
      const listaIds = (listasResult.data ?? []).map(l => l.id)
      async function fetchItens(): Promise<{ data: ItemMeta[] | null; error: unknown }> {
        if (listaIds.length === 0) return { data: [], error: null }
        return supabase.from('listas_compras_itens').select('lista_id, preco_previsto, preco_pago, status, quantidade').in('lista_id', listaIds)
      }

      const [itensResult, sublistasResult] = await Promise.all([
        fetchItens(),
        supabase.from('listas_compras').select('id, parent_id').not('parent_id', 'is', null),
      ])
      if (itensResult.error) throw itensResult.error
      if (sublistasResult.error) throw sublistasResult.error
      return {
        listas: listasResult.data ?? [],
        itens: itensResult.data ?? [],
        sublistas: sublistasResult.data ?? [],
      }
    },
    onData: (data: unknown) => {
      const d = data as { listas: ListaCompras[]; itens: ItemMeta[]; sublistas: { id: string; parent_id: string }[] }
      setListas(d.listas)
      setItensMeta(d.itens)
      setSublistasMeta(d.sublistas)
    },
  })

  const listasComMeta: ListaComMeta[] = useMemo(() => {
    const totaisPorLista = agregarItensPorLista(itensMeta)
    const sublistasPorParent = new Map<string, number>()
    for (const s of sublistasMeta) {
      sublistasPorParent.set(s.parent_id, (sublistasPorParent.get(s.parent_id) ?? 0) + 1)
    }
    return listas.map(lista => ({
      ...lista,
      ...(totaisPorLista.get(lista.id) ?? TOTAIS_VAZIOS),
      totalSublistas: sublistasPorParent.get(lista.id) ?? 0,
    }))
  }, [listas, itensMeta, sublistasMeta])

  const ativas = useMemo(() => listasComMeta.filter(l => l.status === 'ativa'), [listasComMeta])
  const arquivadas = useMemo(() => listasComMeta.filter(l => l.status === 'arquivada'), [listasComMeta])
  const isLoading = sync.status === 'loading'

  const criarLista = useCallback(async (nome: string) => {
    const criado_por = await getUsuario()
    const tempId = crypto.randomUUID()
    const now = new Date().toISOString()
    const tempLista: ListaCompras = { id: tempId, nome: nome.trim(), status: 'ativa', criado_por, parent_id: null, created_at: now, updated_at: now }
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

  return { ativas, arquivadas, criarLista, renomearLista, arquivarLista, desarquivarLista, excluirLista, isLoading }
}

// ── useSublistasLista — gerencia sublistas filhas de uma lista (tela Detalhe) ──

export function useSublistasLista(parentId: string) {
  const [sublistas, setSublistas] = useState<ListaCompras[]>([])
  const [itensMeta, setItensMeta] = useState<ItemMeta[]>([])
  const sublistasRef = useRef<ListaCompras[]>([])
  useEffect(() => { sublistasRef.current = sublistas }, [sublistas])

  const sync = useGlobalSync({
    cacheKey: `sublistas-${parentId}`,
    tables: ['listas_compras', 'listas_compras_itens'],
    fetcher: async () => {
      const sublistasResult = await supabase
        .from('listas_compras')
        .select('*')
        .eq('parent_id', parentId)
        .order('created_at', { ascending: true })
      if (sublistasResult.error) throw sublistasResult.error

      // Mesma otimização de useListasCompras: só busca itens das sublistas
      // já carregadas, em vez da tabela inteira de itens do app.
      const subIds = (sublistasResult.data ?? []).map(s => s.id)
      const itensResult = subIds.length > 0
        ? await supabase.from('listas_compras_itens').select('lista_id, preco_previsto, preco_pago, status, quantidade').in('lista_id', subIds)
        : { data: [] as ItemMeta[], error: null }
      if (itensResult.error) throw itensResult.error

      return { sublistas: sublistasResult.data ?? [], itens: itensResult.data ?? [] }
    },
    onData: (data: unknown) => {
      const d = data as { sublistas: ListaCompras[]; itens: ItemMeta[] }
      setSublistas(d.sublistas)
      setItensMeta(d.itens)
    },
  })

  const sublistasComMeta: ListaComMeta[] = useMemo(() => {
    const totaisPorLista = agregarItensPorLista(itensMeta)
    return sublistas.map(sub => ({
      ...sub,
      ...(totaisPorLista.get(sub.id) ?? TOTAIS_VAZIOS),
      totalSublistas: 0,
    }))
  }, [sublistas, itensMeta])
  const isLoading = sync.status === 'loading'

  const criarSublista = useCallback(async (nome: string) => {
    const criado_por = await getUsuario()
    const tempId = crypto.randomUUID()
    const now = new Date().toISOString()
    const tempSub: ListaCompras = { id: tempId, nome: nome.trim(), status: 'ativa', criado_por, parent_id: parentId, created_at: now, updated_at: now }
    setSublistas(prev => [...prev, tempSub])

    const { data, error } = await supabase
      .from('listas_compras')
      .insert([{ nome: nome.trim(), criado_por, parent_id: parentId }])
      .select()
      .single()

    if (error) {
      setSublistas(prev => prev.filter(s => s.id !== tempId))
      throw error
    }
    setSublistas(prev => prev.map(s => s.id === tempId ? (data as ListaCompras) : s))
    return data as ListaCompras
  }, [parentId])

  const renomearSublista = useCallback(async (id: string, nome: string) => {
    const snapshot = sublistasRef.current
    setSublistas(prev => prev.map(s => s.id === id ? { ...s, nome: nome.trim() } : s))
    const { error } = await supabase
      .from('listas_compras')
      .update({ nome: nome.trim(), updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      setSublistas(snapshot)
      throw error
    }
  }, [])

  const excluirSublista = useCallback(async (id: string) => {
    const snapshot = sublistasRef.current
    setSublistas(prev => prev.filter(s => s.id !== id))
    const { error } = await supabase.from('listas_compras').delete().eq('id', id)
    if (error) {
      setSublistas(snapshot)
      throw error
    }
  }, [])

  const totalPrevisto = sublistasComMeta.reduce((s, sub) => s + sub.totalPrevisto, 0)
  const totalPago = sublistasComMeta.reduce((s, sub) => s + sub.totalPago, 0)

  return { sublistas: sublistasComMeta, totalPrevisto, totalPago, criarSublista, renomearSublista, excluirSublista, isLoading }
}

// ── useItensLista — gerencia itens de uma lista específica (tela Detalhe) ─────

export function useItensLista(listaId: string) {
  const [itens, setItens] = useState<ItemListaCompras[]>([])
  const itensRef = useRef<ItemListaCompras[]>([])
  useEffect(() => { itensRef.current = itens }, [itens])

  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pendingRef = useRef<Record<string, Partial<ItemListaCompras>>>({})

  const sync = useGlobalSync({
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
  const isLoading = sync.status === 'loading'

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
    isLoading,
  }
}
