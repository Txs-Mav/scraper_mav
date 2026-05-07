import LegalPage from "@/components/marketing/legal-page"

export default function DPAPage() {
  return (
    <LegalPage title="DPA / Accord de traitement des données (à préparer)" lastUpdated="7 mai 2026">
      <p>
        Le DPA n'est pas encore présenté comme document final signé. Cette page liste les éléments à préparer avant de vendre à des clients plus grands.
      </p>
      <h2>À inclure</h2>
      <ul>
        <li>Rôles : responsable de traitement / sous-traitant.</li>
        <li>Catégories de données traitées.</li>
        <li>Finalités du traitement.</li>
        <li>Sous-traitants utilisés.</li>
        <li>Mesures de sécurité réelles.</li>
        <li>Processus d'incident.</li>
        <li>Suppression / restitution des données.</li>
      </ul>
      <h2>Statut</h2>
      <p>À rédiger et faire valider légalement avant d'être proposé comme document téléchargeable.</p>
    </LegalPage>
  )
}
