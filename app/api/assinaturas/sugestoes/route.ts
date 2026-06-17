import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { format, subMonths, startOfMonth } from 'date-fns'

const MIN_MESES_CONSECUTIVOS = 3

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+\d{1,2}\/\d{1,2}x?\s*/g, ' ')    // remove "1/12x"
    .replace(/\s*parcela\s*\d+\s*\/\s*\d+\s*/gi, '') // remove "parcela 1/2"
    .replace(/\*+/g, '')
    .replace(/[#@!.]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export async function GET(req: NextRequest) {
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  // Busca últimos 6 meses de transações
  const hoje = new Date()
  const inicio = format(startOfMonth(subMonths(hoje, 6)), 'yyyy-MM-dd')

  const { data: transacoes, error } = await supabase
    .from('transacoes_nubank')
    .select('descricao, valor, responsavel, cartao, projeto_fatura, status, parcela_atual, total_parcelas')
    .gte('projeto_fatura', inicio)
    .not('status', 'eq', 'ESTORNO')
    .not('status', 'eq', 'ESTORNADO')
    // Exclui parcelamentos: transações com mais de 1 parcela não são recorrências
    .or('total_parcelas.is.null,total_parcelas.lte.1')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Busca assinaturas existentes para evitar sugerir o que já está cadastrado
  const { data: assinaturasExistentes } = await supabase
    .from('assinaturas')
    .select('nome')
    .eq('ativa', true)

  const nomesExistentes = new Set(
    (assinaturasExistentes ?? []).map((a: { nome: string }) => normalizar(a.nome))
  )

  // Agrupa por (descrição normalizada + responsável) e mês
  type Grupo = {
    descricao: string
    responsavel: string
    cartao: string
    meses: Set<string>
    valores: number[]
  }
  const grupos = new Map<string, Grupo>()

  // Regex para detectar parcelamentos na descrição (fallback caso colunas não estejam preenchidas)
  const RE_PARCELA = /\b\d{1,2}\s*\/\s*\d{2,}\b|\bparcela\s*\d/i

  for (const t of transacoes ?? []) {
    if (!t.descricao || !t.projeto_fatura) continue

    // Descarta parcelamentos explícitos via colunas
    if (t.total_parcelas && Number(t.total_parcelas) > 1) continue
    // Descarta parcelamentos detectados na descrição (ex: "SAMSUNG 3/12", "Parcela 2")
    if (RE_PARCELA.test(t.descricao as string)) continue

    const norm = normalizar(t.descricao as string)
    if (norm.length < 3) continue

    const chave = `${norm}::${t.responsavel}`
    if (!grupos.has(chave)) {
      grupos.set(chave, {
        descricao: t.descricao as string,
        responsavel: t.responsavel as string,
        cartao: t.cartao as string || '',
        meses: new Set(),
        valores: [],
      })
    }
    const g = grupos.get(chave)!
    g.meses.add((t.projeto_fatura as string).substring(0, 7))
    g.valores.push(t.valor as number)
  }

  type Sugestao = {
    descricao: string; responsavel: string; cartao: string; aparicoes: number
    meses: string[]; valor_medio: number; valor_min: number; valor_max: number; variacao_percentual: number
  }
  // Filtra grupos com MIN_MESES_CONSECUTIVOS ou mais aparições
  const sugestoes: Sugestao[] = []
  for (const [, g] of grupos) {
    if (g.meses.size < MIN_MESES_CONSECUTIVOS) continue

    const norm = normalizar(g.descricao)
    if (nomesExistentes.has(norm)) continue

    const valorMedio = g.valores.reduce((a, b) => a + b, 0) / g.valores.length
    const valorMin = Math.min(...g.valores)
    const valorMax = Math.max(...g.valores)
    const variacaoPercentual = valorMedio > 0 ? ((valorMax - valorMin) / valorMedio) * 100 : 0

    sugestoes.push({
      descricao: g.descricao,
      responsavel: g.responsavel,
      cartao: g.cartao,
      aparicoes: g.meses.size,
      meses: Array.from(g.meses).sort(),
      valor_medio: Math.round(valorMedio * 100) / 100,
      valor_min: valorMin,
      valor_max: valorMax,
      variacao_percentual: Math.round(variacaoPercentual),
    })
  }

  // Ordena por número de aparições (mais recorrentes primeiro)
  sugestoes.sort((a: Sugestao, b: Sugestao) => b.aparicoes - a.aparicoes)

  return NextResponse.json({ sugestoes: sugestoes.slice(0, 20) })
}
