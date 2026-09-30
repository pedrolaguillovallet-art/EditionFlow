#!/usr/bin/env sh
# Abre EditionFlow en el navegador (macOS / Linux).
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Necesitas Node.js 18 o superior: https://nodejs.org"; exit 1; }
exec node server/index.js "$@"
