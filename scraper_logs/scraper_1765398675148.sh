#!/bin/bash
# Script généré automatiquement pour lancer le scraper Python
cd "/Users/maverickmenard/project/projet_mvm/scraper_mav"
nohup python3 "-m" "scraper_ai.main" "--reference" "https://www.mvmmotosport.com/fr/" "https://www.mvmmotosport.com/fr/" > "/Users/maverickmenard/project/projet_mvm/scraper_mav/scraper_logs/scraper_1765398675148.log" 2>&1 &
PYTHON_PID=$!
# Attendre un peu pour s'assurer que le processus est lancé
sleep 0.5
# Vérifier que le processus existe toujours
if kill -0 $PYTHON_PID 2>/dev/null; then
  # Écrire le PID dans le fichier de lock
  cat > "/Users/maverickmenard/project/projet_mvm/scraper_mav/scraper_logs/scraper_1765398675148.lock" << LOCKEOF
{
  "pid": $PYTHON_PID,
  "startTime": 1765398675148,
  "urls": ["https://www.mvmmotosport.com/fr/"],
  "referenceUrl": "https://www.mvmmotosport.com/fr/"
}
LOCKEOF
  echo $PYTHON_PID
else
  echo "ERROR: Process failed to start" >&2
  exit 1
fi
