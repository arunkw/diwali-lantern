@echo off
REM Builds DiwaliLantern.exe (single file, no console window) into the "dist" folder.
cd /d "%~dp0"
python -m pip install --upgrade -r requirements.txt pyinstaller
python -m PyInstaller --noconfirm --onefile --windowed --name DiwaliLantern --icon icon.ico --exclude-module tkinter diwali_lantern.py
echo.
echo Done. Your app is at: %~dp0dist\DiwaliLantern.exe
pause
