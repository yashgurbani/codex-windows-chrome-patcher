using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

internal static class CodexPatchedLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            string exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string repoRoot = Directory.GetParent(exeDir).FullName;
            string scriptsDir = Path.Combine(repoRoot, "scripts");
            string autoPatcher = Path.Combine(scriptsDir, "auto-patch-codex.ps1");

            if (!File.Exists(autoPatcher))
            {
                MessageBox.Show(
                    "Missing auto patcher:\n" + autoPatcher,
                    "Codex Patched Launcher",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return 1;
            }

            string powershell = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                "System32",
                "WindowsPowerShell",
                "v1.0",
                "powershell.exe");

            var startInfo = new ProcessStartInfo
            {
                FileName = powershell,
                Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + autoPatcher + "\"",
                WorkingDirectory = scriptsDir,
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden,
            };

            Process.Start(startInfo);
            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                ex.ToString(),
                "Codex Patched Launcher",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
    }
}
