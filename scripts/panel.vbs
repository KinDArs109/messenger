' Zapuskaet panel bez okna konsoli.
' Bez etoy obertki PowerShell na sekundu pokazyvaet chernoe okno,
' i vyglyadit eto kak sboy, a ne kak zapusk prilozheniya.
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\Admin\Documents\Claude\messenger\scripts\panel.ps1""", 0, False
