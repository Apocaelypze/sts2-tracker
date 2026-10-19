const fs = require('fs');
const path = require('path');

const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

let allBoughtRelics = [];

files.forEach(f => {
  const raw = fs.readFileSync(path.join(runsDir, f), 'utf8');
  const safeJson = raw.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const run = JSON.parse(safeJson);

  if (run.map_point_history) {
    run.map_point_history.forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(node => {
        const ps = (node.player_stats && node.player_stats[0]) || {};
        if (ps.bought_relics && ps.bought_relics.length > 0) {
          allBoughtRelics.push({ room: node.rooms && node.rooms[0], bought: ps.bought_relics });
        }
      });
    });
  }
});

console.log('Total bought_relics nodes:', allBoughtRelics.length);
if (allBoughtRelics.length > 0) {
  console.log('Sample bought relics 0:', JSON.stringify(allBoughtRelics[0], null, 2));
  console.log('Sample bought relics 1:', JSON.stringify(allBoughtRelics[1], null, 2));
}
