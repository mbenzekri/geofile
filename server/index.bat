
call tsc
del /s geo\world\*.idx
call node .\build\index.js geo/world
