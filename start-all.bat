echo Starting Twitch Ableton Local Bridge (Production Mode)...

start "Local Bridge" cmd /k "cd local-bridge && npm start"

echo.
echo Services started. 
echo Open http://localhost:8080/panel.html to control Ableton.
echo.
pause
