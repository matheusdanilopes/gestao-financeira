import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'
import { processarCSV } from '@/lib/csvParser'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 })
    }

    const csvText = await file.text()
    const transacoes = processarCSV(csvText)
    
    let novosMatheus = 0
    let novosJeniffer = 0
    let totalValor = 0

    for (const transacao of transacoes) {
      // Verifica duplicata pelo hash
      const { data: existente } = await supabase
        .from('transacoes_nubank')
        .select('id')
        .eq('hash_linha', transacao.hash_linha)
        .single()

      if (!existente) {
        const { error } = await supabase
          .from('transacoes_nubank')
          .insert([transacao])

        if (!error) {
          if (transacao.responsavel === 'Matheus') novosMatheus++
          else novosJeniffer++
          totalValor += transacao.valor
        }
      }
    }

    return NextResponse.json({
      success: true,
      matheus: novosMatheus,
      jeniffer: novosJeniffer,
      total: totalValor.toFixed(2)
    })
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao processar CSV' }, { status: 500 })
  }
}