"""
Client Gemini pour les appels API
"""
import json
import re
from typing import Dict, Optional, Any
from google import genai
from google.genai import types

try:
    from .config import GEMINI_API_KEY, MODEL_ANALYSIS, MODEL_EXTRACTION
except ImportError:
    from config import GEMINI_API_KEY, MODEL_ANALYSIS, MODEL_EXTRACTION


class GeminiClient:
    """Client pour les appels à l'API Gemini"""

    def __init__(self):
        self.client = genai.Client(api_key=GEMINI_API_KEY)
        self._call_count = 0  # Compteur d'appels pour vérification

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
        try:
            model_to_use = model or MODEL_ANALYSIS

            if show_prompt:
                print(f"\n{'─'*60}")
                print(f"📤 PROMPT ENVOYÉ À GEMINI ({model_to_use}):")
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

            config = types.GenerateContentConfig(
                response_mime_type=response_mime_type,
            )

            if schema:
                config.response_json_schema = schema

            response = self.client.models.generate_content(
                model=model_to_use,
                contents=prompt,
                config=config
            )

            # Incrémenter le compteur d'appels
            self._call_count += 1

            result_text = response.text.strip()

            if show_prompt:
                print(f"\n{'─'*60}")
                print(f"📥 RÉPONSE DE GEMINI:")
                print(f"{'─'*60}")
                print(result_text[:3000] + ("..." if len(result_text) > 3000 else ""))
                print(f"{'─'*60}\n")

            # Nettoyer le JSON (enlever les markdown code blocks si présents)
            if result_text.startswith('```'):
                result_text = re.sub(r'^```(?:json)?\s*\n', '', result_text)
                result_text = re.sub(r'\n```\s*$', '', result_text)

            parsed = json.loads(result_text)
            return parsed

        except json.JSONDecodeError as e:
            print(f"\n❌ ERREUR de parsing JSON de la réponse Gemini:")
            print(f"   Erreur: {e}")
            print(f"   Texte reçu: {result_text[:500] if 'result_text' in locals() else 'N/A'}")
            print(f"{'─'*60}\n")
            raise
        except Exception as e:
            print(f"\n❌ ERREUR lors de l'appel Gemini:")
            print(f"   Erreur: {e}")
            print(f"   Type: {type(e).__name__}")
            print(f"{'─'*60}\n")
            raise

