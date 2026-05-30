import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

const CATEGORIAS_ORDEM = [
  'Proteínas', 'Carboidratos', 'Hortifruti', 'Laticínios', 'Temperos',
  'Congelados', 'Bebidas', 'Higiene', 'Limpeza', 'Outros',
]

export async function GET(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const { data: items, error } = await supabase
    .from('lista_mercado_itens')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'Erro ao buscar itens' }, { status: 500 })
  }

  const allItems = items ?? []

  const grouped: Record<string, typeof allItems> = {}
  for (const item of allItems) {
    const cat: string = item.category ?? 'Outros'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(item)
  }

  const categorias = Object.keys(grouped).sort((a, b) => {
    const ai = CATEGORIAS_ORDEM.indexOf(a)
    const bi = CATEGORIAS_ORDEM.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b, 'pt-BR')
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

  return NextResponse.json({
    success: true,
    total_itens: allItems.length,
    quantidade_total: allItems.reduce((s: number, i: { quantidade?: number }) => s + (i.quantidade ?? 1), 0),
    categorias: categorias.map(cat => ({
      categoria: cat,
      itens: grouped[cat],
    })),
  })
}
