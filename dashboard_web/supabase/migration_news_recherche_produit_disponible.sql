-- Migration : Annonce "Recherche par produit — première version disponible"
-- Suite logique de migration_news_recherche_et_tendances.sql.
-- Cette nouvelle entrée :
--   - s'affiche automatiquement en modal à la prochaine activité de chaque
--     utilisateur (show_in_modal = true)
--   - reste consultable dans /dashboard/news même après "Compris"
--     (la table user_news_reads conserve l'état dismissed par utilisateur).

INSERT INTO news (slug, title, summary, body_md, show_in_modal, is_published)
VALUES (
  'recherche-produit-disponible-v1',
  'La recherche par produit est maintenant disponible',
  'La première version de la recherche par produit est en place sur votre compte. L''optimisation se poursuit dans les prochaines semaines.',
  E'Bonjour,\n\nComme promis dans mon dernier message, la **recherche par produit** est maintenant disponible sur votre compte. Vous pouvez l''essayer dès maintenant depuis la page **Recherche**.\n\n### Ce qui est en place\n\n- **Cherchez par nom, marque ou modèle** ("Honda CRF450R 2024", "Ski-Doo Summit", etc.) — sans configuration préalable.\n- Go-Data interroge en parallèle **vos concurrents déjà configurés** ainsi que plusieurs **sources de marché** (Kijiji, LesPAC, AutoTrader, CycleTrader, MotorcycleDealers).\n- Vous obtenez une liste comparable : **prix, année, kilométrage** et **lien direct** vers chaque annonce.\n\n### À quoi ça sert au quotidien\n\nValider une marge sur le vif, préparer une réponse client, ajuster un prix sans devoir ouvrir dix onglets. L''objectif reste le même : un outil aussi rapide qu''une recherche Google, mais **calibré pour votre marché** et vos comparatifs.\n\n### L''optimisation continue\n\nCette première version est **fonctionnelle, mais perfectible**. Je vais continuer à travailler en arrière-plan, semaine après semaine, sur :\n\n- La **précision du matching** entre votre référence et les annonces concurrentes;\n- La **rapidité** de la recherche (objectif : sous 5 secondes pour les requêtes courantes);\n- La **couverture** (nouveaux marketplaces et concessionnaires selon vos retours);\n- L''**intégration** des résultats dans vos rapports d''analyse.\n\nLes ajustements se font automatiquement, sans manipulation de votre côté. Vous allez simplement voir les résultats devenir plus précis et plus rapides au fil des mises à jour.\n\n---\n\nSi un produit ne ressort pas, qu''un prix semble incorrect, ou que vous avez une idée d''amélioration : **répondez-moi directement**. Vos retours guident concrètement les prochaines optimisations.\n\nMerci pour votre confiance et votre patience pendant cette phase de mise en service.\n\n— **Maverick Menard**, fondateur Go-Data\n📧 gestion@go-data.co',
  true,
  true
)
ON CONFLICT (slug) DO NOTHING;
