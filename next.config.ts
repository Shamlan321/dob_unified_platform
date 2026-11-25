import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // better-sqlite3 is a native Node.js module — it must not be bundled by webpack.
  // Marking it as external ensures Next.js uses the pre-built .node binary.
  serverExternalPackages: ['better-sqlite3'],
  allowedDevOrigins: [
    '192.168.219.100',
    '192.168.*.*',
    '10.*.*.*',
    '172.*.*.*',
    '*.*.*.*',
    '**.*',
  ],
}

export default nextConfig
