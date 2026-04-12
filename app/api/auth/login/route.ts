import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { senha } = await req.json()
  const senhaCorreta = process.env.APP_PASSWORD

  if (!senhaCorreta) {
    return NextResponse.json({ error: 'Senha não configurada no servidor' }, { status: 500 })
  }

  if (senha === senhaCorreta) {
    const response = NextResponse.json({ success: true })
    response.cookies.set('auth_session', 'authenticated', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 dias
      path: '/',
    })
    return response
  }

  return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })
}
