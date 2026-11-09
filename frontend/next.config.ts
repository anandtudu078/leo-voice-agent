import type { NextConfig } from 'next'

// Trailing slashes and a duplicated /api suffix are common causes of 404s
// when the backend URL is pasted from a dashboard, so normalise it here.
const backendBase = (
  process.env.NEXT_BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  'http://localhost:8000'
)
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/api$/, '')

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Proxy backend routes (auth, and any other /api/* paths) to the FastAPI
  // backend. In production on Vercel, set NEXT_BACKEND_URL to your
  // deployed backend (e.g. https://leo-backend.vercel.app). Locally it falls
  // back to http://localhost:8000.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendBase}/api/:path*`,
      },
    ]
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
}

export default nextConfig
