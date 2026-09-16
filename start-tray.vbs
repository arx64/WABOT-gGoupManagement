Set WShell = CreateObject("WScript.Shell")

WShell.CurrentDirectory = "D:\zoom-reminder"

WShell.Run "cmd /c npm run tray", 0, False