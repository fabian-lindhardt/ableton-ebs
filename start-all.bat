@echo off
echo Starting Twitch Ableton Extension Services...

start "EBS Server" cmd /k "cd ebs && npm start"
timeout /t 2 >nul
start "Local Bridge" cmd /k "cd local-bridge && npm start"

echo.
echo Services started. 
echo Open http://localhost:8080/panel.html to control Ableton.
echo.
pause
