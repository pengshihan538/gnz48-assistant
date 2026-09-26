Option Explicit
Dim shell, fs, folder, script
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
folder = fs.GetParentFolderName(WScript.ScriptFullName)
script = fs.BuildPath(folder, "desktop.ps1")
shell.Run "powershell.exe -NoProfile -STA -WindowStyle Hidden -File """ & script & """", 0, False
