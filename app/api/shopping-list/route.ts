import { NextRequest, NextResponse } from 'next/server'
import { requireShoppingListAuth } from '@/lib/serverAuth'
import { agruparPorSetor } from '@/lib/setoresMercado'

export async function GET(req: NextRequest) {
  const { supabase, unauthorized } = await requireShoppingListAuth(req)
  if (unauthorized) return unauthorized

  const { data: items, error } = await supabase
    .from('lista_mercado_itens')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'Erro ao buscar itens' }, { status: 500 })
  }

  const allItems = items ?? []

  // Agrupa pelos setores do mercado (categorias antigas são convertidas e
  // itens sem setor são classificados pelo nome)
  const grupos = agruparPorSetor(allItems as { nome: string; category?: string | null }[])

  return NextResponse.json({
    success: true,
    total_itens: allItems.length,
    quantidade_total: allItems.reduce((s: number, i: { quantidade?: number }) => s + (i.quantidade ?? 1), 0),
    categorias: grupos.map(g => ({
      categoria: g.setor,
      itens: g.itens,
    })),
  })
}
