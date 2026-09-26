param([string]$OutputName = 'GNZ48-Monitor.exe')
$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'DesktopHost.cs') -Raw
$references = @('System.dll', 'System.Core.dll', 'System.Windows.Forms.dll', [System.Management.Automation.PSObject].Assembly.Location)
Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly (Join-Path $PSScriptRoot $OutputName) -OutputType WindowsApplication -ReferencedAssemblies $references
