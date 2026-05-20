import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { AUTH_DISABLED } from '@/lib/authConfig'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_anon_key ??
  'placeholder-key'

// 3 s era curto demais para iOS PWA ao acordar do background e redes 3G lentas,
// causando redirect para /login mesmo com sessão válida.
const AUTH_CHECK_TIMEOUT_MS = 8000

export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: { headers: req.headers } })

  if (AUTH_DISABLED) {
    return res
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
        res = NextResponse.next({ request: req })
        cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
      },
    },
  })

  const isLoginPage = req.nextUrl.pathname === '/login'

  try {
    const authPromise = supabase.auth.getUser()
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), AUTH_CHECK_TIMEOUT_MS)
    })

    const {
      data: { user },
    } = await Promise.race([authPromise, timeoutPromise])

    if (user && isLoginPage) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    if (!user && !isLoginPage) {
      return NextResponse.redirect(new URL('/login', req.url))
    }
  } catch {
    // Em timeout ou falha de rede: se houver cookie de sessão Supabase, deixa passar.
    // O client-side detectará sessão expirada e redirecionará se necessário.
    // Sem cookie de sessão = usuário nunca autenticou = redireciona para login.
    const hasAuthCookie = req.cookies.getAll().some(c => c.name.startsWith('sb-'))
    if (!isLoginPage && !hasAuthCookie) {
      return NextResponse.redirect(new URL('/login', req.url))
    }
  }

  return res
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon\\.ico|manifest\\.json|icons).*)'],
}
