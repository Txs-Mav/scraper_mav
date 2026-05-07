import LegalPage from "@/components/marketing/legal-page"

export default function SLAPage() {
  return (
    <LegalPage title="SLA (à cadrer)" lastUpdated="7 mai 2026">
      <p>
        Aucun engagement d'uptime chiffré ne doit être publié sans monitoring réel, historique vérifiable et capacité contractuelle.
      </p>
      <h2>Avant de publier un SLA</h2>
      <ul>
        <li>Brancher une page status réelle.</li>
        <li>Mesurer l'uptime sur une période suffisante.</li>
        <li>Définir les exclusions et fenêtres de maintenance.</li>
        <li>Définir les crédits de service avec un juriste.</li>
        <li>Valider les dépendances Supabase, Vercel, Stripe et autres fournisseurs.</li>
      </ul>
      <h2>Statut actuel</h2>
      <p>Page préparatoire. Ne pas présenter comme SLA contractuel actif.</p>
    </LegalPage>
  )
}
