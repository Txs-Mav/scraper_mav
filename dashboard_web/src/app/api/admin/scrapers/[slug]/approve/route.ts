import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getCurrentUser } from '@/lib/supabase/helpers'
import { isDevAdminUser } from '@/lib/auth/admin'
import { upsertFile, getGitHubConfig } from '@/lib/github/contents'
import {
  generateWorkflowYaml,
  workflowPathForSlug,
} from '@/lib/github/workflow-template'

/**
 * POST /api/admin/scrapers/[slug]/approve
 *
 * Approuve un scraper en attente :
 *   1. validation_status = 'approved', is_active = true
 *   2. Génère et pousse le workflow GitHub Action dédié si absent
 *      (ou met à jour le YAML s'il a changé) — via l'API GitHub Contents.
 *   3. validated_by / validated_at renseignés.
 *
 * Si GITHUB_PAT/GITHUB_REPO ne sont pas configurés, l'approbation Supabase
 * réussit quand même mais on retourne `workflow.skipped: 'env_missing'`
 * pour que le dashboard puisse afficher un avertissement.
 */
export async function POST(
  _req: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  }
  if (!isDevAdminUser(user)) {
    return NextResponse.json({ error: 'Accès réservé aux développeurs' }, { status: 403 })
  }

  const { slug } = await context.params
  const supabase = createServiceClient()

  // 1. Mise à jour Supabase
  const { data, error } = await supabase
    .from('shared_scrapers')
    .update({
      validation_status: 'approved',
      is_active: true,
      validated_by: user.id,
      validated_at: new Date().toISOString(),
      rejection_reason: null,
    })
    .eq('site_slug', slug)
    .select('id, site_slug, site_name, validation_status, is_active, validated_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Scraper introuvable' }, { status: 404 })
  }

  // 2. Génération + push du workflow GitHub Action
  const workflowResult = await ensureWorkflowDeployed({
    slug: data.site_slug,
    siteName: data.site_name,
    triggeredBy: user.email ?? 'admin',
  })

  return NextResponse.json({
    success: true,
    scraper: data,
    workflow: workflowResult,
    message: `${slug} approuvé : sera repris au prochain cycle du cron horaire.`,
  })
}

/**
 * Crée ou met à jour le workflow YAML du scraper sur le repo GitHub.
 * Retourne un objet sérialisable décrivant le résultat (jamais d'exception).
 */
async function ensureWorkflowDeployed(args: {
  slug: string
  siteName: string
  triggeredBy: string
}): Promise<Record<string, unknown>> {
  const cfg = getGitHubConfig()
  if (!cfg) {
    return {
      ok: false,
      skipped: 'env_missing',
      message:
        'GITHUB_PAT/GITHUB_REPO non configurés sur Vercel — workflow non poussé. ' +
        'Le scraper est actif via le cron orchestrateur principal.',
    }
  }

  const path = workflowPathForSlug(args.slug)
  const yaml = generateWorkflowYaml({
    siteSlug: args.slug,
    siteName: args.siteName,
  })

  const result = await upsertFile({
    path,
    content: yaml,
    commitMessage:
      `ci(scraper): deploy workflow for ${args.slug}\n\n` +
      `Auto-généré par /api/admin/scrapers/${args.slug}/approve.\n` +
      `Approuvé par: ${args.triggeredBy}.`,
    config: cfg,
    authorName: 'go-data-dashboard',
    authorEmail: 'dashboard@go-data.ca',
  })

  if (!result.ok) {
    return {
      ok: false,
      skipped: result.reason,
      status: 'status' in result ? result.status : undefined,
      message: result.message,
      path,
      repo: cfg.repo,
      branch: cfg.branch,
    }
  }

  return {
    ok: true,
    action: result.action,
    path: result.path,
    commitSha: result.commitSha?.slice(0, 8),
    commitUrl: result.commitUrl,
    repo: cfg.repo,
    branch: cfg.branch,
  }
}
