import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const authCookie = req.cookies.get('auth_session')
  const isLoginPage = req.nextUrl.pathname === '/login'

  if (!authCookie && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  if (authCookie && isLoginPage) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon\\.ico|manifest\\.json|icons).*)'],
}
