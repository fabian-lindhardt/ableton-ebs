@echo off
echo Starting Local Bridge in PRODUCTION mode...
echo Connecting to: wss://abletonlivechat.flairtec.de
cd local-bridge
set EBS_URL=wss://abletonlivechat.flairtec.de
npm start
pause
