#!/bin/bash
# Script pour nettoyer le lock file Next.js et terminer les processus zombies

DASHBOARD_DIR="$(cd "$(dirname "$0")" && pwd)/dashboard_web"
LOCK_FILE="$DASHBOARD_DIR/.next/dev/lock"

echo "🧹 Nettoyage du lock file Next.js..."

# Supprimer le lock file
if [ -f "$LOCK_FILE" ]; then
    rm -f "$LOCK_FILE"
    echo "✅ Lock file supprimé: $LOCK_FILE"
else
    echo "ℹ️  Aucun lock file trouvé"
fi

# Créer le répertoire si nécessaire
mkdir -p "$(dirname "$LOCK_FILE")"

# Tuer les processus Next.js en cours
echo "🔍 Recherche des processus Next.js..."

# Méthode 1: Par nom de processus
PIDS=$(pgrep -f "next dev" 2>/dev/null)
if [ ! -z "$PIDS" ]; then
    echo "$PIDS" | while read pid; do
        if [ ! -z "$pid" ]; then
            kill -9 "$pid" 2>/dev/null && echo "✅ Processus Next.js terminé (PID: $pid)"
        fi
    done
fi

# Méthode 2: Par port (3000, 3001, 3002, 3003)
for port in 3000 3001 3002 3003; do
    PID=$(lsof -ti ":$port" 2>/dev/null)
    if [ ! -z "$PID" ]; then
        # Vérifier que c'est bien un processus Node
        PROC_NAME=$(ps -p "$PID" -o comm= 2>/dev/null)
        if [[ "$PROC_NAME" == *"node"* ]] || [[ "$PROC_NAME" == *"next"* ]]; then
            kill -9 "$PID" 2>/dev/null && echo "✅ Processus sur port $port terminé (PID: $PID)"
        fi
    fi
done

# Attendre un peu
sleep 0.5

# Vérifier à nouveau le lock file
if [ -f "$LOCK_FILE" ]; then
    rm -f "$LOCK_FILE"
    echo "✅ Lock file supprimé (vérification finale)"
fi

echo "✅ Nettoyage terminé!"


