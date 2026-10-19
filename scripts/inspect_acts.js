const fs = require('fs');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

const actStats = {};
files.forEach(f => {
  const raw = fs.readFileSync(runsDir + '/' + f, 'utf8').replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const r = JSON.parse(raw);
  const hist = r.map_point_history || [];
  const acts = r.acts || [];
  const won = !!r.win;

  hist.forEach((actPath, idx) => {
    const actId = acts[idx] || ('ACT.' + (idx + 1));
    if (!actStats[actId]) actStats[actId] = { entered: 0, cleared: 0, deaths: 0 };
    actStats[actId].entered++;
    const isLast = (idx === hist.length - 1);
    if (!isLast || won) {
      actStats[actId].cleared++;
    } else {
      actStats[actId].deaths++;
    }
  });
});
console.log('Act Stats:', JSON.stringify(actStats, null, 2));

const act1Total = (actStats['ACT.OVERGROWTH']?.entered || 0) + (actStats['ACT.UNDERDOCKS']?.entered || 0);
console.log('Act 1 Total Entered:', act1Total);
console.log('Act 1 Total Cleared (survived to Act 2):', (actStats['ACT.OVERGROWTH']?.cleared || 0) + (actStats['ACT.UNDERDOCKS']?.cleared || 0));
console.log('Act 2 The Hive Entered:', actStats['ACT.HIVE']?.entered, 'Cleared (survived to Act 3):', actStats['ACT.HIVE']?.cleared, 'Deaths:', actStats['ACT.HIVE']?.deaths);
console.log('Act 3 Glory Entered:', actStats['ACT.GLORY']?.entered, 'Cleared (Spire Victories!):', actStats['ACT.GLORY']?.cleared, 'Deaths:', actStats['ACT.GLORY']?.deaths);
console.log('Sum of Cleared across all 4 cards:', (actStats['ACT.OVERGROWTH']?.cleared || 0) + (actStats['ACT.UNDERDOCKS']?.cleared || 0) + (actStats['ACT.HIVE']?.cleared || 0) + (actStats['ACT.GLORY']?.cleared || 0));
