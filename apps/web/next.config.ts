import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@controlai-web/api', '@controlai-web/db', '@controlai-web/shared-types'],
  experimental: {},
};

export default nextConfig;
