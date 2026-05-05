import { SupabaseClient } from '@supabase/supabase-js'

const GEMINI_MODEL = 'gemini-1.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

export const CONFIANCA_VALIDADO = 90

// ── Types ─────────────────────────────────────────────────────────────────

export interface ResultadoClassificacaoRAG {
  categoria: string
  confianca: number
  justificativa: string
}

export interface ClassificacaoAprendida {
  descricao_limpa: string
  categoria_validada: string
  frequencia: number
}

// ── Sanitization ──────────────────────────────────────────────────────────
// Removes card-statement noise: dates, transaction IDs, asterisks, currency.
// Example: "IFOOD *LANCHES 12/05" → "IFOOD LANCHES"
export function sanitizarDescricao(descricao: string): string {
  return descricao
    .toUpperCase()
    // DD/MM, MM/YYYY, DD/MM/YYYY, MM/YY
    .replace(/\b\d{1,2}\/\d{2}(?:\/\d{2,4})?\b/g, '')
    // HH:MM timestamps
    .replace(/\b\d{2}:\d{2}\b/g, '')
    // asterisks (e.g. IFOOD*LANCHES, IFOOD * LANCHES)
    .replace(/\s*\*\s*/g, ' ')
    // long numeric sequences — transaction IDs (≥5 digits)
    .replace(/\b\d{5,}\b/g, '')
    // R$ currency prefix
    .replace(/R\$\s*/gi, '')
    // any remaining non-alphanumeric char except spaces
    .replace(/[^A-Z0-9\s]/g, ' ')
    // collapse runs of whitespace
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Similarity ────────────────────────────────────────────────────────────
// Jaccard similarity over tokens of length ≥ 3 to rank fuzzy candidates.
function calcularSimilaridade(a: string, b: string): number {
  const tokensA = new Set(a.split(' ').filter(t => t.length >= 3))
  const tokensB = new Set(b.split(' ').filter(t => t.length >= 3))
  if (tokensA.size === 0 && tokensB.size === 0) return 1
  const intersection = [...tokensA].filter(t => tokensB.has(t)).length
  const union = new Set([...tokensA, ...tokensB]).size
  return union === 0 ? 0 : intersection / union
}

// ── RAG Context Retrieval ─────────────────────────────────────────────────
// Returns up to `limite` historical classifications ranked by:
//   1. Exact description match (highest priority)
//   2. Fuzzy match via primary-token ILIKE + JS-side Jaccard scoring
export async function buscarContextoRAG(
  supabase: SupabaseClient,
  descricaoLimpa: string,
  userId = 'default',
  limite = 3
): Promise<ClassificacaoAprendida[]> {
  // Exact match
  const { data: exact } = await supabase
    .from('classificacoes_aprendidas')
    .select('descricao_limpa, categoria_validada, frequencia')
    .eq('user_id', userId)
    .eq('descricao_limpa', descricaoLimpa)
    .order('frequencia', { ascending: false })
    .limit(limite)

  if (exact && exact.length > 0) return exact as ClassificacaoAprendida[]

  // Fuzzy: use the first long token (≥4 chars) as a broad filter in Supabase,
  // then re-rank by Jaccard similarity on the JS side.
  const tokens = descricaoLimpa.split(' ').filter(t => t.length >= 4)
  if (tokens.length === 0) return []

  const { data: candidates } = await supabase
    .from('classificacoes_aprendidas')
    .select('descricao_limpa, categoria_validada, frequencia')
    .eq('user_id', userId)
    .ilike('descricao_limpa', `%${tokens[0]}%`)
    .order('frequencia', { ascending: false })
    .limit(20)

  if (!candidates || candidates.length === 0) return []

  return (candidates as ClassificacaoAprendida[])
    .map(m => ({ item: m, score: calcularSimilaridade(descricaoLimpa, m.descricao_limpa) }))
    .sort((a, b) => b.score - a.score || b.item.frequencia - a.item.frequencia)
    .slice(0, limite)
    .map(({ item }) => item)
}

// ── Dynamic Prompt Construction ───────────────────────────────────────────

function construirContextoMemoria(contexto: ClassificacaoAprendida[]): string {
  if (contexto.length === 0) {
    return 'Nenhum histórico disponível para esta transação.'
  }
  return contexto
    .map(c =>
      `- Para "${c.descricao_limpa}", classificado como "${c.categoria_validada}" (${c.frequencia}x confirmado)`
    )
    .join('\n')
}

// Calls Gemini 1.5 Flash with a RAG-enriched prompt.
// Returns categoria, confianca (0–100) and justificativa.
export async function classificarComGemini(
  descricao: string,
  descricaoLimpa: string,
  contexto: ClassificacaoAprendida[],
  apiKey: string,
  categoriasPermitidas: string[]
): Promise<ResultadoClassificacaoRAG> {
  const memoriaContexto = construirContextoMemoria(contexto)

  const prompt = `Você é um classificador de gastos financeiros de cartão de crédito.
Categorize a transação abaixo usando EXATAMENTE UMA das categorias permitidas.

Categorias permitidas: ${categoriasPermitidas.join(', ')}

Histórico de classificações do usuário para transações similares:
${memoriaContexto}

Transação atual: "${descricao}"
Descrição normalizada: "${descricaoLimpa}"

Regras para o campo "confianca" (0–100):
- Correspondência exata no histórico: confiança >= 95
- Correspondência parcial forte (mesmo estabelecimento): confiança 70–89
- Sem histórico relevante, deduzido por contexto: confiança 40–69
- Totalmente incerto: confiança < 40

Retorne APENAS um JSON válido com exatamente estas chaves:
{"categoria": "...", "confianca": 0, "justificativa": "..."}`

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

  const resultado = JSON.parse(texto) as ResultadoClassificacaoRAG

  // Sanitize: keep categoria within the allowed list
  const fallback = categoriasPermitidas.includes('Outros') ? 'Outros' : categoriasPermitidas[0]
  if (!categoriasPermitidas.includes(resultado.categoria)) {
    resultado.categoria = fallback
    resultado.confianca = Math.min(Number(resultado.confianca) || 0, 40)
  }
  resultado.confianca = Math.max(0, Math.min(100, Math.round(Number(resultado.confianca))))

  return resultado
}

// ── Learning Update ───────────────────────────────────────────────────────
// Upserts into classificacoes_aprendidas:
//   - If the (user_id, descricao_limpa) pair exists → update categoria_validada
//     and increment frequencia.
//   - Otherwise → insert with frequencia = 1.
export async function atualizarAprendizado(
  supabase: SupabaseClient,
  descricaoLimpa: string,
  categoriaValidada: string,
  userId = 'default'
): Promise<void> {
  const { data: existing } = await supabase
    .from('classificacoes_aprendidas')
    .select('id, frequencia')
    .eq('user_id', userId)
    .eq('descricao_limpa', descricaoLimpa)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('classificacoes_aprendidas')
      .update({
        categoria_validada: categoriaValidada,
        frequencia: existing.frequencia + 1,
        ultima_atualizacao: new Date().toISOString(),
      })
      .eq('id', existing.id)
  } else {
    await supabase.from('classificacoes_aprendidas').insert({
      user_id: userId,
      descricao_limpa: descricaoLimpa,
      categoria_validada: categoriaValidada,
      frequencia: 1,
    })
  }
}
