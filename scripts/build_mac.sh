#!/usr/bin/env bash
# Genera dist/CarteraDIPIR.app (ejecútalo desde la raíz del proyecto con el venv activado)
set -euo pipefail
pyinstaller --noconfirm --clean --windowed \
  --name CarteraDIPIR \
  --add-data "app/static:app/static" \
  desktop.py
echo
echo "Listo: dist/CarteraDIPIR.app"
