import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const appDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Verrouille la racine Turbopack et le file tracing sur `dashboard_web/`
  // pour éviter toute mauvaise détection si un lockfile orphelin réapparaît
  // un jour dans un dossier parent.
  turbopack: {
    root: appDir,
  },
  outputFileTracingRoot: appDir,
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
