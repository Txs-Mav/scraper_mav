"""
Test de connexion à Vertex AI
"""
import vertexai
from vertexai.generative_models import GenerativeModel

# Valeurs à ajuster si ton projet/région sont différents
PROJECT_ID = "go-data-485202"  # ID du projet (pas le nom "Mav1")

# Endpoint global = meilleure disponibilité (google-cloud-aiplatform >= 1.79.0 requis)
# Sinon utiliser "us-central1" ou "northamerica-northeast1"
LOCATION = "global"

print("Initialisation de Vertex AI (endpoint global)...")
vertexai.init(project=PROJECT_ID, location=LOCATION)

print("Chargement du modèle Gemini...")
model = GenerativeModel("gemini-2.0-flash-001")

print("Envoi d'une requête test...")
response = model.generate_content("Réponds en une courte phrase : Vertex AI fonctionne !")

print("\nRéponse reçue:")
print(response.text)
print("\n✅ Vertex AI est correctement configuré !")
