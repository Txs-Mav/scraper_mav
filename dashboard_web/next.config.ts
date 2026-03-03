import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.powergo.ca',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'imagescdn.d2cmedia.ca',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'carimages.d2cmedia.ca',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // Timeout étendu pour les routes qui déclenchent le scraping Python (alertes cron)
  serverExternalPackages: ['child_process'],
};

export default nextConfig;
