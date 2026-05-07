import LegalPage from "@/components/marketing/legal-page"

export default function PrivacyPolicyPage() {
  return (
    <LegalPage title="Politique de confidentialité (brouillon)" lastUpdated="7 mai 2026">
      <p>
        Cette page est un brouillon à faire valider juridiquement avant publication commerciale forte. Elle doit refléter uniquement les traitements de données réellement effectués par Go-Data.
      </p>
      <h2>Données susceptibles d'être traitées</h2>
      <ul>
        <li>Données de compte : nom, email, préférences.</li>
        <li>Données produit : configurations de scraping, résultats, exports.</li>
        <li>Données de paiement : traitées par Stripe.</li>
        <li>Données techniques : logs, erreurs, informations nécessaires au fonctionnement.</li>
      </ul>
      <h2>Finalités</h2>
      <p>Fournir le service, gérer les comptes, traiter les paiements, améliorer le produit et répondre au support.</p>
      <h2>Services utilisés</h2>
      <p>Supabase, Stripe, Resend et Vercel sont visibles dans le projet. Les régions, durées de conservation et responsabilités exactes doivent être confirmées.</p>
      <h2>Droits</h2>
      <p>Les utilisateurs doivent pouvoir demander l'accès, l'export ou la suppression de leurs données en écrivant à <a href="mailto:gestion@go-data.co">gestion@go-data.co</a>.</p>
      <h2>À faire avant publication</h2>
      <ul>
        <li>Valider le texte avec une ressource juridique.</li>
        <li>Confirmer les sous-traitants et régions.</li>
        <li>Confirmer les durées de conservation.</li>
        <li>Relier la page aux réglages de suppression/export du compte.</li>
      </ul>
    </LegalPage>
  )
}
