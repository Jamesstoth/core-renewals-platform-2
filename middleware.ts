import { NextResponse, type NextRequest } from 'next/server'

// Auth bypass — let all requests through (re-enable later by restoring the
// Supabase session check that was here before).
export async function middleware(request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
