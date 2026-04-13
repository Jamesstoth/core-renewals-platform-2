export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    // Protect everything except login, auth API, static files, and Next.js internals
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
