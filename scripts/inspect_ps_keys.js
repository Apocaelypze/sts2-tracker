const fs = require('fs');
const content = fs.readFileSync('C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history/1791833934.run', 'utf8');
const safeJson = content.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
const run = JSON.parse(safeJson);
const fl0 = run.map_point_history[0][0];
console.log('fl keys:', Object.keys(fl0));
const ps0 = fl0.player_stats[0];
console.log('ps keys:', Object.keys(ps0));

// Search for any combat details or cards played
let allPsKeys = new Set();
run.map_point_history.forEach(act => {
  (Array.isArray(act) ? act : [act]).forEach(fl => {
    (fl.player_stats || []).forEach(ps => {
      Object.keys(ps).forEach(k => allPsKeys.add(k));
    });
  });
});
console.log('All player_stats keys across all floors:', Array.from(allPsKeys));
