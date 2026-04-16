import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

// Makes CF bindings (env, secrets, KV, etc.) available to `next dev`.
// No-op in production builds.
initOpenNextCloudflareForDev()

const nextConfig: NextConfig = {
  experimental: {},
}

export default nextConfig
