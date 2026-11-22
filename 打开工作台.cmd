@echo off
cd /d "%~dp0" || exit /b 1
setlocal
set "MUSIC_WORKBENCH_OPEN=1"
node -e "const path = require('node:path'); process.chdir(path.join('\u9879\u76ee\u6587\u4ef6', '\u5de5\u4f5c\u53f0')); import(require('node:url').pathToFileURL(path.resolve('open-preview.mjs')).href).catch(error => { console.error(error); process.exitCode = 1; });"
pause
