import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { format, startOfMonth, parseISO } from 'date-fns'

function escapeCsv(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function formatValor(val: number | null): string {
  if (val === null || val === undefined) return ''
  return val.toFixed(2).replace('.', ',')
}

export async function GET(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  const mesParam = url.searchParams.get('mes') // YYYY-MM

  let mesRef: string
  if (mesParam && /^\d{4}-\d{2}$/.test(mesParam)) {
    mesRef = format(startOfMonth(parseISO(mesParam + '-01')), 'yyyy-MM-dd')
  } else {
    mesRef = format(startOfMonth(new Date()), 'yyyy-MM-dd')
  }

  const { data, error } = await supabase
    .from('transacoes_nubank')
    .select('data_compra, data, descricao, valor, responsavel, categoria, cartao, parcela_atual, total_parcelas, status')
    .eq('projeto_fatura', mesRef)
    .order('data_compra', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data ?? []

  const header = ['Data', 'Descrição', 'Valor (R$)', 'Responsável', 'Categoria', 'Cartão', 'Parcela', 'Status']
  const lines = [header.join(',')]

  for (const t of rows) {
    const dataStr = ((t.data_compra || t.data || '') as string).toString().substring(0, 10)
    let dataFormatada = dataStr
    try {
      dataFormatada = dataStr ? format(parseISO(dataStr), 'dd/MM/yyyy') : ''
    } catch { /* keep raw */ }

    const parcela = t.parcela_atual && t.total_parcelas
      ? `${t.parcela_atual}/${t.total_parcelas}`
      : ''

    lines.push([
      escapeCsv(dataFormatada),
      escapeCsv(t.descricao),
      escapeCsv(formatValor(t.valor as number)),
      escapeCsv(t.responsavel as string),
      escapeCsv(t.categoria as string),
      escapeCsv(t.cartao as string),
      escapeCsv(parcela),
      escapeCsv(t.status as string),
    ].join(','))
  }

  const csv = lines.join('\r\n')
  const mesFmt = mesParam || format(new Date(), 'yyyy-MM')
  const filename = `transacoes-${mesFmt}.csv`

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
