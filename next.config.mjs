const headers = [
  {key: 'X-Content-Type-Options', value: 'nosniff'},
  {key: 'X-Frame-Options', value: 'DENY'},
  {key: 'Referrer-Policy', value: 'same-origin'},
  {key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()'},
];
export default {
  output: 'standalone',
  images: {unoptimized: true},
  poweredByHeader: false,
  serverExternalPackages: ['node:sqlite'],
  experimental: {cpus: 2},
  outputFileTracingIncludes: {'/*': ['./drizzle/*.sql']},
  async headers() {
    return [{source: '/:path*', headers}];
  },
};
