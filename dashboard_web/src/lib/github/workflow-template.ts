/**
 * Génération du YAML d'un workflow GitHub Action dédié à un scraper.
 *
 * IMPORTANT : ce module DOIT rester synchronisé avec son homologue Python
 * `scraper_ai/scraper_usine/workflow_generator.py`. Les deux produisent le
 * même YAML — l'un est utilisé par scraper_usine au moment de la génération,
 * l'autre par l'API d'approbation du dashboard pour les scrapers créés
 * manuellement (sans passer par scraper_usine).
 */

import { createHash } from 'crypto'

export const WORKFLOWS_DIR = '.github/workflows'
export const WORKFLOW_TIMEOUT_MINUTES = 30

/**
 * Retourne une expression cron horaire avec une minute déterministe dérivée
 * du slug, pour étaler les workflows sur l'heure et éviter les pics
 * Supabase. Évite les minutes 0 (cron Vercel) et 30 (workflow Morin Sports
 * historique) afin de réduire les collisions.
 */
export function deriveCronSchedule(siteSlug: string): string {
  const hex = createHash('sha1').update(siteSlug, 'utf-8').digest('hex')
  let minute = parseInt(hex.slice(0, 8), 16) % 60
  if (minute === 0 || minute === 30) {
    minute = (minute + 13) % 60
  }
  return `${minute} * * * *`
}

/**
 * Retourne le chemin du fichier workflow pour un slug donné.
 * Sanitize le slug : caractères non-alphanumériques → '-'.
 */
export function workflowPathForSlug(siteSlug: string): string {
  const safe = siteSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
  return `${WORKFLOWS_DIR}/scraper-${safe}.yml`
}

/**
 * Retourne le contenu YAML du workflow pour un scraper.
 *
 * Le YAML produit DOIT être identique à celui généré par
 * `workflow_generator.py` côté Python.
 */
export function generateWorkflowYaml(args: {
  siteSlug: string
  siteName: string
  cronSchedule?: string
}): string {
  const cronSchedule = args.cronSchedule || deriveCronSchedule(args.siteSlug)

  const safeName = args.siteName.replace(/\n/g, ' ').trim()
  const needsQuote = /[:#&*!|>'"%@`]/.test(safeName)
  const nameField = needsQuote
    ? `'Scraping ${safeName.replace(/'/g, "''")} (horaire)'`
    : `Scraping ${safeName} (horaire)`

  // Les ${{ }} GitHub Actions sont gardés tels quels (pas de string template ici).
  return `name: ${nameField}

# Cron horaire DÉDIÉ à ${safeName}.
#
# Auto-généré par scraper_usine.workflow_generator. Ne pas éditer à la main :
# régénérer via \`python -m scraper_ai.scraper_usine.main <url>\` ou via
# l'API d'approbation \`/api/admin/scrapers/${args.siteSlug}/approve\` du dashboard.
#
# Le script \`scrape_single_site.py\` skip automatiquement si le cache Supabase
# est < 55 min — donc aucun risque de doublon avec le cron orchestrateur
# global qui tourne à HH:00.

on:
  schedule:
    - cron: '${cronSchedule}'
  workflow_dispatch:
    inputs:
      force:
        description: "Ignorer le cache de fraîcheur (--force)"
        type: boolean
        default: false

concurrency:
  group: scraper-${args.siteSlug}
  cancel-in-progress: false

jobs:
  scrape:
    runs-on: ubuntu-latest
    timeout-minutes: ${WORKFLOW_TIMEOUT_MINUTES}

    steps:
      - name: Checkout du repo
        uses: actions/checkout@v5

      - name: Setup Python
        uses: actions/setup-python@v6
        with:
          python-version: '3.11'
          cache: 'pip'
          cache-dependency-path: scraper_ai/requirements.txt

      - name: Installer les dépendances Python
        run: |
          pip install -r scraper_ai/requirements.txt
          pip install requests supabase

      - name: Scraping ${safeName}
        env:
          SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: \${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          NEXT_PUBLIC_SUPABASE_URL: \${{ secrets.SUPABASE_URL }}
        run: |
          python scripts/scrape_single_site.py \\
            --slug ${args.siteSlug} \\
            \${{ inputs.force && '--force' || '' }}
`
}
