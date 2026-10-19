using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
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
        private static readonly string AppVersion = "v0.19";

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
            KillPreviousInstances();

            // 2. Pre-load embedded assets (characters & relics) into memory
            LoadEmbeddedAssets();

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

            // 5. Initial Load of Runs
            ReloadRuns();

            // 6. Start Resilient HTTP Server (Port scanning from 8383 to 8390)
            HttpListener listener = StartHttpServer();
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

            if (!noBrowser)
            {
                LaunchClientUi();
            }

            SafeLog("-------------------------------------------------");
            SafeLog("[STATUS] Real-time tracking is ACTIVE!");
            SafeLog("Keep this application running in background while playing.");
            SafeLog("Hotkeys: [R] Refresh  [O] Open Folder  [B] Re-open Window  [Q] Exit");
            SafeLog("-------------------------------------------------");

            // 8. Start Watchdog Thread for Auto-Shutdown when App Window Closes
            ThreadPool.QueueUserWorkItem(delegate
            {
                while (!shutdownEvent.WaitOne(1500))
                {
                    double elapsedSinceStart = (DateTime.UtcNow - serverStartTime).TotalSeconds;
                    double elapsedSinceHeartbeat = (DateTime.UtcNow - lastHeartbeat).TotalSeconds;

                    // If client connected and hasn't pinged for 6 seconds -> window closed!
                    if (clientConnected && elapsedSinceHeartbeat > 6.0)
                    {
                        SafeLog("[WATCHDOG] Client disconnected for " + elapsedSinceHeartbeat.ToString("F1") + "s. Window closed. Shutting down.");
                        shutdownEvent.Set();
                        break;
                    }

                    // If no browser connected within 45 seconds after launch -> orphan protection
                    if (!clientConnected && elapsedSinceStart > 45.0)
                    {
                        SafeLog("[WATCHDOG] No client connected within 45s of launch. Triggering orphan shutdown.");
                        shutdownEvent.Set();
                        break;
                    }
                }
            });

            // 9. Wait for Shutdown Signal (Window closed or API shutdown)
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
            for (int tryPort = 8383; tryPort <= 8390; tryPort++)
            {
                HttpListener l = new HttpListener();
                try
                {
                    l.Prefixes.Add("http://localhost:" + tryPort + "/");
                    l.Prefixes.Add("http://127.0.0.1:" + tryPort + "/");
                    l.Start();
                    port = tryPort;
                    SafeLog("[SERVER] Live Dashboard active at: http://localhost:" + port + "/");
                    return l;
                }
                catch (Exception)
                {
                    l.Close();
                }
            }
            return null;
        }

        private static void LaunchClientUi()
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                Thread.Sleep(300);
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

                if (rawUrl.Equals("/api/heartbeat", StringComparison.OrdinalIgnoreCase))
                {
                    clientConnected = true;
                    lastHeartbeat = DateTime.UtcNow;
                    ServeString(resp, "{\"status\":\"alive\"}", "application/json; charset=utf-8", true);
                    return;
                }

                if (rawUrl.Equals("/api/shutdown", StringComparison.OrdinalIgnoreCase))
                {
                    SafeLog("[API] /api/shutdown endpoint reached from browser.");
                    ServeString(resp, "{\"status\":\"shutting_down\"}", "application/json; charset=utf-8", true);
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        Thread.Sleep(2000);
                        double gap = (DateTime.UtcNow - lastHeartbeat).TotalSeconds;
                        if (gap > 1.8)
                        {
                            SafeLog("[API] Shutdown confirmed (heartbeat gap " + gap.ToString("F1") + "s > 1.8s). Setting shutdownEvent.");
                            shutdownEvent.Set();
                        }
                        else
                        {
                            SafeLog("[API] Shutdown aborted: browser reconnected (heartbeat gap " + gap.ToString("F1") + "s).");
                        }
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
                        statusJson = string.Format("{{\"status\":\"ok\",\"version\":\"{0}\",\"is_desktop_app\":true,\"run_count\":{1},\"history_dir\":\"{2}\",\"local_player_id\":\"{3}\",\"last_update\":{4}}}",
                            AppVersion, cachedRunCount, safeDir, localPlayerId, lastCacheUpdate);
                    }
                    ServeString(resp, statusJson, "application/json; charset=utf-8", true);
                    return;
                }

                if (rawUrl.Equals("/api/version", StringComparison.OrdinalIgnoreCase))
                {
                    ServeString(resp, "{\"version\":\"" + AppVersion + "\",\"is_desktop_app\":true}", "application/json; charset=utf-8", true);
                    return;
                }

                if (rawUrl.Equals("/api/update", StringComparison.OrdinalIgnoreCase))
                {
                    SafeLog("[API] /api/update triggered from desktop client.");
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
                    LaunchClientUi();
                    ServeString(resp, "{\"launched\":true}", "application/json; charset=utf-8", true);
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

                    // 1. Try downloading direct STS2Tracker.exe
                    try
                    {
                        wc.DownloadFile("https://slay-the-spire-2-tracker.web.app/STS2Tracker.exe", newExePath);
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
                    "timeout /t 1 /nobreak >nul\r\n" +
                    "move /y \"" + newExePath + "\" \"" + exePath + "\" >nul\r\n" +
                    "start \"\" \"" + exePath + "\"\r\n" +
                    "del \"%~f0\"\r\n";

                File.WriteAllText(batPath, batContent, Encoding.ASCII);

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "cmd.exe";
                psi.Arguments = "/c \"" + batPath + "\"";
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                Process.Start(psi);

                SafeLog("[UPDATE] Updater launched successfully. Shutting down current instance...", ConsoleColor.Yellow);
                Environment.Exit(0);
            }
            catch (Exception ex)
            {
                SafeLog("[UPDATE EXCEPTION] " + ex.Message, ConsoleColor.Red);
            }
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
            try
            {
                string logFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "tracker_runtime.log");
                File.AppendAllText(logFile, "[" + DateTime.UtcNow.ToString("HH:mm:ss.fff") + "] " + msg + "\r\n");
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