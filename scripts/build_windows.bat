@echo off
REM Genera dist\CarteraDIPIR.exe (ejecutalo desde la raiz del proyecto con el venv activado)
pyinstaller --noconfirm --clean --onefile --windowed ^
  --name CarteraDIPIR ^
  --add-data "app\static;app\static" ^
  desktop.py
echo.
echo Listo: dist\CarteraDIPIR.exe
