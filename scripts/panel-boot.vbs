' Запуск панели при входе в Windows.
'
' Otdel'nyy fayl, a ne argument v yarlyke: yarlyk s parametrami legko
' slomat' odnoy pravkoy v svoystvakh, a etot put' zafiksirovan.
' Flag -Autostart govorit paneli ne pokazyvat' okno i podnyat' servisy.
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""C:\Users\Admin\Documents\Claude\messenger\scripts\panel.ps1"" -Autostart", 0, False
