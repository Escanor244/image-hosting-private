import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Don't advertise the framework on a host whose whole job is to say as little as
  // possible to anyone who isn't an allowed embed.
  poweredByHeader: false,
}

export default nextConfig
