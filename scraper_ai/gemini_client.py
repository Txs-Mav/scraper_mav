"""
Client Gemini pour les appels API
Supporte Vertex AI (production) et Google AI API (dev)
"""
import json
import re
from typing import Dict, Optional, Any

try:
    from .config import (
        AI_PROVIDER, MODEL_ANALYSIS, MODEL_EXTRACTION,
        GCP_PROJECT_ID, GCP_LOCATION, GEMINI_API_KEY
    )
except ImportError:
    from config import (
        AI_PROVIDER, MODEL_ANALYSIS, MODEL_EXTRACTION,
        GCP_PROJECT_ID, GCP_LOCATION, GEMINI_API_KEY
    )


class GeminiClient:
    """Client pour les appels à l'API Gemini (Vertex AI ou Google AI API)"""

    def __init__(self):
        self._call_count = 0
        self.provider = AI_PROVIDER
        
        if self.provider == "vertex":
            self._init_vertex_ai()
        else:
            self._init_genai()
    
    def _init_vertex_ai(self):
        """Initialise le client Vertex AI"""
        import vertexai
        from vertexai.generative_models import GenerativeModel
        
        print(f"🚀 Initialisation Vertex AI (Projet: {GCP_PROJECT_ID}, Région: {GCP_LOCATION})")
        vertexai.init(project=GCP_PROJECT_ID, location=GCP_LOCATION)
        
        # Pré-charger les modèles
        self._models = {
            MODEL_ANALYSIS: GenerativeModel(MODEL_ANALYSIS),
            MODEL_EXTRACTION: GenerativeModel(MODEL_EXTRACTION),
        }
        print(f"✅ Vertex AI initialisé avec succès")
    
    def _init_genai(self):
        """Initialise le client Google AI API (dev)"""
        from google import genai
        
        print(f"🔧 Initialisation Google AI API (Mode développement)")
        self.client = genai.Client(api_key=GEMINI_API_KEY)
        print(f"✅ Google AI API initialisé avec succès")

    def call(self, prompt: Any, schema: Optional[Dict] = None, 
             show_prompt: bool = True, model: str = None,
             response_mime_type: str = "application/json") -> Dict:
        """Appelle l'API Gemini avec le prompt et le schéma

        Args:
            prompt: Le prompt à envoyer
            schema: Le schéma JSON attendu
            show_prompt: Afficher le prompt dans les logs
            model: Modèle à utiliser (par défaut MODEL_ANALYSIS)
            response_mime_type: Type MIME de la réponse
        """
        model_to_use = model or MODEL_ANALYSIS
        
        if show_prompt:
            self._log_prompt(prompt, schema, model_to_use)

        try:
            if self.provider == "vertex":
                result_text = self._call_vertex_ai(prompt, schema, model_to_use, response_mime_type)
            else:
                result_text = self._call_genai(prompt, schema, model_to_use, response_mime_type)

            self._call_count += 1

            if show_prompt:
                self._log_response(result_text)

            # Nettoyer le JSON (enlever les markdown code blocks si présents)
            if result_text.startswith('```'):
                result_text = re.sub(r'^```(?:json)?\s*\n', '', result_text)
                result_text = re.sub(r'\n```\s*$', '', result_text)

            return json.loads(result_text)

        except json.JSONDecodeError as e:
            print(f"\n❌ ERREUR de parsing JSON de la réponse Gemini:")
            print(f"   Erreur: {e}")
            print(f"   Texte reçu: {result_text[:500] if 'result_text' in locals() else 'N/A'}")
            print(f"{'─'*60}\n")
            raise
        except Exception as e:
            print(f"\n❌ ERREUR lors de l'appel Gemini ({self.provider}):")
            print(f"   Erreur: {e}")
            print(f"   Type: {type(e).__name__}")
            print(f"{'─'*60}\n")
            raise

    def _call_vertex_ai(self, prompt: Any, schema: Optional[Dict], 
                        model_name: str, response_mime_type: str) -> str:
        """Appel via Vertex AI"""
        from vertexai.generative_models import GenerationConfig
        
        # Récupérer ou créer le modèle
        if model_name not in self._models:
            from vertexai.generative_models import GenerativeModel
            self._models[model_name] = GenerativeModel(model_name)
        
        model = self._models[model_name]
        
        # Configuration de génération
        generation_config = GenerationConfig(
            response_mime_type=response_mime_type,
        )
        
        if schema:
            generation_config.response_schema = schema
        
        # Préparer le contenu
        if isinstance(prompt, list):
            contents = prompt
        else:
            contents = [prompt]
        
        response = model.generate_content(
            contents=contents,
            generation_config=generation_config
        )
        
        return response.text.strip()

    def _call_genai(self, prompt: Any, schema: Optional[Dict], 
                    model_name: str, response_mime_type: str) -> str:
        """Appel via Google AI API (dev)"""
        from google.genai import types
        
        config = types.GenerateContentConfig(
            response_mime_type=response_mime_type,
        )

        if schema:
            config.response_json_schema = schema

        response = self.client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=config
        )
        
        return response.text.strip()

    def _log_prompt(self, prompt: Any, schema: Optional[Dict], model: str):
        """Log le prompt envoyé"""
        provider_label = "Vertex AI" if self.provider == "vertex" else "Google AI"
        print(f"\n{'─'*60}")
        print(f"📤 PROMPT ENVOYÉ À GEMINI ({provider_label} - {model}):")
        print(f"{'─'*60}")
        if isinstance(prompt, list):
            for i, part in enumerate(prompt):
                if isinstance(part, str):
                    print(f"[Part {i+1} - Text]:")
                    print(part[:2000] + ("..." if len(part) > 2000 else ""))
                else:
                    print(f"[Part {i+1} - Image]: {type(part)}")
        else:
            print(prompt[:2000] + ("..." if len(prompt) > 2000 else ""))
        if schema:
            print(f"\n📋 Schéma JSON requis: {json.dumps(schema, indent=2)[:500]}...")
        print(f"{'─'*60}\n")

    def _log_response(self, result_text: str):
        """Log la réponse reçue"""
        print(f"\n{'─'*60}")
        print(f"📥 RÉPONSE DE GEMINI:")
        print(f"{'─'*60}")
        print(result_text[:3000] + ("..." if len(result_text) > 3000 else ""))
        print(f"{'─'*60}\n")
