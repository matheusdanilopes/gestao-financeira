import { SupabaseClient } from '@supabase/supabase-js'
import { CATEGORIAS_PADRAO, parseCategoriasConfig } from '@/lib/categorias'

const LOTE = 20
const DELAY_ENTRE_LOTES_MS = 5000
const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const CONFIANCA_PADRAO_IA = 0.85

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function extrairRetryDelay(errText: string): number {
  const match = errText.match(/"retryDelay":\s*"(\d+)s"/)
  return match ? (parseInt(match[1]) + 2) * 1000 : 60000
}

function isCotaDiaria(errText: string): boolean {
  return errText.includes('GenerateRequestsPerDayPerProjectPerModel')
}

async function categorizarLote(
  transacoes: { hash_linha: string; descricao: string }[],
  apiKey: string,
  categoriasPermitidas: string[]
): Promise<string[]> {
  const lista = transacoes.map((t, i) => `${i + 1}. ${t.descricao}`).join('\n')

  const prompt = `Categorize cada transação abaixo com UMA das categorias: ${categoriasPermitidas.join(', ')}.

Transações:
${lista}

Retorne um JSON no formato: {"categorias": ["Categoria1", "Categoria2", ...]}
A lista deve ter exatamente ${transacoes.length} itens, na mesma ordem das transações.`

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gemini erro ${res.status}: ${body}`)
  }

  const data = await res.json()
  const texto = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!texto) throw new Error('Resposta vazia da IA')

  const { categorias } = JSON.parse(texto)
  if (!Array.isArray(categorias) || categorias.length !== transacoes.length) {
    throw new Error(
      `Número de categorias retornado (${categorias?.length}) diferente do esperado (${transacoes.length})`
    )
  }

  const fallback = categoriasPermitidas.includes('Outros') ? 'Outros' : categoriasPermitidas[0]
  return categorias.map((c: string) => (categoriasPermitidas.includes(c) ? c : fallback))
}

async function categorizarLoteComRetry(
  transacoes: { hash_linha: string; descricao: string }[],
  apiKey: string,
  categoriasPermitidas: string[],
  maxRetries = 2
): Promise<string[]> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await categorizarLote(transacoes, apiKey, categoriasPermitidas)
    } catch (err) {
      const errStr = String(err)
      const is429 = errStr.includes('429')
      if (!is429 || attempt === maxRetries) throw err
      if (isCotaDiaria(errStr)) throw new Error('COTA_DIARIA_ESGOTADA')
      const waitMs = extrairRetryDelay(errStr)
      console.warn(`[categorizar] 429 recebido, aguardando ${waitMs}ms antes de retry ${attempt + 1}/${maxRetries}`)
      await sleep(waitMs)
    }
  }
  throw new Error('Max retries exceeded')
}

export interface ResultadoCategorizar {
  categorized: number
  total: number
  cotaDiariaEsgotada: boolean
  erros?: string[]
}

/**
 * Categoriza transações via Gemini AI.
 * Se `hashLinhas` for fornecido, categoriza apenas essas transações;
 * caso contrário, categoriza todas as sem categoria ou com origem IA.
 */
export async function categorizarTransacoes(
  supabase: SupabaseClient,
  apiKey: string,
  hashLinhas?: string[]
): Promise<ResultadoCategorizar> {
  const { data: configuracoes } = await supabase
    .from('configuracoes')
    .select('chave, valor')
    .eq('chave', 'categorias_compras')
    .maybeSingle()
  const categoriasPermitidas = parseCategoriasConfig(configuracoes?.valor) || CATEGORIAS_PADRAO

  let query = supabase
    .from('transacoes_nubank')
    .select('hash_linha, descricao')
    .or('categoria.is.null,categoria_origem.eq.IA')

  if (hashLinhas && hashLinhas.length > 0) {
    query = query.in('hash_linha', hashLinhas)
  }

  const { data: transacoes, error } = await query

  if (error) throw new Error(error.message)
  if (!transacoes || transacoes.length === 0) {
    return { categorized: 0, total: 0, cotaDiariaEsgotada: false }
  }

  let totalCategorized = 0
  const erros: string[] = []
  let cotaDiariaEsgotada = false

  for (let i = 0; i < transacoes.length; i += LOTE) {
    if (cotaDiariaEsgotada) break

    const lote = transacoes.slice(i, i + LOTE)
    const numLote = Math.floor(i / LOTE) + 1

    try {
      const categorias = await categorizarLoteComRetry(lote, apiKey, categoriasPermitidas)

      await Promise.all(
        lote.map((t, j) =>
          supabase
            .from('transacoes_nubank')
            .update({
              categoria: categorias[j],
              categoria_origem: 'IA',
              categoria_confianca: CONFIANCA_PADRAO_IA,
            })
            .eq('hash_linha', t.hash_linha)
        )
      )

      totalCategorized += lote.length

      if (i + LOTE < transacoes.length) {
        await sleep(DELAY_ENTRE_LOTES_MS)
      }
    } catch (err) {
      const errStr = String(err)
      if (errStr.includes('COTA_DIARIA_ESGOTADA')) {
        cotaDiariaEsgotada = true
        erros.push(`Cota diária do Gemini esgotada após ${totalCategorized} transações. Tente novamente amanhã.`)
      } else {
        const msg = `Lote ${numLote}: ${errStr}`
        console.error('[categorizar]', msg)
        erros.push(msg)
      }
    }
  }

  return {
    categorized: totalCategorized,
    total: transacoes.length,
    cotaDiariaEsgotada,
    erros: erros.length > 0 ? erros : undefined,
  }
}
