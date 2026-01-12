#!/bin/bash
# Script pour démarrer le serveur Next.js avec vérifications

echo "🔍 Vérification de l'environnement..."

# Vérifier que Python3 est disponible
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 n'est pas installé ou n'est pas dans le PATH"
    exit 1
fi

echo "✅ Python3 trouvé: $(which python3)"

# Vérifier que .env.local existe
if [ ! -f .env.local ]; then
    echo "⚠️  .env.local n'existe pas"
    echo "📝 Création de .env.local..."
    
    # Essayer de copier depuis le .env parent
    if [ -f ../.env ]; then
        grep "GEMINI_API_KEY" ../.env > .env.local
        echo "✅ .env.local créé depuis ../.env"
    else
        echo "❌ Impossible de créer .env.local - veuillez le créer manuellement"
        exit 1
    fi
else
    echo "✅ .env.local existe"
fi

# Vérifier que GEMINI_API_KEY est présente
if ! grep -q "GEMINI_API_KEY" .env.local; then
    echo "⚠️  GEMINI_API_KEY absente de .env.local"
    if [ -f ../.env ]; then
        echo "📝 Ajout de GEMINI_API_KEY depuis ../.env..."
        grep "GEMINI_API_KEY" ../.env >> .env.local
    fi
fi

echo ""
echo "🚀 Démarrage du serveur Next.js..."
echo "📍 Le serveur sera accessible sur http://localhost:3000"
echo ""

npm run dev

