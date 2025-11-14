"""
Client Gemini pour les appels API
"""
import json
import re
import os
import tempfile
from typing import Dict, Optional, List, Any, Tuple
from google import genai
from google.genai import types

from .config import GEMINI_API_KEY, MODEL, MODEL_SELECTION, MODEL_EXTRACTION


class GeminiClient:
    """Client pour les appels à l'API Gemini"""
    
    def __init__(self):
        self.client = genai.Client(api_key=GEMINI_API_KEY)
        self.uploaded_files = []  # Track uploaded files for cleanup
    
    def upload_image(self, image_bytes: bytes, mime_type: str) -> Optional[Any]:
        """Upload une image via Files API et retourne le fichier uploadé"""
        try:
            # Créer un fichier temporaire pour l'upload
            with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg' if 'jpeg' in mime_type else '.png') as tmp_file:
                tmp_file.write(image_bytes)
                tmp_path = tmp_file.name
            
            try:
                # Upload via Files API
                uploaded_file = self.client.files.upload(file=tmp_path)
                self.uploaded_files.append(uploaded_file)  # Track for cleanup
                print(f"   📤 Image uploadée: {uploaded_file.name}")
                return uploaded_file
            finally:
                # Nettoyer le fichier temporaire
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
        except Exception as e:
            print(f"   ⚠️ Erreur upload image: {e}")
            return None
    
    def cleanup_uploaded_files(self):
        """Nettoie les fichiers uploadés (optionnel, ils sont supprimés automatiquement après 48h)"""
        for file in self.uploaded_files:
            try:
                self.client.files.delete(name=file.name)
            except:
                pass
        self.uploaded_files = []
    
    def call(self, prompt: Any, schema: Optional[Dict] = None, show_prompt: bool = True, 
             thinking_budget: int = -1, response_mime_type: str = "application/json",
             use_flash: bool = False) -> Dict:
        """Appelle l'API Gemini avec le prompt et le schéma
        
        Args:
            prompt: Le prompt à envoyer
            schema: Le schéma JSON attendu
            show_prompt: Afficher le prompt dans les logs
            thinking_budget: Budget de réflexion pour le modèle
            response_mime_type: Type MIME de la réponse
            use_flash: Si True, utilise gemini-flash-latest (rapide), sinon gemini-2.5-pro (précis)
        """
        try:
            # Sélectionner le modèle approprié
            model_to_use = MODEL_SELECTION if use_flash else MODEL_EXTRACTION
            
            if show_prompt:
                print(f"\n{'─'*60}")
                print(f"📤 PROMPT ENVOYÉ À GEMINI ({model_to_use}):")
                print(f"{'─'*60}")
                if isinstance(prompt, list):
                    # Si c'est une liste (multimodal), afficher le texte et les images
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
                thinking_config=types.ThinkingConfig(thinking_budget=thinking_budget),
                response_mime_type=response_mime_type,
            )
            
            if schema:
                config.response_json_schema = schema
            
            response = self.client.models.generate_content(
                model=model_to_use,
                contents=prompt,
                config=config
            )
            
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
            
            # Valider que le résultat n'est pas vide (seulement pour les schémas d'extraction, pas pour choose_next_pages)
            # Le schéma d'extraction a companyInfo et products, le schéma choose_next_pages a selectedLinks
            if schema and schema.get('properties', {}).get('companyInfo'):
                # C'est un schéma d'extraction - valider companyInfo/products
                if not parsed or (not parsed.get('companyInfo') and not parsed.get('products')):
                    print(f"⚠️ ATTENTION: Gemini a retourné un résultat vide ou invalide")
                    print(f"   Résultat: {json.dumps(parsed, indent=2)[:500]}")
                    # Retourner une structure valide mais vide plutôt que {}
                    return {
                        "companyInfo": {},
                        "products": []
                    }
            elif schema and schema.get('properties', {}).get('selectedPages'):
                # C'est un schéma de sélection de pages - valider selectedPages
                if not parsed or not parsed.get('selectedPages'):
                    print(f"⚠️ ATTENTION: Gemini n'a pas retourné de selectedPages")
                    print(f"   Résultat: {json.dumps(parsed, indent=2)[:500]}")
                    # Retourner une structure valide mais vide
                    return {
                        "selectedPages": [],
                        "reasoning": "",
                        "contactInfo": {}
                    }
            
            return parsed
        except json.JSONDecodeError as e:
            print(f"\n❌ ERREUR de parsing JSON de la réponse Gemini:")
            print(f"   Erreur: {e}")
            print(f"   Texte reçu: {result_text[:500] if 'result_text' in locals() else 'N/A'}")
            print(f"{'─'*60}\n")
            # Retourner une structure valide mais vide
            return {
                "companyInfo": {},
                "products": []
            }
        except Exception as e:
            print(f"\n❌ ERREUR lors de l'appel Gemini:")
            print(f"   Erreur: {e}")
            print(f"   Type: {type(e).__name__}")
            if 'response' in locals():
                try:
                    print(f"   Réponse brute: {response.text[:1000] if hasattr(response, 'text') else 'N/A'}")
                except:
                    pass
            print(f"{'─'*60}\n")
            # Retourner une structure valide mais vide plutôt que {}
            return {
                "companyInfo": {},
                "products": []
            }

