'use client'

import { useState, useCallback, useRef } from 'react'
import { supabase } from './supabaseClient'
import { useDataSync } from './useDataSync'

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

async function getUsuario(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.email ?? null
}

export function useListaMercado() {
  const [itens, setItens] = useState<ItemMercado[]>([])
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  // Tracks optimistic updates that haven't been confirmed by DB yet.
  // Merged into fetched data so a realtime event from another user
  // can't overwrite a pending toggle/edit before the 400ms save fires.
  const pendingUpdatesRef = useRef<Record<string, Partial<ItemMercado>>>({})

  useDataSync({
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
      const pending = pendingUpdatesRef.current
      setItens(items.map(item => {
        const p = pending[item.id]
        return p ? { ...item, ...p } : item
      }))
    },
  })

  // Total apenas dos pendentes (comprado=false)
  const total = itens
    .filter(i => !i.comprado)
    .reduce((s, i) => s + i.quantidade * (i.preco_unit ?? 0), 0)

  // Itens pendentes sem preço definido
  const semPreco = itens.filter(i => !i.comprado && i.preco_unit == null).length

  const _salvar = useCallback((id: string, campos: Partial<ItemMercado>) => {
    setItens(prev => prev.map(i => i.id === id ? { ...i, ...campos } : i))
    pendingUpdatesRef.current[id] = { ...(pendingUpdatesRef.current[id] ?? {}), ...campos }
    if (timersRef.current[id]) clearTimeout(timersRef.current[id])
    timersRef.current[id] = setTimeout(async () => {
      await supabase
        .from('lista_mercado_itens')
        .update({ ...campos, updated_at: new Date().toISOString() })
        .eq('id', id)
      delete pendingUpdatesRef.current[id]
    }, 400)
  }, [])

  const adicionar = useCallback(async (nome: string, quantidade = 1) => {
    const nomeTrimado = nome.trim()
    if (!nomeTrimado) return
    const criado_por = await getUsuario()
    const payload = { nome: nomeTrimado, quantidade, preco_unit: null as number | null, comprado: false, criado_por }
    const tempId = crypto.randomUUID()
    const now = new Date().toISOString()
    setItens(prev => [...prev, { ...payload, id: tempId, created_at: now, updated_at: now }])

    const { data, error } = await supabase
      .from('lista_mercado_itens')
      .insert([payload])
      .select()
      .single()

    if (error) {
      setItens(prev => prev.filter(i => i.id !== tempId))
      throw error
    }
    setItens(prev => prev.map(i => i.id === tempId ? (data as ItemMercado) : i))
  }, [])

  const alterarQuantidade = useCallback((id: string, delta: number, itensAtual: ItemMercado[]) => {
    const item = itensAtual.find(i => i.id === id)
    if (!item) return
    const novaQtd = Math.max(1, item.quantidade + delta)
    if (novaQtd === item.quantidade) return
    _salvar(id, { quantidade: novaQtd })
  }, [_salvar])

  const definirPreco = useCallback((id: string, preco: number | null) => {
    _salvar(id, { preco_unit: preco })
  }, [_salvar])

  const editarNome = useCallback((id: string, nome: string) => {
    const nomeTrimado = nome.trim()
    if (!nomeTrimado) return
    _salvar(id, { nome: nomeTrimado })
  }, [_salvar])

  const toggleComprado = useCallback((id: string, itensAtual: ItemMercado[]) => {
    const item = itensAtual.find(i => i.id === id)
    if (!item) return
    _salvar(id, { comprado: !item.comprado })
  }, [_salvar])

  const excluir = useCallback(async (id: string) => {
    if (timersRef.current[id]) clearTimeout(timersRef.current[id])
    setItens(prev => prev.filter(i => i.id !== id))
    await supabase.from('lista_mercado_itens').delete().eq('id', id)
  }, [])

  const limparComprados = useCallback(async (itensAtual: ItemMercado[]) => {
    const ids = itensAtual.filter(i => i.comprado).map(i => i.id)
    if (!ids.length) return
    ids.forEach(id => { if (timersRef.current[id]) clearTimeout(timersRef.current[id]) })
    setItens(prev => prev.filter(i => !i.comprado))
    await supabase.from('lista_mercado_itens').delete().in('id', ids)
  }, [])

  return { itens, total, semPreco, adicionar, alterarQuantidade, definirPreco, editarNome, toggleComprado, excluir, limparComprados }
}
