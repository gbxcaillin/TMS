import type { NextConfig } from 'next';

// In production cloudflared routes /api/* straight to the API service.
// In development (and if you serve everything through Next) this rewrite proxies it.
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@tms/shared'],
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
