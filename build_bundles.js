const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const webHtmlPath = path.join(rootDir, 'web/index.html');
const dataJsonPath = path.join(rootDir, 'web/data/sts2_data.json');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const progSavePath = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/progress.save';

const indexHtml = fs.readFileSync(webHtmlPath, 'utf8');
const dataJson = fs.readFileSync(dataJsonPath, 'utf8');

let progressJson = '{}';
if (fs.existsSync(progSavePath)) {
  try {
    progressJson = fs.readFileSync(progSavePath, 'utf8');
  } catch (e) {
    console.warn('Error reading progress.save:', e.message);
  }
}

// 1. Build STS2_Run_Tracker_Web.html (HTML with embedded gameDatabase + progress)
const embeddedDataScript = `\n  <script>\n  window.EMBEDDED_STS2_DATA = ${dataJson};\n  window.EMBEDDED_PROGRESS = ${progressJson};\n  </script>\n`;
const webBundle = indexHtml.replace('</head>', `${embeddedDataScript}</head>`);
fs.writeFileSync(path.join(rootDir, 'STS2_Run_Tracker_Web.html'), webBundle, 'utf8');
console.log('[OK] Generated STS2_Run_Tracker_Web.html');

// 2. Build STS2_Runs_Dashboard_Offline.html (HTML with embedded gameDatabase + progress + embedded runs)
const runFiles = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));
const loadedRuns = [];

runFiles.forEach(f => {
  try {
    const raw = fs.readFileSync(path.join(runsDir, f), 'utf8');
    const safeJson = raw.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
    const obj = JSON.parse(safeJson);
    obj.local_player_id = '76561199078562869';
    loadedRuns.push(obj);
  } catch (e) {
    console.warn('Error reading ' + f, e.message);
  }
});

// Sort by start_time descending
loadedRuns.sort((a, b) => (b.start_time || 0) - (a.start_time || 0));

const embeddedRunsScript = `\n  <script>\n  window.EMBEDDED_STS2_DATA = ${dataJson};\n  window.EMBEDDED_PROGRESS = ${progressJson};\n  window.OFFLINE_RUNS = ${JSON.stringify(loadedRuns)};\n  </script>\n`;
const offlineBundle = indexHtml.replace('</head>', `${embeddedRunsScript}</head>`);
fs.writeFileSync(path.join(rootDir, 'STS2_Runs_Dashboard_Offline.html'), offlineBundle, 'utf8');
console.log(`[OK] Generated STS2_Runs_Dashboard_Offline.html with ${loadedRuns.length} runs`);
