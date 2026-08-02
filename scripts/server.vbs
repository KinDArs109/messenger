' Podnimaet storozha servera bez okna konsoli.
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\Admin\Documents\Claude\messenger\scripts\serve-loop.ps1""", 0, False
