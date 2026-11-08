/**
 * POST /api/classificar — mantida por compatibilidade. Usa o mesmo caminho
 * de /api/categorizar (lib/categorizarTransacoes.ts); o classificador antigo
 * desta rota chamava o Gemini 1.5 uma vez por compra.
 *
 * Corpo: { hash_linhas?: string[], somenteSemCategoria?: boolean }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'
import { categorizarTransacoes } from '@/lib/categorizarTransacoes'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const inicio = Date.now()
  const { supabase, unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 })
  }

  let body: { hash_linhas?: unknown; somenteSemCategoria?: unknown } = {}
  try { body = await req.json() } catch { /* corpo vazio é válido */ }
  const hashLinhas = Array.isArray(body.hash_linhas) ? body.hash_linhas.filter((h): h is string => typeof h === 'string') : undefined

  const r = await categorizarTransacoes(supabase, apiKey, {
    hashLinhas,
    modo: body.somenteSemCategoria === true ? 'novas' : 'tudo',
    deadlineMs: inicio + 270_000,
  })
  return NextResponse.json({
    classificados: r.categorized - (r.revisaoPendente ?? 0),
    revisao_pendente: r.revisaoPendente ?? 0,
    total: r.total,
    erros: r.erros,
  })
}
