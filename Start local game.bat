@echo off
rem Runs Punchline Derby on this laptop. Phones must be on the same Wi-Fi.
cd /d "%~dp0"
if not exist node_modules call npm install
start "" http://localhost:3000/host
node server.js
