' Podnimaet tunnel bez okna konsoli.
'
' Otdelnyy fayl, a ne "start /min" vnutri autostart.cmd: start sozdaet
' svernutoe, no vidimoe okno konsoli v paneli zadach. Zdes okna net
' voobshche, a process perezhivaet togo, kto ego zapustil.
Set shell = CreateObject("WScript.Shell")
shell.Run """C:\Users\Admin\Documents\Claude\messenger\tools\cloudpub\clo.exe"" run", 0, False
