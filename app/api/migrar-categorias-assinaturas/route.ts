import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { aproximarCategoriaAssinatura, parseCategoriasConfig } from '@/lib/categorias'

interface Assinatura {
  id: string
  nome: string
  categoria: string
}

interface ResultadoItem {
  id: string
  nome: string
  categoriaOriginal: string
  categoriaSugerida: string
  confianca: number
  motivo: string
  migrar: boolean
}

const THRESHOLD = 0.80

async function carregarDados(supabase: ReturnType<typeof import('@/lib/supabaseServer').criarSupabaseServer>) {
  const [{ data: assinaturas }, { data: configs }] = await Promise.all([
    supabase.from('assinaturas').select('id, nome, categoria').order('nome'),
    supabase.from('configuracoes').select('chave, valor'),
  ])

  const valorCategorias = (configs ?? []).find((c: { chave: string; valor: string }) => c.chave === 'categorias_compras')?.valor
  const categoriasUnificadas = parseCategoriasConfig(valorCategorias)

  return { assinaturas: (assinaturas ?? []) as Assinatura[], categoriasUnificadas }
}

function gerarResultados(assinaturas: Assinatura[], categoriasUnificadas: string[]): ResultadoItem[] {
  return assinaturas.map(a => {
    const resultado = aproximarCategoriaAssinatura(a.nome, a.categoria, categoriasUnificadas)
    return {
      id: a.id,
      nome: a.nome,
      categoriaOriginal: a.categoria,
      categoriaSugerida: resultado.categoria,
      confianca: resultado.confianca,
      motivo: resultado.motivo,
      migrar: resultado.confianca >= THRESHOLD && resultado.categoria !== a.categoria,
    }
  })
}

/** GET — simulação sem alterar nada (dry run) */
export async function GET(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    const { assinaturas, categoriasUnificadas } = await carregarDados(supabase)
    const resultados = gerarResultados(assinaturas, categoriasUnificadas)

    const paraAtualizar = resultados.filter(r => r.migrar)
    const semCorrespondencia = resultados.filter(r => r.motivo === 'sem_correspondencia')
    const jaUnificadas = resultados.filter(r => r.motivo === 'exato')

    return NextResponse.json({
      dryRun: true,
      threshold: THRESHOLD,
      categoriasUnificadas,
      resumo: {
        total: resultados.length,
        jaUnificadas: jaUnificadas.length,
        paraAtualizar: paraAtualizar.length,
        semCorrespondencia: semCorrespondencia.length,
      },
      paraAtualizar,
      semCorrespondencia,
      detalhes: resultados,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** POST — executa migração (idempotente, apenas confiança ≥ threshold) */
export async function POST(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  try {
    const { assinaturas, categoriasUnificadas } = await carregarDados(supabase)
    const resultados = gerarResultados(assinaturas, categoriasUnificadas)
    const paraAtualizar = resultados.filter(r => r.migrar)

    if (paraAtualizar.length === 0) {
      return NextResponse.json({ ok: true, atualizadas: 0, detalhes: [] })
    }

    const atualizadas: ResultadoItem[] = []
    const erros: { id: string; erro: string }[] = []

    // Batch por categoria para minimizar queries
    const porCategoria = paraAtualizar.reduce<Record<string, string[]>>((acc, r) => {
      acc[r.categoriaSugerida] ??= []
      acc[r.categoriaSugerida].push(r.id)
      return acc
    }, {})

    for (const [categoria, ids] of Object.entries(porCategoria)) {
      const { error } = await supabase
        .from('assinaturas')
        .update({ categoria })
        .in('id', ids)

      if (error) {
        ids.forEach(id => erros.push({ id, erro: error.message }))
      } else {
        atualizadas.push(...paraAtualizar.filter(r => ids.includes(r.id)))
      }
    }

    return NextResponse.json({
      ok: erros.length === 0,
      atualizadas: atualizadas.length,
      erros: erros.length > 0 ? erros : undefined,
      detalhes: atualizadas,
      semCorrespondencia: resultados.filter(r => r.motivo === 'sem_correspondencia'),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
