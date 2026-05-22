import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/serverAuth'

export async function GET(req: NextRequest) {
  const { unauthorized } = await requireAuth(req)
  if (unauthorized) return unauthorized

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 })
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  )

  if (!res.ok) {
    return NextResponse.json({ error: 'Erro ao consultar modelos' }, { status: res.status })
  }

  const data = await res.json()
  const modelos = (data.models ?? []).map((m: { name: string; displayName: string; supportedGenerationMethods: string[] }) => ({
    name: m.name,
    displayName: m.displayName,
    methods: m.supportedGenerationMethods,
  }))

  return NextResponse.json({ modelos })
}
