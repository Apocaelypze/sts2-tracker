const fs = require('fs');
const path = require('path');

const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

const roomTypes = {};

files.forEach(f => {
  const raw = fs.readFileSync(path.join(runsDir, f), 'utf8');
  const safeJson = raw.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const run = JSON.parse(safeJson);

  if (run.map_point_history) {
    run.map_point_history.forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(node => {
        const ps = (node.player_stats && node.player_stats[0]) || {};
        if (ps.relic_choices && ps.relic_choices.length > 0) {
          const rm = node.rooms && node.rooms[0];
          const rt = rm ? (rm.room_type || rm.model_id) : 'unknown';
          const modelId = rm ? (rm.model_id || '') : '';
          const key = rt + ' | ' + modelId;
          roomTypes[key] = (roomTypes[key] || 0) + ps.relic_choices.length;
        }
      });
    });
  }
});

console.log('Room types with relic_choices:', JSON.stringify(roomTypes, null, 2));
