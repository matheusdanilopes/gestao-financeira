import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 })
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  )

  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: err }, { status: res.status })
  }

  const data = await res.json()
  const modelos = (data.models ?? []).map((m: { name: string; displayName: string; supportedGenerationMethods: string[] }) => ({
    name: m.name,
    displayName: m.displayName,
    methods: m.supportedGenerationMethods,
  }))

  return NextResponse.json({ modelos })
}
