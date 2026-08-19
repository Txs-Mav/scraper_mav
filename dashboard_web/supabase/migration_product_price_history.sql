-- ============================================================================
-- Historique de prix par unité — table + trigger sur scraped_site_data
-- Issue : https://github.com/Txs-Mav/scraper_mav/issues/1
-- À appliquer via le SQL Editor Supabase (DDL manuel).
--
-- Principe : à chaque upsert de scraped_site_data (7 writers différents),
-- le trigger diffe OLD.products vs NEW.products par unité physique et insère
-- les changements de prix dans product_price_history. Une unité absente du
-- nouveau scrape n'écrit RIEN (un scrape partiel ne pollue pas l'historique).
--
-- Cascade unit_key (IDENTIQUE à scraper_ai/grouping.py::compute_unit_key et
-- à detectChanges côté TS — ne pas modifier un seul des trois) :
--   vin (>= 10 car.) → inventaire → ID de fin d'URL → URL complète
--   → substr(md5(lower(nom)|lower(couleur)), 1, 12)
-- ============================================================================

create table if not exists product_price_history (
  id bigint generated always as identity primary key,
  site_domain text not null,
  unit_key text not null,
  inventaire text,
  source_url text,
  product_name text not null,
  marque text,
  modele text,
  annee int,
  etat text,
  prix numeric not null,
  prix_precedent numeric,          -- null = baseline (première apparition)
  change_type text not null check (change_type in ('baseline', 'price_change')),
  scraped_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_pph_site_unit
  on product_price_history (site_domain, unit_key, scraped_at desc);
create index if not exists idx_pph_scraped
  on product_price_history (scraped_at desc);

-- Lecture par la clé service uniquement (rapports côté serveur).
alter table product_price_history enable row level security;

-- ----------------------------------------------------------------------------
-- Expansion d'un tableau products en unités physiques.
-- Produit avec units[] (multi-unités, posé par scraper_ai/grouping.py)
--   → une ligne par élément de units[], unit_key déjà calculé.
-- Produit sans units[] → le produit EST l'unité, unit_key recalculé ici
--   avec la même cascade que compute_unit_key().
-- ----------------------------------------------------------------------------
create or replace function fn_pph_expand_units(products jsonb)
returns table (
  unit_key text,
  inventaire text,
  source_url text,
  product_name text,
  marque text,
  modele text,
  annee int,
  etat text,
  prix numeric
)
language sql
immutable
as $$
  with base as (
    select p from jsonb_array_elements(coalesce(products, '[]'::jsonb)) as p
  ),
  expanded as (
    -- Multi-unités : units[] porte unit_key/prix/sourceUrl par unité
    select
      u->>'unit_key'                                as unit_key,
      u->>'inventaire'                              as inventaire,
      u->>'sourceUrl'                               as source_url,
      p->>'name'                                    as product_name,
      p->>'marque'                                  as marque,
      p->>'modele'                                  as modele,
      nullif(p->>'annee', '')::int                  as annee,
      p->>'etat'                                    as etat,
      case when u->>'prix' ~ '^-?[0-9.]+$'
           then (u->>'prix')::numeric end           as prix
    from base, jsonb_array_elements(p->'units') as u
    where jsonb_typeof(p->'units') = 'array'

    union all

    -- Mono-unité : cascade vin → inventaire → ID URL → URL → md5(nom|couleur)
    select
      coalesce(
        case when length(trim(upper(coalesce(p->>'vin', '')))) >= 10
             then trim(upper(p->>'vin')) end,
        nullif(trim(coalesce(p->>'inventaire', '')), ''),
        lower((regexp_match(rtrim(coalesce(p->>'sourceUrl', ''), '/'),
                            '-([a-zA-Z]{0,8}[0-9]{1,10})$'))[1]),
        nullif(rtrim(coalesce(p->>'sourceUrl', ''), '/'), ''),
        substr(md5(lower(trim(coalesce(p->>'name', ''))) || '|' ||
                   lower(trim(coalesce(p->>'couleur', '')))), 1, 12)
      )                                             as unit_key,
      p->>'inventaire'                              as inventaire,
      p->>'sourceUrl'                               as source_url,
      p->>'name'                                    as product_name,
      p->>'marque'                                  as marque,
      p->>'modele'                                  as modele,
      nullif(p->>'annee', '')::int                  as annee,
      p->>'etat'                                    as etat,
      case when p->>'prix' ~ '^-?[0-9.]+$'
           then (p->>'prix')::numeric end           as prix
    from base
    where jsonb_typeof(p->'units') is distinct from 'array'
  )
  select distinct on (unit_key) *
  from expanded
  where unit_key is not null and product_name is not null
$$;

-- ----------------------------------------------------------------------------
-- Trigger : diff OLD/NEW à chaque écriture réussie de scraped_site_data.
-- ----------------------------------------------------------------------------
create or replace function fn_product_price_history()
returns trigger
language plpgsql
as $$
declare
  v_scraped_at timestamptz;
begin
  -- Seules les écritures réussies portent un nouveau tableau de produits.
  if new.status is distinct from 'success' or new.products is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.products is not distinct from old.products then
    return new;
  end if;

  v_scraped_at := coalesce(new.scraped_at, now());

  insert into product_price_history
    (site_domain, unit_key, inventaire, source_url, product_name,
     marque, modele, annee, etat, prix, prix_precedent, change_type, scraped_at)
  select
    new.site_domain,
    n.unit_key, n.inventaire, n.source_url, n.product_name,
    n.marque, n.modele, n.annee, n.etat,
    n.prix,
    case when o.unit_key is null or o.prix is null then null else o.prix end,
    case when o.unit_key is null or o.prix is null then 'baseline' else 'price_change' end,
    v_scraped_at
  from fn_pph_expand_units(new.products) n
  left join fn_pph_expand_units(
    case when tg_op = 'UPDATE' then old.products else null end
  ) o using (unit_key)
  where n.prix is not null
    and n.prix >= 1                                   -- MIN_VALID_PRICE
    and (
      o.unit_key is null                              -- unité jamais vue → baseline
      or o.prix is null                               -- prix connu pour la 1re fois → baseline
      or o.prix <> n.prix                             -- vrai changement → price_change
    );
  -- Une unité présente dans OLD mais absente de NEW n'écrit rien :
  -- un scrape partiel ne doit pas fabriquer d'événement.

  return new;
end;
$$;

drop trigger if exists trg_product_price_history on scraped_site_data;
create trigger trg_product_price_history
  after insert or update on scraped_site_data
  for each row
  execute function fn_product_price_history();

-- ----------------------------------------------------------------------------
-- Baseline initiale : enregistrer l'état actuel du cache comme point de départ
-- (sinon le premier vrai changement de chaque unité passerait pour une baseline).
-- ----------------------------------------------------------------------------
insert into product_price_history
  (site_domain, unit_key, inventaire, source_url, product_name,
   marque, modele, annee, etat, prix, prix_precedent, change_type, scraped_at)
select
  s.site_domain,
  n.unit_key, n.inventaire, n.source_url, n.product_name,
  n.marque, n.modele, n.annee, n.etat,
  n.prix, null, 'baseline', coalesce(s.scraped_at, now())
from scraped_site_data s
cross join lateral fn_pph_expand_units(s.products) n
where s.status = 'success'
  and s.products is not null
  and n.prix is not null and n.prix >= 1;

-- ----------------------------------------------------------------------------
-- Contrôles post-application
-- ----------------------------------------------------------------------------
-- 1. Volume de la baseline (attendu : ~13-14k lignes, une par unité) :
--    select change_type, count(*) from product_price_history group by 1;
-- 2. Les unités multi de motosillimitees sont bien éclatées :
--    select unit_key, prix from product_price_history
--    where site_domain = 'motosillimitees.com' and product_name ilike '%himalayan 450 2025%';
-- 3. Après le prochain cron (2 h), vérifier qu'un passage SANS changement
--    n'a rien inséré :
--    select count(*) from product_price_history where change_type = 'price_change';
