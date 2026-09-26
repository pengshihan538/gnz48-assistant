using System;
using System.IO;
using System.Management.Automation;
using System.Management.Automation.Runspaces;
using System.Threading;
using System.Windows.Forms;

// Windows GUI host: no terminal, HTTP server, browser, or WebView.
internal static class DesktopHost {
    [STAThread]
    private static void Main() {
        string folder = AppDomain.CurrentDomain.BaseDirectory;
        try {
            using (Runspace runspace = RunspaceFactory.CreateRunspace()) {
                runspace.ApartmentState = ApartmentState.STA;
                runspace.ThreadOptions = PSThreadOptions.UseCurrentThread;
                runspace.Open();
                using (PowerShell shell = PowerShell.Create()) {
                    shell.Runspace = runspace;
                    shell.AddCommand(Path.Combine(folder, "desktop.ps1")).AddParameter("BaseDir", folder);
                    shell.Invoke();
                    if(shell.HadErrors) throw new InvalidOperationException("Desktop initialization failed.");
                }
            }
        } catch (Exception ex) {
            File.WriteAllText(Path.Combine(folder,"desktop-startup.log"), ex.ToString());
            MessageBox.Show("The desktop app could not start. See desktop-startup.log.","GNZ48 Auction Monitor",MessageBoxButtons.OK,MessageBoxIcon.Error);
        }
    }
}
