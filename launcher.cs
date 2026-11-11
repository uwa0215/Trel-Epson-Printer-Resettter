using System;
using System.IO;
using System.Diagnostics;
using System.Windows.Forms;

namespace UniversalAppLauncher
{
    class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            try
            {
                // Determine base directory of the project
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                if (!File.Exists(Path.Combine(baseDir, "package.json")))
                {
                    string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
                    string candidate = Path.Combine(desktopPath, "Printer Resetter");
                    if (Directory.Exists(candidate) && File.Exists(Path.Combine(candidate, "package.json")))
                    {
                        baseDir = candidate;
                    }
                }

                // Strip trailing backslash to prevent Windows command line quote escaping (\" -> escaped quote)
                string cleanDir = baseDir.TrimEnd('\\', '/');
                Directory.SetCurrentDirectory(cleanDir);

                // 1. Ensure spooler bridge binary is compiled (32-bit x86 required for apdadrv.dll)
                string bridgeExe = Path.Combine(cleanDir, @"server\native\spooler_bridge.exe");
                if (!File.Exists(bridgeExe))
                {
                    string cscPath = @"C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe";
                    if (File.Exists(cscPath))
                    {
                        Process p = Process.Start(new ProcessStartInfo
                        {
                            FileName = cscPath,
                            Arguments = "/nologo /optimize+ /platform:x86 /r:System.Drawing.dll /target:exe /out:server\\native\\spooler_bridge.exe server\\native\\SpoolerBridge.cs",
                            WorkingDirectory = cleanDir,
                            WindowStyle = ProcessWindowStyle.Hidden,
                            CreateNoWindow = true
                        });
                        if (p != null) p.WaitForExit(10000);
                    }
                }

                // 2. Check if Electron and UI build exist; if downloaded fresh from GitHub, run setup
                string directElectron = Path.Combine(cleanDir, @"node_modules\electron\dist\electron.exe");
                string electronCmd = Path.Combine(cleanDir, @"node_modules\.bin\electron.cmd");
                string distIndex = Path.Combine(cleanDir, @"dist\index.html");

                bool missingElectron = !File.Exists(directElectron) && !File.Exists(electronCmd);
                bool missingDist = !File.Exists(distIndex);

                if (missingElectron || missingDist)
                {
                    if (!IsNpmAvailable())
                    {
                        MessageBox.Show(
                            "Cannot launch TREL directly from the GitHub source folder because Node.js is not installed on this PC.\n\n" +
                            "You have 2 easy ways to run TREL on another PC:\n\n" +
                            "1. NO-SETUP OPTION (Recommended):\n" +
                            "   Copy or download 'TREL Setup 1.0.0.exe' or 'TREL-Portable-1.0.0.exe' from the release folder / GitHub Releases. Those standalone apps work on any Windows PC without installing anything else!\n\n" +
                            "2. SOURCE CODE OPTION:\n" +
                            "   Install Node.js LTS from https://nodejs.org, then run TREL.exe again (it will auto-install dependencies).",
                            "TREL - Setup Required",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Information
                        );
                        return;
                    }

                    string setupCmd = missingElectron
                        ? "/c title TREL - Installing Dependencies & Building UI... && echo Installing dependencies (first run only)... && npm install && echo Building interface... && npm run build:ui"
                        : "/c title TREL - Building UI... && echo Building interface... && npm run build:ui";

                    Process setupProc = Process.Start(new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = setupCmd,
                        WorkingDirectory = cleanDir,
                        WindowStyle = ProcessWindowStyle.Normal,
                        UseShellExecute = true
                    });
                    if (setupProc != null) setupProc.WaitForExit();
                }

                // 3. Locate Electron binary after optional setup
                string targetExe;
                string targetArgs;

                if (File.Exists(directElectron))
                {
                    targetExe = directElectron;
                    targetArgs = "\"" + cleanDir + "\"";
                }
                else if (File.Exists(electronCmd))
                {
                    targetExe = electronCmd;
                    targetArgs = "\"" + cleanDir + "\"";
                }
                else
                {
                    MessageBox.Show(
                        "Setup did not finish or Electron binary is still missing.\n\n" +
                        "Please open a terminal in this folder and run:\n  npm install\n  npm run build:ui\n  npm start\n\n" +
                        "Or use the standalone 'TREL Setup 1.0.0.exe' / 'TREL-Portable-1.0.0.exe' installer on other PCs.",
                        "TREL - Launch Failed",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning
                    );
                    return;
                }

                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = targetExe,
                    Arguments = targetArgs,
                    WorkingDirectory = cleanDir,
                    WindowStyle = ProcessWindowStyle.Normal,
                    UseShellExecute = true
                };

                Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to launch TREL:\n" + ex.Message,
                                "TREL",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Error);
            }
        }

        static bool IsNpmAvailable()
        {
            try
            {
                Process p = Process.Start(new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c where npm",
                    WindowStyle = ProcessWindowStyle.Hidden,
                    CreateNoWindow = true,
                    UseShellExecute = false
                });
                if (p != null)
                {
                    p.WaitForExit(3000);
                    return p.ExitCode == 0;
                }
            }
            catch { }
            return false;
        }
    }
}
