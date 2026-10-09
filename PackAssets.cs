using System;
using System.IO;
using System.IO.Compression;

class Program
{
    static void Main()
    {
        string rootDir = @"C:\Users\wjb21\Desktop\Antigravity Work\sts2_tracker";
        string zipPath = Path.Combine(rootDir, "assets.zip");
        string webAssetsDir = Path.Combine(rootDir, @"web\assets");

        if (File.Exists(zipPath)) File.Delete(zipPath);

        int count = 0;
        using (var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create))
        {
            // 1. Characters
            string charDir = Path.Combine(webAssetsDir, "characters");
            if (Directory.Exists(charDir))
            {
                foreach (var f in Directory.GetFiles(charDir))
                {
                    string entryName = "assets/characters/" + Path.GetFileName(f);
                    zip.CreateEntryFromFile(f, entryName, CompressionLevel.Optimal);
                    count++;
                }
            }

            // 2. Relics
            string relicDir = Path.Combine(webAssetsDir, "relics");
            if (Directory.Exists(relicDir))
            {
                foreach (var f in Directory.GetFiles(relicDir))
                {
                    string entryName = "assets/relics/" + Path.GetFileName(f);
                    zip.CreateEntryFromFile(f, entryName, CompressionLevel.Optimal);
                    count++;
                }
            }

            // 3. Cards (.png files)
            string cardDir = Path.Combine(webAssetsDir, "cards");
            if (Directory.Exists(cardDir))
            {
                foreach (var f in Directory.GetFiles(cardDir, "*.png"))
                {
                    string entryName = "assets/cards/" + Path.GetFileName(f);
                    zip.CreateEntryFromFile(f, entryName, CompressionLevel.Optimal);
                    count++;
                }
                // Also add strike.webp and defend.webp if present
                foreach (var f in Directory.GetFiles(cardDir, "*.webp"))
                {
                    string fn = Path.GetFileName(f).ToLowerInvariant();
                    if (fn == "strike.webp" || fn == "defend.webp")
                    {
                        string entryName = "assets/cards/" + fn;
                        zip.CreateEntryFromFile(f, entryName, CompressionLevel.Optimal);
                        count++;
                    }
                }
            }
        }

        long sizeBytes = new FileInfo(zipPath).Length;
        double sizeMb = Math.Round(sizeBytes / (1024.0 * 1024.0), 2);
        Console.WriteLine("Packed " + count + " assets into assets.zip (" + sizeMb + " MB).");
    }
}
