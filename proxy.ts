import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_anon_key ??
  'placeholder-key'

const AUTH_CHECK_TIMEOUT_MS = 3000

export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: { headers: req.headers } })

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
  } catch {
    // Em caso de timeout/falha de rede, não bloquear navegação.
  }

  return res
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon\\.ico|manifest\\.json|icons).*)'],
}
