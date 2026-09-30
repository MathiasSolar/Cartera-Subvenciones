@echo off
REM Genera dist\CarteraDIPIR.exe. Ejecutalo desde la raiz del proyecto.
REM Usa el entorno virtual .venv si existe (no hace falta activarlo).
set PY=python
if exist .venv\Scripts\python.exe set PY=.venv\Scripts\python.exe

%PY% -m PyInstaller --noconfirm --clean --onefile --windowed ^
  --name CarteraDIPIR ^
  --add-data "app\static;app\static" ^
  desktop.py
if errorlevel 1 (
  echo.
  echo No se pudo generar el ejecutable. Revisa que instalaste requirements-dev.txt
  echo y que la app este cerrada.
  exit /b 1
)
echo.
echo Listo: dist\CarteraDIPIR.exe
