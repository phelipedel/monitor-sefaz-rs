@echo off
title Monitor SEFAZ-RS NFC-e
echo =======================================================
echo Iniciando Monitor SEFAZ-RS NFC-e...
echo =======================================================
echo.
cd /d "%~dp0"
if not exist node_modules (
    echo Instalando dependencias...
    call npm install
)
echo Abrindo navegador...
start http://localhost:3000
node server.js
pause
