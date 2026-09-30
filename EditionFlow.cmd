@echo off
rem Doble clic para abrir EditionFlow en el navegador (Windows).
cd /d "%~dp0"
where node >nul 2>nul || (echo Necesitas Node.js 18 o superior: https://nodejs.org & pause & exit /b 1)
node server\index.js
pause
