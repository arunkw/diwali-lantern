@echo off
REM Runs Diwali Lantern from source. Needs Python 3.10+ (python.org).
cd /d "%~dp0"
python -m pip install -r requirements.txt
start "" pythonw diwali_lantern.py
