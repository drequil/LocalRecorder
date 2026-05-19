@echo off
cd /d "%~dp0"
set "PATH=D:\bin\whisper-cublas-12-bin-x64\Release;%PATH%"
echo Starting LocalRecorder...
npm run ui
pause
