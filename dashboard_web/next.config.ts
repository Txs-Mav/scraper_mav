import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ferf1mheo22r9ira.public.blob.vercel-storage.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.powergo.ca',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // Timeout étendu pour les routes qui déclenchent le scraping Python (alertes cron)
  serverExternalPackages: ['child_process'],
};

export default nextConfig;
