import LegalPage from "@/components/marketing/legal-page"

export default function TermsPage() {
  return (
    <LegalPage title="Conditions d'utilisation (brouillon)" lastUpdated="7 mai 2026">
      <p>
        Ce document est une base de travail. Il ne remplace pas des conditions rédigées ou validées par un juriste.
      </p>
      <h2>Utilisation acceptable</h2>
      <p>Go-Data doit être utilisé pour collecter et analyser des données publiques dans le respect des lois applicables et des conditions des sites consultés.</p>
      <h2>Compte et sécurité</h2>
      <p>L'utilisateur est responsable de la sécurité de son compte et de l'exactitude des informations fournies.</p>
      <h2>Abonnement</h2>
      <p>Les plans affichés doivent correspondre aux offres réellement vendues. Les offres à venir doivent être clairement indiquées comme telles.</p>
      <h2>Données</h2>
      <p>Le client conserve ses données. Go-Data doit préciser les règles d'export, de suppression et de conservation.</p>
      <h2>À valider</h2>
      <ul>
        <li>Droit applicable.</li>
        <li>Responsabilités liées au scraping.</li>
        <li>Limitation de responsabilité.</li>
        <li>Règles de remboursement / annulation.</li>
      </ul>
    </LegalPage>
  )
}
