echo Starting Twitch Ableton Local Bridge (Production Mode)...

start "Local Bridge" cmd /k "cd local-bridge && set EBS_URL=ws://localhost:8080 && npm start"
start "EBS Server" cmd /k "node ebs/server.js"

echo.
echo Services started. 
echo Open http://localhost:8080/panel.html to control Ableton.
echo.
pause
