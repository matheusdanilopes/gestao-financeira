'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { useDataSync } from './useDataSync'
import {
  enqueueOp,
  dequeueOp,
  getAllOps,
  clearOpsForItem,
  clearQueue,
  incrementOpRetries,
  registerTempId,
  resolveItemId,
  compressQueue,
  cleanupTempMap,
  type PendingOp,
} from './offlineQueue'

export type ItemMercado = {
  id: string
  nome: string
  quantidade: number
  preco_unit: number | null
  comprado: boolean
  criado_por: string | null
  created_at: string
  updated_at: string
}

export type OfflineSyncStatus = 'synced' | 'pending' | 'syncing' | 'error'

async function getUsuario(): Promise<string | null> {
  try {
    // getSession() lê do armazenamento local (sem chamada de rede),
    // ao contrário de getUser() que valida o JWT no servidor.
    const { data: { session } } = await supabase.auth.getSession()
    return session?.user?.email ?? null
  } catch {
    return null
  }
}

export function useListaMercado() {
  const [itens, setItens] = useState<ItemMercado[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [pendingOps, setPendingOps] = useState<PendingOp[]>([])
  const [syncStatus, setSyncStatus] = useState<OfflineSyncStatus>('synced')

  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  // Tracks optimistic updates in-flight (debouncing). Prevents realtime events
  // from a second user from overwriting a pending local edit before 400ms fires.
  const pendingUpdatesRef = useRef<Record<string, Partial<ItemMercado>>>({})
  const isSyncingRef = useRef(false)

  const refreshCount = useCallback(() => {
    const ops = getAllOps()
    const count = ops.length
    setPendingCount(count)
    setPendingOps(ops)
    if (!isSyncingRef.current) {
      setSyncStatus(count > 0 ? 'pending' : 'synced')
    }
  }, [])

  // ── Flush da fila offline ──────────────────────────────────────────────────
  const flushQueue = useCallback(async () => {
    if (isSyncingRef.current) return
    // Colapsa múltiplos updates para o mesmo item antes de enviar
    compressQueue()
    const ops = getAllOps()
    if (!ops.length) return

    isSyncingRef.current = true
    setSyncStatus('syncing')

    // Processa creates primeiro (geram IDs reais necessários para updates/deletes)
    const ordered = [
      ...ops.filter(op => op.type === 'create'),
      ...ops.filter(op => op.type === 'update'),
      ...ops.filter(op => op.type === 'delete'),
    ]

    let anyError = false

    for (const op of ordered) {
      try {
        if (op.type === 'create' && op.payload) {
          // Omite campos gerados localmente; o servidor gera os definitivos
          const { id: _id, created_at: _ca, updated_at: _ua, ...insertPayload } = op.payload as ItemMercado
          const { data, error } = await supabase
            .from('lista_mercado_itens')
            .insert([insertPayload])
            .select()
            .single()
          if (error) throw error
          registerTempId(op.itemId, (data as ItemMercado).id)
          dequeueOp(op.opId)
        } else if (op.type === 'update' && op.payload) {
          const realId = resolveItemId(op.itemId)
          const { error } = await supabase
            .from('lista_mercado_itens')
            .update({ ...op.payload, updated_at: new Date().toISOString() })
            .eq('id', realId)
          if (error) throw error
          dequeueOp(op.opId)
        } else if (op.type === 'delete') {
          const realId = resolveItemId(op.itemId)
          const { error } = await supabase
            .from('lista_mercado_itens')
            .delete()
            .eq('id', realId)
          // PGRST116 = item não existe mais — deleção já efetivada por outro dispositivo
          if (error && error.code !== 'PGRST116') throw error
          dequeueOp(op.opId)
        }
      } catch {
        incrementOpRetries(op.opId)
        anyError = true
      }
    }

    isSyncingRef.current = false
    const remainingOps = getAllOps()
    const remaining = remainingOps.length
    setPendingCount(remaining)
    setPendingOps(remainingOps)
    setSyncStatus(anyError ? 'error' : remaining > 0 ? 'pending' : 'synced')
  }, [])

  // ── Sincronização de dados ─────────────────────────────────────────────────
  const { isOnline } = useDataSync({
    cacheKey: 'lista-mercado',
    tables: ['lista_mercado_itens'],
    fetcher: async () => {
      const { data, error } = await supabase
        .from('lista_mercado_itens')
        .select('*')
        .order('created_at', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    onData: (data) => {
      const items = data as ItemMercado[]
      const memPending = pendingUpdatesRef.current

      // Overlay de edições na fila (offline): aplicar sobre dados do servidor
      const queueOverrides: Record<string, Partial<ItemMercado>> = {}
      for (const op of getAllOps()) {
        if (op.type === 'update' && op.payload) {
          const realId = resolveItemId(op.itemId)
          queueOverrides[realId] = {
            ...(queueOverrides[realId] ?? {}),
            ...(op.payload as Partial<ItemMercado>),
          }
        }
      }

      const serverIds = new Set(items.map(i => i.id))

      // Itens criados offline ainda não sincronizados com o servidor
      const offlineCreates = getAllOps()
        .filter(op => op.type === 'create' && !serverIds.has(resolveItemId(op.itemId)))
        .map(op => op.payload as ItemMercado)

      const merged = [
        ...items.map(item => {
          const p: Partial<ItemMercado> = {
            ...(queueOverrides[item.id] ?? {}),
            ...(memPending[item.id] ?? {}),
          }
          return Object.keys(p).length ? { ...item, ...p } : item
        }),
        ...offlineCreates,
      ].sort((a, b) => a.created_at.localeCompare(b.created_at))

      setItens(merged)
    },
    onReconnect: flushQueue,
  })

  useEffect(() => {
    refreshCount()
    // Limpa o mapa de IDs temporários se cresceu demais (entradas de sessões antigas)
    cleanupTempMap()
  }, [refreshCount])

  // ── Cálculos derivados ─────────────────────────────────────────────────────
  const total = itens.reduce((s, i) => s + i.quantidade * (i.preco_unit ?? 0), 0)
  const semPreco = itens.filter(i => i.preco_unit == null).length

  // ── Salvar (update com debounce) ───────────────────────────────────────────
  const _salvar = useCallback((id: string, campos: Partial<ItemMercado>) => {
    setItens(prev => prev.map(i => i.id === id ? { ...i, ...campos } : i))
    pendingUpdatesRef.current[id] = { ...(pendingUpdatesRef.current[id] ?? {}), ...campos }
    if (timersRef.current[id]) clearTimeout(timersRef.current[id])
    timersRef.current[id] = setTimeout(async () => {
      const accumulated = { ...(pendingUpdatesRef.current[id] ?? {}) }
      const accKeys = Object.keys(accumulated) as (keyof ItemMercado)[]
      // NÃO limpa pendingUpdatesRef aqui — o overlay permanece ativo durante o request.
      // Isso evita a race condition onde um evento Realtime de outro dispositivo sobrescreve
      // a edição local enquanto o request ainda está em voo (~50-500ms).
      try {
        const realId = resolveItemId(id)
        const { error } = await supabase
          .from('lista_mercado_itens')
          .update({ ...accumulated, updated_at: new Date().toISOString() })
          .eq('id', realId)
        if (error) throw error
      } catch {
        // Offline ou erro de rede: enfileira para sincronizar ao reconectar
        enqueueOp({
          type: 'update',
          itemId: id,
          payload: accumulated as Record<string, unknown>,
          timestamp: Date.now(),
        })
        refreshCount()
      } finally {
        // Remove apenas os campos que foram salvos/enfileirados neste request.
        // Se novos valores chegaram durante o request (user continuou digitando),
        // eles têm valores diferentes em pendingUpdatesRef e são preservados.
        if (pendingUpdatesRef.current[id]) {
          const current = pendingUpdatesRef.current[id] as Record<string, unknown>
          const acc = accumulated as Record<string, unknown>
          for (const key of accKeys) {
            if (current[key] === acc[key]) delete current[key]
          }
          if (Object.keys(current).length === 0) delete pendingUpdatesRef.current[id]
        }
      }
    }, 400)
  }, [refreshCount])

  // ── Adicionar ──────────────────────────────────────────────────────────────
  const adicionar = useCallback(async (nome: string, quantidade = 1) => {
    const nomeTrimado = nome.trim()
    if (!nomeTrimado) return
    const criado_por = await getUsuario()
    const payload = {
      nome: nomeTrimado,
      quantidade,
      preco_unit: null as number | null,
      comprado: false,
      criado_por,
    }
    const tempId = crypto.randomUUID()
    const now = new Date().toISOString()
    const tempItem: ItemMercado = { ...payload, id: tempId, created_at: now, updated_at: now }

    setItens(prev => [...prev, tempItem])

    try {
      const { data, error } = await supabase
        .from('lista_mercado_itens')
        .insert([payload])
        .select()
        .single()
      if (error) throw error
      registerTempId(tempId, (data as ItemMercado).id)
      setItens(prev => prev.map(i => i.id === tempId ? (data as ItemMercado) : i))
    } catch {
      // Offline: item fica na UI com ID temporário, será sincronizado ao reconectar
      enqueueOp({
        type: 'create',
        itemId: tempId,
        payload: tempItem as unknown as Record<string, unknown>,
        timestamp: Date.now(),
      })
      refreshCount()
    }
  }, [refreshCount])

  // ── Alterar quantidade ─────────────────────────────────────────────────────
  const alterarQuantidade = useCallback((id: string, delta: number, itensAtual: ItemMercado[]) => {
    const item = itensAtual.find(i => i.id === id)
    if (!item) return
    const novaQtd = Math.max(1, item.quantidade + delta)
    if (novaQtd === item.quantidade) return
    _salvar(id, { quantidade: novaQtd })
  }, [_salvar])

  // ── Definir preço ──────────────────────────────────────────────────────────
  const definirPreco = useCallback((id: string, preco: number | null) => {
    _salvar(id, { preco_unit: preco })
  }, [_salvar])

  // ── Editar nome ────────────────────────────────────────────────────────────
  const editarNome = useCallback((id: string, nome: string) => {
    const nomeTrimado = nome.trim()
    if (!nomeTrimado) return
    _salvar(id, { nome: nomeTrimado })
  }, [_salvar])

  // ── Toggle comprado ────────────────────────────────────────────────────────
  const toggleComprado = useCallback((id: string, itensAtual: ItemMercado[]) => {
    const item = itensAtual.find(i => i.id === id)
    if (!item) return
    _salvar(id, { comprado: !item.comprado })
  }, [_salvar])

  // ── Excluir ────────────────────────────────────────────────────────────────
  const excluir = useCallback(async (id: string) => {
    if (timersRef.current[id]) clearTimeout(timersRef.current[id])
    delete pendingUpdatesRef.current[id]
    setItens(prev => prev.filter(i => i.id !== id))

    // Item criado offline: cancela o create, nada a deletar no servidor
    const hasPendingCreate = getAllOps().some(op => op.itemId === id && op.type === 'create')
    if (hasPendingCreate) {
      clearOpsForItem(id)
      refreshCount()
      return
    }

    try {
      const realId = resolveItemId(id)
      const { error } = await supabase.from('lista_mercado_itens').delete().eq('id', realId)
      if (error) throw error
    } catch {
      enqueueOp({ type: 'delete', itemId: id, timestamp: Date.now() })
      refreshCount()
    }
  }, [refreshCount])

  // ── Limpar comprados ───────────────────────────────────────────────────────
  const limparComprados = useCallback(async (itensAtual: ItemMercado[]) => {
    const ids = itensAtual.filter(i => i.comprado).map(i => i.id)
    if (!ids.length) return
    ids.forEach(id => {
      if (timersRef.current[id]) clearTimeout(timersRef.current[id])
      delete pendingUpdatesRef.current[id]
    })
    setItens(prev => prev.filter(i => !i.comprado))

    // Itens criados offline: só remove da fila, sem delete no servidor
    const offlineIds = ids.filter(id =>
      getAllOps().some(op => op.itemId === id && op.type === 'create')
    )
    offlineIds.forEach(id => clearOpsForItem(id))

    const onlineIds = ids.filter(id => !offlineIds.includes(id))
    if (!onlineIds.length) { refreshCount(); return }

    try {
      const realIds = onlineIds.map(resolveItemId)
      const { error } = await supabase.from('lista_mercado_itens').delete().in('id', realIds)
      if (error) throw error
    } catch {
      onlineIds.forEach(id => {
        enqueueOp({ type: 'delete', itemId: id, timestamp: Date.now() })
      })
      refreshCount()
    }
  }, [refreshCount])

  const clearPendingQueue = useCallback(() => {
    clearQueue()
    setPendingCount(0)
    setPendingOps([])
    setSyncStatus('synced')
  }, [])

  return {
    itens,
    total,
    semPreco,
    adicionar,
    alterarQuantidade,
    definirPreco,
    editarNome,
    toggleComprado,
    excluir,
    limparComprados,
    isOnline,
    pendingCount,
    pendingOps,
    syncStatus,
    flushQueue,
    clearPendingQueue,
  }
}
