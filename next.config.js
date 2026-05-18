/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },

  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error', 'warn'] }
      : false,
  },

  experimental: {
    // Tree-shakes heavy icon/date libraries — reduz bundle inicial significativamente
    optimizePackageImports: ['lucide-react', 'date-fns', 'chart.js', 'react-chartjs-2'],
  },
}

module.exports = nextConfig
