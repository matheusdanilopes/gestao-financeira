'use client'

import { useState, useCallback } from 'react'
import { supabase } from './supabaseClient'
import type { ItemMercado } from './useListaMercado'

export type ItemHistorico = {
  nome: string
  quantidade: number
  preco_unit: number | null
}

export type RegistroCompra = {
  id: string
  data_hora: string
  valor_total: number
  itens_count: number
  itens: ItemHistorico[]
  usuario: string | null
  created_at: string
}

async function getUsuario(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.email ?? null
}

export function useHistoricoCompras() {
  const [historico, setHistorico] = useState<RegistroCompra[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buscar = useCallback(async (inicio?: string, fim?: string) => {
    setLoading(true)
    setError(null)
    try {
      let query = supabase
        .from('historico_compras')
        .select('*')
        .order('data_hora', { ascending: false })
        .limit(100)

      if (inicio) query = query.gte('data_hora', inicio)
      if (fim) query = query.lte('data_hora', fim)

      const { data, error: dbErr } = await query
      if (dbErr) throw dbErr
      setHistorico((data ?? []) as RegistroCompra[])
    } catch {
      setError('Erro ao carregar histórico')
    } finally {
      setLoading(false)
    }
  }, [])

  const excluir = useCallback(async (id: string) => {
    setHistorico(prev => prev.filter(r => r.id !== id))
    await supabase.from('historico_compras').delete().eq('id', id)
  }, [])

  const salvar = useCallback(async (
    itens: ItemMercado[],
    valorTotal: number,
  ): Promise<RegistroCompra> => {
    const usuario = await getUsuario()
    const comprados = itens.filter(i => i.comprado)
    const payload = {
      data_hora: new Date().toISOString(),
      valor_total: valorTotal,
      itens_count: comprados.length,
      itens: comprados.map(i => ({
        nome: i.nome,
        quantidade: i.quantidade,
        preco_unit: i.preco_unit,
      })),
      usuario,
    }
    const { data, error: dbErr } = await supabase
      .from('historico_compras')
      .insert([payload])
      .select()
      .single()
    if (dbErr) throw dbErr
    return data as RegistroCompra
  }, [])

  return { historico, loading, error, buscar, salvar, excluir }
}
