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
                        if (p != null) p.WaitForExit(5000);
                    }
                }

                // 2. Locate Electron binary
                string directElectron = Path.Combine(cleanDir, @"node_modules\electron\dist\electron.exe");
                string electronCmd = Path.Combine(cleanDir, @"node_modules\.bin\electron.cmd");

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
                    targetExe = "cmd.exe";
                    targetArgs = "/c npm start";
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
                MessageBox.Show("Failed to launch Universal Tool:\n" + ex.Message, 
                                "Trel- Universal Tool", 
                                MessageBoxButtons.OK, 
                                MessageBoxIcon.Error);
            }
        }
    }
}
