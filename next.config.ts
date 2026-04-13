import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // No caching on Vercel — every page load hits Supabase directly
  experimental: {},
}

export default nextConfig
