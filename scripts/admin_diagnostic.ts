import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://nvvvtlbfhiwffnrrtgfg.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Set SUPABASE_SERVICE_ROLE_KEY env var");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findStaleUsers() {
  console.log("\n=== UTILISATEURS AVEC SCRAPINGS ANCIENS ===\n");

  const { data: configs } = await supabase
    .from("scraper_config")
    .select("user_id, reference_url, competitor_urls");

  if (!configs || configs.length === 0) {
    console.log("Aucun utilisateur avec config");
    return;
  }

  for (const config of configs) {
    const { data: scrapings } = await supabase
      .from("scrapings")
      .select("id, created_at, updated_at, reference_url, mode")
      .eq("user_id", config.user_id)
      .order("created_at", { ascending: false })
      .limit(1);

    const lastScraping = scrapings?.[0];
    let ageHours = "N/A";
    if (lastScraping) {
      const age =
        Date.now() - new Date(lastScraping.updated_at || lastScraping.created_at).getTime();
      ageHours = (age / 3600000).toFixed(1);
    }

    const { data: alert } = await supabase
      .from("scraper_alerts")
      .select("id, is_active, last_run_at")
      .eq("user_id", config.user_id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const { data: userData } = await supabase.auth.admin.getUserById(config.user_id);

    console.log(`👤 ${userData?.user?.email || "email?"}`);
    console.log(`   ID: ${config.user_id}`);
    console.log(`   Référence: ${config.reference_url}`);
    console.log(`   Concurrents: ${(config.competitor_urls || []).length}`);
    console.log(`   Dernier scraping: il y a ${ageHours}h`);
    console.log(`   Alerte active: ${alert ? `oui (last_run: ${alert.last_run_at})` : "NON"}`);
    console.log();
  }
}

async function diagnoseUser(userId: string) {
  console.log(`\n=== DIAGNOSTIC COMPLET POUR ${userId.slice(0, 8)}... ===\n`);

  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  console.log(`Email: ${userData?.user?.email}`);

  const { data: config } = await supabase
    .from("scraper_config")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  console.log("\n📋 Config:", JSON.stringify(config, null, 2));

  const { data: alerts } = await supabase
    .from("scraper_alerts")
    .select("id, is_active, reference_url, last_run_at, schedule_interval_minutes")
    .eq("user_id", userId);
  console.log("\n🔔 Alertes:", JSON.stringify(alerts, null, 2));

  if (config?.reference_url) {
    const safeDomain = (url: string) => {
      try {
        const u = url.startsWith("http") ? url : `https://${url}`;
        return new URL(u).hostname.replace("www.", "");
      } catch { return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]; }
    };
    const refDomain = safeDomain(config.reference_url);
    const competitors = (config.competitor_urls || []).map((u: string) => safeDomain(u));
    const allDomains = [refDomain, ...competitors];

    console.log("\n🌐 Cache scraped_site_data pour les sites configurés:");
    for (const domain of allDomains) {
      const { data: cache } = await supabase
        .from("scraped_site_data")
        .select("site_domain, status, scraped_at, product_count, error_message")
        .eq("site_domain", domain)
        .maybeSingle();
      if (cache) {
        const age = cache.scraped_at
          ? ((Date.now() - new Date(cache.scraped_at).getTime()) / 3600000).toFixed(1)
          : "N/A";
        console.log(
          `   ${cache.status === "success" ? "✅" : "❌"} ${domain}: ` +
            `${cache.product_count} produits, status=${cache.status}, ` +
            `scraped il y a ${age}h` +
            (cache.error_message ? ` — err: ${cache.error_message}` : "")
        );
      } else {
        console.log(`   ❌ ${domain}: AUCUN CACHE (jamais scrapé)`);
      }
    }

    console.log("\n🔧 Shared scrapers pour ces domaines:");
    for (const domain of allDomains) {
      const { data: scraper } = await supabase
        .from("shared_scrapers")
        .select("id, site_name, is_active, site_slug")
        .eq("site_domain", domain)
        .maybeSingle();
      if (scraper) {
        console.log(
          `   ${scraper.is_active ? "✅" : "⛔"} ${domain}: ` +
            `${scraper.site_name} (slug: ${scraper.site_slug}, active: ${scraper.is_active})`
        );
      } else {
        console.log(`   ⛔ ${domain}: PAS dans shared_scrapers`);
      }
    }
  }

  const { data: scrapings } = await supabase
    .from("scrapings")
    .select("id, created_at, reference_url, mode, metadata")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("\n📊 5 derniers scrapings:");
  for (const s of scrapings || []) {
    const age = ((Date.now() - new Date(s.created_at).getTime()) / 3600000).toFixed(1);
    console.log(
      `   ${s.id.slice(0, 8)}... il y a ${age}h — mode=${s.mode} ref=${s.reference_url}`
    );
  }
}

async function generateMagicLink(email: string) {
  console.log(`\n=== MAGIC LINK POUR ${email} ===\n`);

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: "https://go-data-dashboard.vercel.app/dashboard",
    },
  });

  if (error) {
    console.error("❌ Erreur:", error.message);
    return;
  }

  console.log("✅ Magic link généré:");
  console.log(`   ${data.properties?.action_link}`);
  console.log("\n⚠️  Ce lien est à usage unique et expire rapidement.");
}

async function setTempPassword(userId: string, tempPassword: string) {
  console.log(`\n=== MOT DE PASSE TEMPORAIRE POUR ${userId.slice(0, 8)}... ===\n`);

  const { data, error } = await supabase.auth.admin.updateUserById(userId, {
    password: tempPassword,
  });

  if (error) {
    console.error("❌ Erreur:", error.message);
    return;
  }

  console.log(`✅ Mot de passe temporaire défini pour ${data.user?.email}`);
  console.log(`   Mot de passe: ${tempPassword}`);
  console.log("\n⚠️  IMPORTANT: Remettre le mot de passe original après diagnostic!");
}

// ─── Main ───
const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

switch (command) {
  case "list":
    findStaleUsers().catch(console.error);
    break;
  case "diagnose":
    if (!arg1) { console.error("Usage: diagnose <user_id>"); process.exit(1); }
    diagnoseUser(arg1).catch(console.error);
    break;
  case "magic-link":
    if (!arg1) { console.error("Usage: magic-link <email>"); process.exit(1); }
    generateMagicLink(arg1).catch(console.error);
    break;
  case "set-password":
    if (!arg1 || !arg2) { console.error("Usage: set-password <user_id> <temp_password>"); process.exit(1); }
    setTempPassword(arg1, arg2).catch(console.error);
    break;
  default:
    console.log("Commandes disponibles:");
    console.log("  list                           — Lister tous les utilisateurs et leur état");
    console.log("  diagnose <user_id>             — Diagnostic complet d'un utilisateur");
    console.log("  magic-link <email>             — Générer un magic link de connexion");
    console.log("  set-password <user_id> <pass>  — Définir un mot de passe temporaire");
}
