-- Migration : Nouvelle annonce "Recherche produit + Activité selon les concurrents"
-- Ajoute une entrée dans la table `news` qui :
--   - s'affiche automatiquement en modal au retour de l'utilisateur (show_in_modal = true)
--   - reste consultable dans /dashboard/news même après "X" (cf. user_news_reads)

INSERT INTO news (slug, title, summary, body_md, show_in_modal, is_published)
VALUES (
  'recherche-produit-et-activite-concurrents-v1',
  'Bientôt : recherche par produit + nouveau tableau Activité selon les concurrents',
  'Un aperçu de ce qui s''en vient (recherche par produit sans configuration) et un nouveau tableau dans Analyse pour suivre l''activité de chaque concurrent.',
  E'Bonjour,\n\nJ''espère que tout se passe bien de votre côté. Je voulais prendre une minute pour vous parler directement de deux choses : **une fonctionnalité majeure qui s''en vient** et **un nouveau tableau** que vous allez retrouver dès maintenant dans la page **Analyse**.\n\n### Bientôt — Recherche par produit, sans configuration préalable\n\nAujourd''hui, pour comparer les prix, il faut d''abord configurer chaque site concurrent. C''est précis, mais ça demande du temps.\n\n**Très prochainement**, vous pourrez simplement **chercher un produit par nom ou par modèle** et obtenir instantanément les prix pratiqués chez vos concurrents — **sans avoir à configurer quoi que ce soit au préalable**. Vous tapez le produit, Go-Data s''occupe du reste.\n\nL''idée : vous offrir un outil aussi rapide qu''une recherche Google, mais **calibré pour votre marché** et vos comparatifs prix. Idéal pour valider une marge sur le vif, préparer une réponse client ou ajuster une stratégie de prix sans ouvrir dix onglets.\n\nJe vous tiens au courant dès que c''est prêt à être activé sur votre compte.\n\n### Nouveau — Tableau « Activité selon les concurrents » dans Analyse\n\nDans la page **Analyse**, vous trouverez un nouveau tableau qui affiche l''**évolution des prix de chaque concurrent dans le temps**, côte à côte avec votre prix de référence et le prix moyen du marché.\n\nConcrètement, vous pouvez maintenant :\n- **Visualiser** d''un coup d''œil quels concurrents bougent leurs prix, et à quelle fréquence;\n- **Choisir la granularité** (jour, semaine, mois) pour repérer les tendances de fond ou les ajustements ponctuels;\n- **Comparer** votre positionnement à celui de chaque enseigne, plutôt qu''à une moyenne globale.\n\nC''est l''outil que je vous recommande dès qu''une concession bouge ses prix de façon inhabituelle — vous voyez tout de suite si c''est une vraie tendance ou un ajustement isolé.\n\n---\n\nComme toujours, **n''hésitez pas à me répondre directement** si vous avez une question, une suggestion, ou si quelque chose ne fonctionne pas comme attendu. Je lis chaque message personnellement.\n\nMerci pour votre confiance,\n\n— **Maverick Menard**, fondateur Go-Data\n📧 gestion@go-data.co',
  true,
  true
)
ON CONFLICT (slug) DO NOTHING;
