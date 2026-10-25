using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace STS2Tracker
{
    class Program
    {
        private static int port = 8383;
        private static string historyDir = null;
        private static string localPlayerId = "";
        private static string steamPersonaName = "";
        private static string steamAccountName = "";
        private static volatile string pendingAuthSessionJson = null;
        private static string webDir = null;
        private static string cachedRunsJson = "[]";
        private static int cachedRunCount = 0;
        private static long lastCacheUpdate = 0;
        private static readonly object cacheLock = new object();
        private static FileSystemWatcher watcher = null;
        private static Timer debounceTimer = null;
        private static readonly Dictionary<string, byte[]> embeddedAssets = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        private static readonly ManualResetEvent shutdownEvent = new ManualResetEvent(false);
        private static DateTime lastHeartbeat = DateTime.UtcNow;
        private static bool clientConnected = false;
        private static readonly DateTime serverStartTime = DateTime.UtcNow;
        private static readonly string AppVersion = "v1.2.7";
        private static HttpListener httpListener = null;
        private static int closeSequenceId = 0;
        private static volatile bool isUpdatingCompanion = false;

        [DllImport("shell32.dll")]
        private static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);

        static void Main(string[] args)
        {
            AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs eArgs)
            {
                SafeLog("[FATAL UNHANDLED EXCEPTION] " + (eArgs.ExceptionObject != null ? eArgs.ExceptionObject.ToString() : "unknown"));
            };

            AppDomain.CurrentDomain.ProcessExit += delegate(object sender, EventArgs eArgs)
            {
                SafeLog("[PROCESS EXIT] ProcessExit event triggered.");
            };

            try
            {
                Console.OutputEncoding = Encoding.UTF8;
                Console.Title = "Slay the Spire 2 - Run Tracker & Analytics";
            }
            catch { }

            SafeLog("=================================================", ConsoleColor.Cyan);
            SafeLog("    Slay the Spire 2 - Standalone Run Tracker    ", ConsoleColor.Cyan);
            SafeLog("       Real-time Climb Analytics & Telemetry     ", ConsoleColor.Cyan);
            SafeLog("=================================================", ConsoleColor.Cyan);

            // 1. Terminate any previous instances automatically (eliminates need for .bat / taskkill)
            SafeLog("[STEP 1] Starting KillPreviousInstances...");
            KillPreviousInstances();
            SafeLog("[STEP 2] KillPreviousInstances finished.");

            try
            {
                string strayLog = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "tracker_runtime.log");
                if (File.Exists(strayLog)) File.Delete(strayLog);
            }
            catch { }

            SafeLog("[STEP 3] Starting LoadEmbeddedAssets...");
            LoadEmbeddedAssets();
            EnsureDesktopShortcut();
            try { SHChangeNotify(0x08000000, 0x0000, IntPtr.Zero, IntPtr.Zero); } catch { }
            
            // 3. Locate Web Directory (optional override if web folder exists next to exe)
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string candidateWeb = Path.Combine(baseDir, "web");
            if (Directory.Exists(candidateWeb))
            {
                webDir = candidateWeb;
                SafeLog("[INFO] Local web overrides directory detected: " + webDir);
            }

            // 4. Locate Slay the Spire 2 Save History Directory
            if (args.Length > 0 && Directory.Exists(args[0]))
            {
                historyDir = args[0];
            }
            else
            {
                historyDir = FindSTS2HistoryDirectory();
            }

            if (string.IsNullOrEmpty(historyDir) || !Directory.Exists(historyDir))
            {
                SafeLog("[WARN] Slay the Spire 2 save history folder was not automatically found. The web dashboard will allow selecting saves manually.");
            }

            if (!string.IsNullOrEmpty(historyDir) && Directory.Exists(historyDir))
            {
                SafeLog("[INFO] STS2 History Folder: " + historyDir);
                Match idMatch = Regex.Match(historyDir, @"steam[\\/]([0-9]{15,20})", RegexOptions.IgnoreCase);
                if (idMatch.Success)
                {
                    localPlayerId = idMatch.Groups[1].Value;
                    SafeLog("[INFO] Detected Steam ID: " + localPlayerId);
                }

                SetupWatcher();
            }

            // Detect Steam Account Persona from local Steam configuration & registry
            DetectSteamAccountDetails();

            // 5. Initial Load of Runs
            ReloadRuns();

            // 6. Start Resilient HTTP Server (Port scanning from 8383 to 8390)
            HttpListener listener = StartHttpServer();
            httpListener = listener;
            if (listener == null)
            {
                SafeLog("[ERROR] Could not bind HTTP listener to any port between 8383 and 8390.", ConsoleColor.Red);
                return;
            }

            // Start Request Processing Loop IMMEDIATELY
            ThreadPool.QueueUserWorkItem(delegate
            {
                while (listener.IsListening)
                {
                    try
                    {
                        HttpListenerContext context = listener.GetContext();
                        ThreadPool.QueueUserWorkItem(ProcessRequest, context);
                    }
                    catch (HttpListenerException)
                    {
                        break;
                    }
                    catch (Exception ex)
                    {
                        SafeLog("[ERROR] Request loop: " + ex.Message);
                    }
                }
            });

            // 7. Auto-launch UI in Native Window Mode (Edge App Mode) or Default Browser
            bool noBrowser = false;
            foreach (string a in args)
            {
                if (a.Equals("--no-browser", StringComparison.OrdinalIgnoreCase)) noBrowser = true;
            }
            try
            {
                string updateMarker = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".sts2_updating");
                if (File.Exists(updateMarker))
                {
                    noBrowser = true;
                    File.Delete(updateMarker);
                }
            }
            catch { }

            if (!noBrowser)
            {
                LaunchClientUi();
            }

            SafeLog("-------------------------------------------------");
            SafeLog("[STATUS] Real-time tracking is ACTIVE!");
            SafeLog("Keep this application running in background while playing.");
            SafeLog("Hotkeys: [R] Refresh  [O] Open Folder  [B] Re-open Window  [Q] Exit");
            SafeLog("-------------------------------------------------");

            // 8. Companion Background Persistence
            // Keep background server alive while user plays Slay the Spire 2.
            SafeLog("[SERVER] Server running. Waiting for shutdown signal...");
            shutdownEvent.WaitOne();
            SafeLog("[SERVER] Shutdown signal received. Exiting process.");

            try { listener.Stop(); } catch { }
            Environment.Exit(0);
        }

        private static void KillPreviousInstances()
        {
            try
            {
                Process current = Process.GetCurrentProcess();
                Process[] procs = Process.GetProcessesByName("STS2Tracker");
                foreach (Process p in procs)
                {
                    if (p.Id != current.Id)
                    {
                        try
                        {
                            SafeLog("[INFO] Closing prior tracker instance (PID " + p.Id + ")...");
                            p.Kill();
                            p.WaitForExit(1500);
                        }
                        catch { }
                    }
                }
            }
            catch { }
        }

        private static void EnsureDesktopShortcut()
        {
            try
            {
                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string appInstallDir = Path.Combine(localAppData, "STS2Tracker");
                if (!Directory.Exists(appInstallDir))
                {
                    Directory.CreateDirectory(appInstallDir);
                }

                string currentExe = Assembly.GetExecutingAssembly().Location;
                string installedExe = Path.Combine(appInstallDir, "STS2Tracker.exe");
                string installedIco = Path.Combine(appInstallDir, "sts2_tracker.ico");

                // 1. Extract embedded high-res .ico to %LocalAppData%\STS2Tracker\sts2_tracker.ico
                byte[] icoBytes = GetEmbeddedBytes("favicon.ico");
                if (icoBytes != null && icoBytes.Length > 0)
                {
                    try
                    {
                        if (!File.Exists(installedIco) || new FileInfo(installedIco).Length != icoBytes.Length)
                        {
                            File.WriteAllBytes(installedIco, icoBytes);
                        }
                    }
                    catch { }
                }

                // 2. Sync running executable to permanent %LocalAppData%\STS2Tracker\STS2Tracker.exe
                string targetExe = currentExe;
                if (!string.Equals(Path.GetFullPath(currentExe), Path.GetFullPath(installedExe), StringComparison.OrdinalIgnoreCase))
                {
                    try
                    {
                        File.Copy(currentExe, installedExe, true);
                        targetExe = installedExe;
                    }
                    catch
                    {
                        if (File.Exists(installedExe)) targetExe = installedExe;
                    }
                }

                // 3. Check Desktop for any existing STS2 Tracker shortcut to prevent duplicates
                string desktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                if (string.IsNullOrEmpty(desktopDir) || !Directory.Exists(desktopDir)) return;

                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                object shell = Activator.CreateInstance(shellType);

                string defaultShortcutPath = Path.Combine(desktopDir, "Slay the Spire 2 Tracker.lnk");
                string existingShortcutPath = null;

                if (File.Exists(defaultShortcutPath))
                {
                    existingShortcutPath = defaultShortcutPath;
                }
                else
                {
                    // Scan all .lnk files on Desktop to see if one already targets STS2Tracker.exe (even if renamed by user)
                    try
                    {
                        string[] lnkFiles = Directory.GetFiles(desktopDir, "*.lnk");
                        foreach (string lnk in lnkFiles)
                        {
                            try
                            {
                                object scObj = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
                                string tPath = scObj.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, scObj, null) as string;
                                if (!string.IsNullOrEmpty(tPath) && tPath.EndsWith("STS2Tracker.exe", StringComparison.OrdinalIgnoreCase))
                                {
                                    existingShortcutPath = lnk;
                                    break;
                                }
                            }
                            catch { }
                        }
                    }
                    catch { }
                }

                // If a shortcut already exists on the Desktop, never create a second one!
                // Only update in place if its TargetPath is missing/broken; otherwise leave it untouched.
                bool needsCreateOrRepair = false;
                string shortcutToWrite = existingShortcutPath;

                if (existingShortcutPath == null)
                {
                    shortcutToWrite = defaultShortcutPath;
                    needsCreateOrRepair = true;
                }
                else
                {
                    try
                    {
                        object scObj = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { existingShortcutPath });
                        Type scType = scObj.GetType();
                        string tPath = scType.InvokeMember("TargetPath", BindingFlags.GetProperty, null, scObj, null) as string;
                        string iLoc = scType.InvokeMember("IconLocation", BindingFlags.GetProperty, null, scObj, null) as string;
                        if (string.IsNullOrEmpty(tPath) || !File.Exists(tPath) ||
                            !string.Equals(Path.GetFullPath(tPath), Path.GetFullPath(targetExe), StringComparison.OrdinalIgnoreCase) ||
                            string.IsNullOrEmpty(iLoc) || !iLoc.StartsWith(installedIco, StringComparison.OrdinalIgnoreCase))
                        {
                            needsCreateOrRepair = true;
                        }
                    }
                    catch { }
                }

                if (needsCreateOrRepair && !string.IsNullOrEmpty(shortcutToWrite))
                {
                    object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutToWrite });
                    Type scType = shortcut.GetType();
                    scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetExe });
                    scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { Path.GetDirectoryName(targetExe) });
                    scType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "Slay the Spire 2 Run Tracker & Analytics Companion" });
                    if (File.Exists(installedIco))
                    {
                        scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { installedIco + ",0" });
                    }
                    else
                    {
                        scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { targetExe + ",0" });
                    }
                    scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
                    SafeLog("[INSTALL] Desktop shortcut ready: " + shortcutToWrite);
                }
            }
            catch (Exception ex)
            {
                SafeLog("[WARN] Desktop shortcut check: " + ex.Message);
            }
        }

        private static void LoadEmbeddedAssets()
        {
            try
            {
                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("assets.zip"))
                {
                    if (stream != null)
                    {
                        using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                        {
                            foreach (ZipArchiveEntry entry in archive.Entries)
                            {
                                if (entry.Length > 0)
                                {
                                    using (Stream s = entry.Open())
                                    using (MemoryStream ms = new MemoryStream())
                                    {
                                        s.CopyTo(ms);
                                        string key = entry.FullName.Replace('\\', '/').TrimStart('/');
                                        embeddedAssets[key] = ms.ToArray();
                                    }
                                }
                            }
                        }
                        SafeLog("[INFO] Loaded " + embeddedAssets.Count + " embedded game assets into memory (portraits & relics).");
                    }
                }
            }
            catch (Exception ex)
            {
                SafeLog("[WARN] Could not unpack embedded assets: " + ex.Message);
            }
        }

        private static HttpListener StartHttpServer()
        {
            // Aggressively retry preferred port 8383 across 12 attempts (3 seconds) to ensure seamless binary handoffs
            for (int attempt = 0; attempt < 12; attempt++)
            {
                HttpListener l = new HttpListener();
                try
                {
                    l.Prefixes.Add("http://localhost:8383/");
                    l.Prefixes.Add("http://127.0.0.1:8383/");
                    l.Start();
                    port = 8383;
                    httpListener = l;
                    SafeLog("[SERVER] Live Dashboard active at: http://localhost:8383/");
                    return l;
                }
                catch (Exception)
                {
                    l.Close();
                    Thread.Sleep(250);
                }
            }

            // Fallback ports 8384-8390 only if 8383 is permanently occupied by an external application
            for (int tryPort = 8384; tryPort <= 8390; tryPort++)
            {
                HttpListener l = new HttpListener();
                try
                {
                    l.Prefixes.Add("http://localhost:" + tryPort + "/");
                    l.Prefixes.Add("http://127.0.0.1:" + tryPort + "/");
                    l.Start();
                    port = tryPort;
                    httpListener = l;
                    SafeLog("[SERVER] Live Dashboard active at fallback: http://localhost:" + port + "/");
                    return l;
                }
                catch (Exception)
                {
                    l.Close();
                }
            }
            return null;
        }

        private static void LaunchClientUi(bool forceOpen = false)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                Thread.Sleep(forceOpen ? 200 : 1200);
                if (!forceOpen && clientConnected)
                {
                    SafeLog("[APP] Active browser session already connected; skipping duplicate window launch.");
                    return;
                }
                string targetUrl = "http://localhost:" + port + "/?v=" + Environment.TickCount;
                bool edgeAppStarted = false;

                try
                {
                    string progFiles86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
                    string progFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
                    string edgePath = Path.Combine(progFiles86, @"Microsoft\Edge\Application\msedge.exe");
                    if (!File.Exists(edgePath)) edgePath = Path.Combine(progFiles, @"Microsoft\Edge\Application\msedge.exe");

                    if (File.Exists(edgePath))
                    {
                        string edgeUserData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "STS2Tracker", "edge_profile");
                        try { Directory.CreateDirectory(edgeUserData); } catch { }

                        Process.Start(new ProcessStartInfo
                        {
                            FileName = edgePath,
                            Arguments = "--app=\"" + targetUrl + "\" --user-data-dir=\"" + edgeUserData + "\" --window-size=1440,920",
                            UseShellExecute = true
                        });
                        edgeAppStarted = true;
                        SafeLog("[APP] Opened STS2 Tracker in Dedicated Window Mode.");
                    }
                }
                catch (Exception ex)
                {
                    SafeLog("[WARN] Edge launch exception: " + ex.Message);
                }

                if (!edgeAppStarted)
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = targetUrl,
                            UseShellExecute = true
                        });
                        SafeLog("[APP] Opened STS2 Tracker in Default Browser.");
                    }
                    catch (Exception ex)
                    {
                        SafeLog("[WARN] Could not automatically open browser: " + ex.Message);
                    }
                }
            });
        }



        private static string FindSTS2HistoryDirectory()
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string stsSteamBase = Path.Combine(appData, "SlayTheSpire2", "steam");

            if (!Directory.Exists(stsSteamBase))
            {
                return null;
            }

            try
            {
                string[] historyDirs = Directory.GetDirectories(stsSteamBase, "history", SearchOption.AllDirectories);
                if (historyDirs.Length > 0)
                {
                    string bestDir = historyDirs[0];
                    int maxCount = 0;
                    foreach (string d in historyDirs)
                    {
                        try
                        {
                            int count = Directory.GetFiles(d, "*.run").Length;
                            if (count > maxCount)
                            {
                                maxCount = count;
                                bestDir = d;
                            }
                        }
                        catch { }
                    }
                    return bestDir;
                }
            }
            catch { }

            return null;
        }

        private static void DetectSteamAccountDetails()
        {
            try
            {
                string autoUser = null;
                string steamPath = null;
                try
                {
                    using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam"))
                    {
                        if (key != null)
                        {
                            autoUser = key.GetValue("AutoLoginUser") as string;
                            steamPath = key.GetValue("SteamPath") as string;
                        }
                    }
                }
                catch { }

                if (!string.IsNullOrEmpty(autoUser))
                {
                    steamAccountName = autoUser;
                    if (string.IsNullOrEmpty(steamPersonaName)) steamPersonaName = autoUser;
                }

                if (string.IsNullOrEmpty(steamPath))
                {
                    steamPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Steam");
                }

                string vdfPath = Path.Combine(steamPath, "config", "loginusers.vdf");
                if (File.Exists(vdfPath))
                {
                    string vdf = File.ReadAllText(vdfPath);

                    if (!string.IsNullOrEmpty(localPlayerId))
                    {
                        int idIdx = vdf.IndexOf("\"" + localPlayerId + "\"");
                        if (idIdx != -1)
                        {
                            string sub = vdf.Substring(idIdx);
                            int nextUser = sub.IndexOf("\"\n\t{", 10);
                            if (nextUser != -1) sub = sub.Substring(0, nextUser);

                            Match mPersona = Regex.Match(sub, "\"PersonaName\"\\s*\"([^\"]+)\"");
                            if (mPersona.Success) steamPersonaName = mPersona.Groups[1].Value;
                            Match mAcct = Regex.Match(sub, "\"AccountName\"\\s*\"([^\"]+)\"");
                            if (mAcct.Success) steamAccountName = mAcct.Groups[1].Value;
                        }
                    }
                    else
                    {
                        Match mUser = Regex.Match(vdf, "\"([0-9]{15,20})\"\\s*\\{[^}]*?\"(?:MostRecent|AutoLogin)\"\\s*\"1\"", RegexOptions.Singleline);
                        if (mUser.Success)
                        {
                            localPlayerId = mUser.Groups[1].Value;
                            int idIdx = vdf.IndexOf("\"" + localPlayerId + "\"");
                            if (idIdx != -1)
                            {
                                string sub = vdf.Substring(idIdx);
                                Match mPersona = Regex.Match(sub, "\"PersonaName\"\\s*\"([^\"]+)\"");
                                if (mPersona.Success) steamPersonaName = mPersona.Groups[1].Value;
                                Match mAcct = Regex.Match(sub, "\"AccountName\"\\s*\"([^\"]+)\"");
                                if (mAcct.Success) steamAccountName = mAcct.Groups[1].Value;
                            }
                        }
                    }

                    if (string.IsNullOrEmpty(steamPersonaName))
                    {
                        Match mFirst = Regex.Match(vdf, "\"PersonaName\"\\s*\"([^\"]+)\"");
                        if (mFirst.Success) steamPersonaName = mFirst.Groups[1].Value;
                    }
                }

                if (localPlayerId == "76561199078562869" || (!string.IsNullOrEmpty(steamAccountName) && steamAccountName.Equals("apocaelypze", StringComparison.OrdinalIgnoreCase)))
                {
                    steamPersonaName = "Apocaelypze";
                }

                if (!string.IsNullOrEmpty(steamPersonaName))
                {
                    SafeLog("[INFO] Detected Steam Persona: " + steamPersonaName + " (Account: " + steamAccountName + ", ID: " + localPlayerId + ")", ConsoleColor.Green);
                }
            }
            catch (Exception ex)
            {
                SafeLog("[WARN] Steam account detection notice: " + ex.Message);
            }
        }

        private static void SetupWatcher()
        {
            try
            {
                if (watcher != null)
                {
                    watcher.Dispose();
                    watcher = null;
                }

                watcher = new FileSystemWatcher(historyDir, "*.run");
                watcher.NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size;
                watcher.Created += OnHistoryChanged;
                watcher.Changed += OnHistoryChanged;
                watcher.Renamed += OnHistoryChanged;
                watcher.EnableRaisingEvents = true;
            }
            catch (Exception ex)
            {
                SafeLog("[WARN] Could not initialize FileSystemWatcher: " + ex.Message);
            }
        }

        private static void OnHistoryChanged(object sender, FileSystemEventArgs e)
        {
            lock (cacheLock)
            {
                if (debounceTimer != null)
                {
                    debounceTimer.Dispose();
                }
                debounceTimer = new Timer(delegate
                {
                    SafeLog("\n[LIVE WATCHER] New run recorded by Slay the Spire 2! Syncing telemetry...");
                    ReloadRuns();
                }, null, 600, Timeout.Infinite);
            }
        }

        private class RunFileInfo
        {
            public string FilePath;
            public long StartTime;
            public DateTime FileTime;
        }

        private static void ReloadRuns()
        {
            lock (cacheLock)
            {
                if (string.IsNullOrEmpty(historyDir) || !Directory.Exists(historyDir))
                {
                    cachedRunsJson = "[]";
                    cachedRunCount = 0;
                    lastCacheUpdate = DateTime.UtcNow.Ticks;
                    return;
                }

                try
                {
                    string[] files = Directory.GetFiles(historyDir, "*.run");
                    List<RunFileInfo> list = new List<RunFileInfo>();

                    Regex startTimeRegex = new Regex("\"start_time\"\\s*:\\s*([0-9]+)", RegexOptions.Compiled);

                    foreach (string f in files)
                    {
                        RunFileInfo rfi = new RunFileInfo();
                        rfi.FilePath = f;
                        rfi.FileTime = File.GetLastWriteTime(f);
                        rfi.StartTime = 0;

                        try
                        {
                            using (FileStream fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                            using (StreamReader sr = new StreamReader(fs, Encoding.UTF8))
                            {
                                char[] buf = new char[2048];
                                int read = sr.Read(buf, 0, buf.Length);
                                string header = new string(buf, 0, read);
                                Match m = startTimeRegex.Match(header);
                                if (m.Success)
                                {
                                    long st;
                                    if (long.TryParse(m.Groups[1].Value, out st))
                                    {
                                        rfi.StartTime = st;
                                    }
                                }
                            }
                        }
                        catch { }

                        list.Add(rfi);
                    }

                    list.Sort(delegate(RunFileInfo a, RunFileInfo b)
                    {
                        if (a.StartTime != b.StartTime)
                        {
                            return b.StartTime.CompareTo(a.StartTime);
                        }
                        return b.FileTime.CompareTo(a.FileTime);
                    });

                    StringBuilder sb = new StringBuilder();
                    sb.Append("[");
                    bool first = true;
                    int count = 0;

                    foreach (RunFileInfo item in list)
                    {
                        try
                        {
                            string content;
                            using (FileStream fs = new FileStream(item.FilePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                            using (StreamReader sr = new StreamReader(fs, Encoding.UTF8))
                            {
                                content = sr.ReadToEnd().Trim();
                            }

                            if (content.StartsWith("{") && content.EndsWith("}"))
                            {
                                // Quote large 64-bit Steam IDs to preserve full precision in JavaScript
                                content = Regex.Replace(content, "\"id\"\\s*:\\s*([0-9]{15,20})", "\"id\":\"$1\"");
                                content = Regex.Replace(content, "\"player_id\"\\s*:\\s*([0-9]{15,20})", "\"player_id\":\"$1\"");

                                if (!string.IsNullOrEmpty(localPlayerId))
                                {
                                    content = "{\"local_player_id\":\"" + localPlayerId + "\"," + content.Substring(1);
                                }

                                if (!first) sb.Append(",");
                                sb.Append(content);
                                first = false;
                                count++;
                            }
                        }
                        catch (Exception ex)
                        {
                            SafeLog("[WARN] Error reading " + Path.GetFileName(item.FilePath) + ": " + ex.Message);
                        }
                    }

                    sb.Append("]");

                    cachedRunsJson = sb.ToString();
                    cachedRunCount = count;
                    lastCacheUpdate = DateTime.UtcNow.Ticks;

                    SafeLog("[CACHE] Successfully loaded " + cachedRunCount + " total climbs from disk.");
                    }
                catch (Exception ex)
                {
                    SafeLog("[ERROR] ReloadRuns failed: " + ex.Message);
                }
            }
        }

        private static void ProcessRequest(object state)
        {
            HttpListenerContext context = (HttpListenerContext)state;
            HttpListenerRequest req = context.Request;
            HttpListenerResponse resp = context.Response;

            try
            {
                resp.AddHeader("Access-Control-Allow-Origin", "*");
                resp.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                resp.AddHeader("Access-Control-Allow-Headers", "Content-Type");

                if (req.HttpMethod == "OPTIONS")
                {
                    resp.StatusCode = 200;
                    resp.Close();
                    return;
                }

                                string rawUrl = req.Url.AbsolutePath;
                if (rawUrl == "/") rawUrl = "/index.html";

                if (rawUrl.Equals("/api/client_closed", StringComparison.OrdinalIgnoreCase))
                {
                    ServeString(resp, "{\"status\":\"closing\"}", "application/json; charset=utf-8", true);
                    if (isUpdatingCompanion) return;
                    int seq = Interlocked.Increment(ref closeSequenceId);
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        Thread.Sleep(2000);
                        if (!isUpdatingCompanion && closeSequenceId == seq)
                        {
                            SafeLog("[LIFECYCLE] Window closed via X button. Shutting down companion cleanly...");
                            try { if (httpListener != null) { httpListener.Stop(); httpListener.Close(); } } catch { }
                            shutdownEvent.Set();
                            Environment.Exit(0);
                        }
                    });
                    return;
                }

                clientConnected = true;
                lastHeartbeat = DateTime.UtcNow;
                Interlocked.Increment(ref closeSequenceId);

                if (rawUrl.Equals("/api/heartbeat", StringComparison.OrdinalIgnoreCase))
                {
                    clientConnected = true;
                    lastHeartbeat = DateTime.UtcNow;
                    ServeString(resp, "{\"status\":\"alive\"}", "application/json; charset=utf-8", true);
                    return;
                }

                if (rawUrl.Equals("/api/shutdown", StringComparison.OrdinalIgnoreCase))
                {
                    string action = req.QueryString["action"];
                    if (action != "exit_app")
                    {
                        SafeLog("[API] Ignored unconfirmed shutdown ping (missing action=exit_app).");
                        ServeString(resp, "{\"status\":\"ignored\"}", "application/json; charset=utf-8", true);
                        return;
                    }

                    SafeLog("[API] /api/shutdown confirmed by user Exit App button. Shutting down companion...");
                    ServeString(resp, "{\"status\":\"shutting_down\"}", "application/json; charset=utf-8", true);
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        Thread.Sleep(500);
                        shutdownEvent.Set();
                    });
                    return;
                }

                if (rawUrl.Equals("/api/runs", StringComparison.OrdinalIgnoreCase))
                {
                    string json;
                    lock (cacheLock)
                    {
                        json = cachedRunsJson;
                    }
                    ServeString(resp, json, "application/json; charset=utf-8", true);
                    return;
                }

                if (rawUrl.Equals("/api/status", StringComparison.OrdinalIgnoreCase))
                {
                    string statusJson;
                    lock (cacheLock)
                    {
                        string safeDir = historyDir != null ? historyDir.Replace("\\", "\\\\") : "";
                        string safePersona = steamPersonaName != null ? steamPersonaName.Replace("\"", "\\\"") : "";
                        string safeAcct = steamAccountName != null ? steamAccountName.Replace("\"", "\\\"") : "";
                        statusJson = string.Format("{{\"status\":\"ok\",\"version\":\"{0}\",\"is_desktop_app\":true,\"run_count\":{1},\"history_dir\":\"{2}\",\"local_player_id\":\"{3}\",\"steam_persona_name\":\"{4}\",\"steam_account_name\":\"{5}\",\"last_update\":{6}}}",
                            AppVersion, cachedRunCount, safeDir, localPlayerId, safePersona, safeAcct, lastCacheUpdate);
                    }
                    ServeString(resp, statusJson, "application/json; charset=utf-8", true);
                    return;
                }

                if (rawUrl.Equals("/api/version", StringComparison.OrdinalIgnoreCase))
                {
                    ServeString(resp, "{\"version\":\"" + AppVersion + "\",\"is_desktop_app\":true}", "application/json; charset=utf-8", true);
                    return;
                }

                if (rawUrl.StartsWith("/api/check_update", StringComparison.OrdinalIgnoreCase) || rawUrl.StartsWith("/version.json", StringComparison.OrdinalIgnoreCase))
                {
                    string remoteVer = GetCachedRemoteVersion();
                    bool updateAvail = IsNewerVersion(remoteVer, AppVersion);
                    string json = string.Format("{{\"version\":\"{0}\",\"current_version\":\"{1}\",\"update_available\":{2},\"is_desktop_app\":true}}",
                        remoteVer, AppVersion, updateAvail ? "true" : "false");
                    ServeString(resp, json, "application/json; charset=utf-8", true);
                    return;
                }

                if (rawUrl.Equals("/api/update", StringComparison.OrdinalIgnoreCase))
                {
                    SafeLog("[API] /api/update triggered from desktop client.");
                    isUpdatingCompanion = true;
                    isUpdatingCompanion = true;
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        PerformAppUpdate();
                    });
                    ServeString(resp, "{\"status\":\"updating\",\"message\":\"Downloading update and restarting...\"}", "application/json; charset=utf-8", true);
                    return;
                }

                if (rawUrl.Equals("/api/progress", StringComparison.OrdinalIgnoreCase))
                {
                    string progressJson = "{}";
                    try
                    {
                        if (!string.IsNullOrEmpty(historyDir))
                        {
                            string parentDir = Path.GetDirectoryName(historyDir);
                            string progFile = Path.Combine(parentDir, "progress.save");
                            if (File.Exists(progFile))
                            {
                                using (FileStream fs = new FileStream(progFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                                using (StreamReader sr = new StreamReader(fs, Encoding.UTF8))
                                {
                                    progressJson = sr.ReadToEnd();
                                }
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        SafeLog("[WARN] Could not read progress.save: " + ex.Message);
                    }

                    ServeString(resp, progressJson, "application/json; charset=utf-8", true);
                    return;
                }

                if (rawUrl.Equals("/api/refresh", StringComparison.OrdinalIgnoreCase))
                {
                    ReloadRuns();
                    ServeString(resp, "{\"refreshed\":true,\"run_count\":" + cachedRunCount + "}", "application/json; charset=utf-8", true);
                    return;
                }

                if (rawUrl.Equals("/api/open_folder", StringComparison.OrdinalIgnoreCase))
                {
                    if (!string.IsNullOrEmpty(historyDir) && Directory.Exists(historyDir))
                    {
                        Process.Start("explorer.exe", historyDir);
                    }
                    ServeString(resp, "{\"opened\":true}", "application/json; charset=utf-8", true);
                    return;
                }

                if (rawUrl.Equals("/api/open_browser", StringComparison.OrdinalIgnoreCase))
                {
                    LaunchClientUi(true);
                    ServeString(resp, "{\"launched\":true}", "application/json; charset=utf-8", true);
                    return;
                }

                if (rawUrl.Equals("/api/open_steam_login", StringComparison.OrdinalIgnoreCase))
                {
                    string returnTo = "http://localhost:" + port + "/api/steam_callback";
                    string realm = "http://localhost:" + port + "/";
                    string steamLoginUrl = "https://steamcommunity.com/openid/login?" +
                        "openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0" +
                        "&openid.mode=checkid_setup" +
                        "&openid.return_to=" + Uri.EscapeDataString(returnTo) +
                        "&openid.realm=" + Uri.EscapeDataString(realm) +
                        "&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select" +
                        "&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select";

                    try
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = steamLoginUrl,
                            UseShellExecute = true
                        });
                        ServeString(resp, "{\"status\":\"ok\",\"launched\":true}", "application/json; charset=utf-8", true);
                    }
                    catch (Exception ex)
                    {
                        ServeString(resp, "{\"status\":\"error\",\"message\":\"" + ex.Message.Replace("\"", "\\\"") + "\"}", "application/json; charset=utf-8", false);
                    }
                    return;
                }

                if (rawUrl.StartsWith("/api/steam_callback", StringComparison.OrdinalIgnoreCase))
                {
                    string claimedId = req.QueryString["openid.claimed_id"];
                    if (string.IsNullOrEmpty(claimedId)) claimedId = req.QueryString["openid.identity"];

                    string authedSteamId = "";
                    if (!string.IsNullOrEmpty(claimedId))
                    {
                        Match m = Regex.Match(claimedId, @"\/id\/([0-9]{15,25})");
                        if (m.Success) authedSteamId = m.Groups[1].Value;
                    }

                    if (!string.IsNullOrEmpty(authedSteamId))
                    {
                        string persona = steamPersonaName;
                        if (string.IsNullOrEmpty(persona) || authedSteamId != localPlayerId)
                        {
                            if (authedSteamId == "76561199078562869") persona = "Apocaelypze";
                            else persona = "SteamUser_" + authedSteamId.Substring(Math.Max(0, authedSteamId.Length - 4));
                        }

                        bool isCreator = (authedSteamId == "76561199078562869" || persona.Equals("Apocaelypze", StringComparison.OrdinalIgnoreCase));

                        pendingAuthSessionJson = string.Format("{{\"username\":\"{0}\",\"steamId\":\"{1}\",\"provider\":\"steam\",\"isCreator\":{2}}}",
                            persona.Replace("\"", "\\\""), authedSteamId, isCreator ? "true" : "false");

                        SafeLog("[AUTH] Steam browser login successful for " + persona + " (" + authedSteamId + ")", ConsoleColor.Green);

                        string html = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Steam Login Successful</title>" +
                            "<style>body { background: #0b0f19; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }" +
                            ".box { background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 16px; padding: 36px 48px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.6); max-width: 480px; }" +
                            "h2 { color: #34d399; margin: 12px 0 8px 0; font-size: 22px; }" +
                            "p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 18px 0; }" +
                            ".user { font-weight: 700; color: #fff; background: rgba(255,255,255,0.06); padding: 4px 12px; border-radius: 6px; font-size: 15px; }" +
                            "</style></head><body>" +
                            "<div class='box'><div style='font-size: 48px;'>🎮</div>" +
                            "<h2>Signed In with Steam!</h2>" +
                            "<p>Authenticated as <span class='user'>" + persona + "</span></p>" +
                            "<p style='color: #64748b; font-size: 13px;'>You can close this browser tab and return to the <strong>STS2 Tracker Companion</strong> window.</p>" +
                            "<script>setTimeout(function(){ window.close(); }, 3000);</script>" +
                            "</div></body></html>";

                        ServeString(resp, html, "text/html; charset=utf-8", false);
                        return;
                    }
                    else
                    {
                        string errHtml = "<html><body style='background:#0b0f19;color:#f87171;font-family:sans-serif;text-align:center;padding:50px;'>" +
                            "<h2>Steam Authentication Cancelled or Failed</h2>" +
                            "<p>Please return to the STS2 Tracker app window and try again.</p></body></html>";
                        ServeString(resp, errHtml, "text/html; charset=utf-8", false);
                        return;
                    }
                }

                if (rawUrl.Equals("/api/auth_session", StringComparison.OrdinalIgnoreCase))
                {
                    string json = pendingAuthSessionJson;
                    ServeString(resp, json != null ? json : "{}", "application/json; charset=utf-8", true);
                    return;
                }

                if (rawUrl.Equals("/api/auth_session/clear", StringComparison.OrdinalIgnoreCase))
                {
                    pendingAuthSessionJson = null;
                    ServeString(resp, "{\"cleared\":true}", "application/json; charset=utf-8", true);
                    return;
                }

                if (rawUrl.Equals("/STS2Tracker.exe", StringComparison.OrdinalIgnoreCase))
                {
                    string exePath = Assembly.GetExecutingAssembly().Location;
                    if (File.Exists(exePath))
                    {
                        byte[] exeBytes = File.ReadAllBytes(exePath);
                        resp.ContentType = "application/x-msdownload";
                        resp.AddHeader("Content-Disposition", "attachment; filename=\"STS2Tracker.exe\"");
                        ServeBytes(resp, exeBytes, "application/x-msdownload", false);
                        return;
                    }
                }

                // 1. Check local file on disk if webDir override exists
                string relPath = rawUrl.TrimStart('/').Replace('\\', '/');
                if (!string.IsNullOrEmpty(webDir))
                {
                    string diskPath = Path.Combine(webDir, relPath.Replace('/', Path.DirectorySeparatorChar));
                    if (File.Exists(diskPath))
                    {
                        byte[] fileBytes = File.ReadAllBytes(diskPath);
                        ServeBytes(resp, fileBytes, GetMimeType(diskPath), IsNoCache(diskPath));
                        return;
                    }

                    // Check image format fallback on disk (.webp <-> .png)
                    if (relPath.EndsWith(".webp", StringComparison.OrdinalIgnoreCase))
                    {
                        string altDisk = Path.Combine(webDir, (relPath.Substring(0, relPath.Length - 5) + ".png").Replace('/', Path.DirectorySeparatorChar));
                        if (File.Exists(altDisk))
                        {
                            ServeBytes(resp, File.ReadAllBytes(altDisk), "image/png", false);
                            return;
                        }
                    }
                    else if (relPath.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
                    {
                        string altDisk = Path.Combine(webDir, (relPath.Substring(0, relPath.Length - 4) + ".webp").Replace('/', Path.DirectorySeparatorChar));
                        if (File.Exists(altDisk))
                        {
                            ServeBytes(resp, File.ReadAllBytes(altDisk), "image/webp", false);
                            return;
                        }
                    }
                }

                // 2. Fallback: Check primary embedded web resources (index.html & sts2_data.json)
                if (relPath == "index.html" || string.IsNullOrEmpty(relPath))
                {
                    byte[] fileBytes = GetEmbeddedBytes("index.html");
                    if (fileBytes != null)
                    {
                        ServeBytes(resp, fileBytes, "text/html; charset=utf-8", true);
                        return;
                    }
                }

                if (relPath.Equals("favicon.ico", StringComparison.OrdinalIgnoreCase))
                {
                    byte[] icoBytes = GetEmbeddedBytes("favicon.ico");
                    if (icoBytes != null)
                    {
                        ServeBytes(resp, icoBytes, "image/x-icon", false);
                        return;
                    }
                }

                if (relPath.Equals("data/sts2_data.json", StringComparison.OrdinalIgnoreCase))
                {
                    byte[] fileBytes = GetEmbeddedBytes("sts2_data.json");
                    if (fileBytes != null)
                    {
                        ServeBytes(resp, fileBytes, "application/json; charset=utf-8", true);
                        return;
                    }
                }

                // 3. Fallback: Check in-memory embedded game assets dictionary (characters & relics)
                string normKey = relPath.StartsWith("web/", StringComparison.OrdinalIgnoreCase) ? relPath.Substring(4) : relPath;
                if (embeddedAssets.ContainsKey(relPath))
                {
                    ServeBytes(resp, embeddedAssets[relPath], GetMimeType(relPath), false);
                    return;
                }
                if (embeddedAssets.ContainsKey(normKey))
                {
                    ServeBytes(resp, embeddedAssets[normKey], GetMimeType(normKey), false);
                    return;
                }

                // Embedded asset format fallback (.webp <-> .png)
                if (normKey.EndsWith(".webp", StringComparison.OrdinalIgnoreCase))
                {
                    string altKey = normKey.Substring(0, normKey.Length - 5) + ".png";
                    if (embeddedAssets.ContainsKey(altKey))
                    {
                        ServeBytes(resp, embeddedAssets[altKey], "image/png", false);
                        return;
                    }
                }
                else if (normKey.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
                {
                    string altKey = normKey.Substring(0, normKey.Length - 4) + ".webp";
                    if (embeddedAssets.ContainsKey(altKey))
                    {
                        ServeBytes(resp, embeddedAssets[altKey], "image/webp", false);
                        return;
                    }
                }

                // 404 Not Found
                resp.StatusCode = 404;
                byte[] notFound = Encoding.UTF8.GetBytes("404 Not Found");
                resp.OutputStream.Write(notFound, 0, notFound.Length);
                resp.Close();
            }
            catch (Exception ex)
            {
                try
                {
                    resp.StatusCode = 500;
                    byte[] err = Encoding.UTF8.GetBytes("500 Server Error: " + ex.Message);
                    resp.OutputStream.Write(err, 0, err.Length);
                    resp.Close();
                }
                catch { }
            }
        }

        private static byte[] GetEmbeddedBytes(string resourceName)
        {
            try
            {
                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
                {
                    if (stream != null)
                    {
                        byte[] bytes = new byte[stream.Length];
                        stream.Read(bytes, 0, bytes.Length);
                        return bytes;
                    }
                }
            }
            catch { }
            return null;
        }

        private static void ServeString(HttpListenerResponse resp, string text, string mime, bool noCache)
        {
            byte[] data = Encoding.UTF8.GetBytes(text);
            ServeBytes(resp, data, mime, noCache);
        }

        private static void ServeBytes(HttpListenerResponse resp, byte[] data, string mime, bool noCache)
        {
            resp.ContentType = mime;
            resp.ContentLength64 = data.Length;
            resp.StatusCode = 200;

            if (noCache)
            {
                resp.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
                resp.Headers["Pragma"] = "no-cache";
                resp.Headers["Expires"] = "0";
            }
            else
            {
                resp.Headers["Cache-Control"] = "public, max-age=86400";
            }

            try
            {
                resp.OutputStream.Write(data, 0, data.Length);
            }
            catch { }
            try
            {
                resp.Close();
            }
            catch { }
        }

        private static bool IsNoCache(string path)
        {
            string ext = Path.GetExtension(path).ToLowerInvariant();
            return ext == ".html" || ext == ".json" || ext == ".js" || ext == ".css";
        }


        private static void PerformAppUpdate()
        {
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls12;
                string exePath = Assembly.GetExecutingAssembly().Location;
                string exeDir = Path.GetDirectoryName(exePath);
                string newExePath = Path.Combine(exeDir, "STS2Tracker_new.exe");
                string tempZipPath = Path.Combine(exeDir, "STS2Tracker_update.zip");
                string batPath = Path.Combine(exeDir, "update_sts2tracker.bat");

                SafeLog("[UPDATE] Downloading latest STS2Tracker from cloud...", ConsoleColor.Cyan);
                using (WebClient wc = new WebClient())
                {
                    wc.Headers.Add("User-Agent", "STS2Tracker-AutoUpdater/" + AppVersion);
                    if (File.Exists(newExePath)) { try { File.Delete(newExePath); } catch {} }

                    // 1. Try downloading direct STS2Tracker.exe from GitHub Releases
                    try
                    {
                        wc.DownloadFile("https://github.com/Apocaelypze/sts2-tracker/releases/latest/download/STS2Tracker.exe", newExePath);
                    }
                    catch (Exception exDl)
                    {
                        SafeLog("[UPDATE] Direct exe download notice: " + exDl.Message, ConsoleColor.Yellow);
                    }

                    // 2. Fallback: If direct exe download failed or is too small, fetch STS2Tracker.zip
                    if (!File.Exists(newExePath) || new FileInfo(newExePath).Length < 1000000)
                    {
                        SafeLog("[UPDATE] Falling back to update archive package...", ConsoleColor.Cyan);
                        if (File.Exists(tempZipPath)) { try { File.Delete(tempZipPath); } catch {} }
                        wc.DownloadFile("https://slay-the-spire-2-tracker.web.app/STS2Tracker.zip", tempZipPath);

                        if (File.Exists(tempZipPath) && new FileInfo(tempZipPath).Length > 10000)
                        {
                            using (ZipArchive archive = ZipFile.OpenRead(tempZipPath))
                            {
                                ZipArchiveEntry entry = archive.GetEntry("STS2Tracker.exe");
                                if (entry != null)
                                {
                                    if (File.Exists(newExePath)) { try { File.Delete(newExePath); } catch {} }
                                    entry.ExtractToFile(newExePath, true);
                                }
                            }
                            try { File.Delete(tempZipPath); } catch {}
                        }
                    }
                }

                if (!File.Exists(newExePath) || new FileInfo(newExePath).Length < 1000000)
                {
                    SafeLog("[UPDATE ERROR] Downloaded executable is invalid or incomplete.", ConsoleColor.Red);
                    return;
                }

                long sizeMb = new FileInfo(newExePath).Length / 1024 / 1024;
                SafeLog("[UPDATE] Update download complete (" + sizeMb + " MB). Spawning updater script...", ConsoleColor.Green);

                string batContent =
                    "@echo off\r\n" +
                    "timeout /t 1 /nobreak >nul\r\n" +
                    "taskkill /f /im STS2Tracker.exe >nul 2>&1\r\n" +
                    "set retry_count=0\r\n" +
                    ":retry_loop\r\n" +
                    "set /a retry_count+=1\r\n" +
                    "move /y \"" + newExePath + "\" \"" + exePath + "\" >nul 2>&1\r\n" +
                    "if not errorlevel 1 goto move_ok\r\n" +
                    "if %retry_count% geq 25 goto move_timeout\r\n" +
                    "timeout /t 1 /nobreak >nul\r\n" +
                    "taskkill /f /im STS2Tracker.exe >nul 2>&1\r\n" +
                    "goto retry_loop\r\n" +
                    ":move_ok\r\n" +
                    "if exist \"%~dp0tracker_runtime.log\" del \"%~dp0tracker_runtime.log\" >nul 2>&1\r\n" +
                    "ie4uinit.exe -show >nul 2>&1\r\n" +
                    "start \"\" \"" + exePath + "\" --no-browser\r\n" +
                    "del \"%~f0\"\r\n" +
                    "exit\r\n" +
                    ":move_timeout\r\n" +
                    "del \"%~f0\"\r\n" +
                    "exit\r\n";

                try { File.WriteAllText(Path.Combine(exeDir, ".sts2_updating"), "1", Encoding.ASCII); } catch { }
                File.WriteAllText(batPath, batContent, Encoding.ASCII);

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "cmd.exe";
                psi.Arguments = "/c \"" + batPath + "\"";
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                Process.Start(psi);

                SafeLog("[UPDATE] Updater launched successfully. Shutting down current instance...", ConsoleColor.Yellow);
                try { if (httpListener != null) { httpListener.Stop(); httpListener.Close(); } } catch { }
                Environment.Exit(0);
            }
            catch (Exception ex)
            {
                SafeLog("[UPDATE EXCEPTION] " + ex.Message, ConsoleColor.Red);
            }
        }

        private static string cachedRemoteVersion = "v1.2.7";
        private static DateTime lastRemoteCheck = DateTime.MinValue;

        private static string GetCachedRemoteVersion()
        {
            if ((DateTime.UtcNow - lastRemoteCheck).TotalSeconds < 60)
            {
                return cachedRemoteVersion;
            }

            try
            {
                lastRemoteCheck = DateTime.UtcNow;
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls12;
                using (WebClient wc = new WebClient())
                {
                    wc.Headers.Add("User-Agent", "STS2Tracker/" + AppVersion);
                    string ghJson = wc.DownloadString("https://api.github.com/repos/Apocaelypze/sts2-tracker/releases/latest");
                    int tagIdx = ghJson.IndexOf("\"tag_name\":");
                    if (tagIdx != -1)
                    {
                        int startQuote = ghJson.IndexOf('"', tagIdx + 11);
                        int endQuote = ghJson.IndexOf('"', startQuote + 1);
                        if (startQuote != -1 && endQuote != -1)
                        {
                            string tag = ghJson.Substring(startQuote + 1, endQuote - startQuote - 1).Trim();
                            if (tag.StartsWith("v"))
                            {
                                cachedRemoteVersion = tag;
                            }
                        }
                    }
                }
            }
            catch { }

            return cachedRemoteVersion;
        }

        private static bool IsNewerVersion(string remote, string local)
        {
            if (string.IsNullOrEmpty(remote) || string.IsNullOrEmpty(local)) return false;
            string[] rParts = remote.TrimStart('v', 'V').Split('.');
            string[] lParts = local.TrimStart('v', 'V').Split('.');
            for (int i = 0; i < Math.Max(rParts.Length, lParts.Length); i++)
            {
                int r = 0, l = 0;
                if (i < rParts.Length) int.TryParse(rParts[i], out r);
                if (i < lParts.Length) int.TryParse(lParts[i], out l);
                if (r > l) return true;
                if (r < l) return false;
            }
            return false;
        }

        private static void SafeLog(string msg, ConsoleColor? color = null)
        {
            try
            {
                if (color.HasValue) Console.ForegroundColor = color.Value;
                Console.WriteLine(msg);
                if (color.HasValue) Console.ResetColor();
            }
            catch { }
        }

        private static string GetMimeType(string path)
        {
            string ext = Path.GetExtension(path).ToLowerInvariant();
            switch (ext)
            {
                case ".html": return "text/html; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".js": return "application/javascript; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".sts2run": return "application/json; charset=utf-8";
                case ".webp": return "image/webp";
                case ".png": return "image/png";
                case ".jpg":
                case ".jpeg": return "image/jpeg";
                case ".svg": return "image/svg+xml";
                case ".ico": return "image/x-icon";
                default: return "application/octet-stream";
            }
        }
    }
}
