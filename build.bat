@echo off
setlocal
set "TWEEGO=tools\tweego.exe"
set "SRC=src\passages"
set "SCRIPTS=src\scripts"
set "STYLES=src\styles"
set "OUT=dist\index.html"

if not exist dist mkdir dist

:: JS files in src\scripts are passed as sources so Tweego includes them as
:: SugarCube user scripts (same scope as the engine). CSS files are modules.
"%TWEEGO%" -f sugarcube-2 -o "%OUT%" "%SRC%" "%SCRIPTS%" ^
  --module="%STYLES%\base.css" ^
  --module="%STYLES%\ui.css" ^
  --module="%STYLES%\theme-default.css" ^
  --module="%STYLES%\theme-light.css" ^
  --module="%STYLES%\pixel-art.css" ^
  --module="%STYLES%\llm-ui.css"

echo Build complete: %OUT%
endlocal
