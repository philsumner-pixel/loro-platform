/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/brand-identity',
        destination: '/brand-identity.html',
      },
    ]
  },
}
module.exports = nextConfig
