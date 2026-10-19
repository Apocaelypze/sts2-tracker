const fs = require('fs');
const path = require('path');

const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

let eventChoiceSamples = [];

for (const f of files) {
  const raw = fs.readFileSync(path.join(runsDir, f), 'utf8');
  const safeJson = raw.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const run = JSON.parse(safeJson);

  if (run.map_point_history) {
    run.map_point_history.forEach((act, actIdx) => {
      (Array.isArray(act) ? act : [act]).forEach(node => {
        const ps = (node.player_stats && node.player_stats[0]) || {};
        const roomModel = (node.rooms && node.rooms[0] && (node.rooms[0].model_id || node.rooms[0].room_type)) || 'UNKNOWN';

        if (ps.event_choices && ps.event_choices.length > 0) {
          eventChoiceSamples.push({ roomModel, events: ps.event_choices });
        }
      });
    });
  }
}

console.log('Total event_choices samples:', eventChoiceSamples.length);
if (eventChoiceSamples.length > 0) {
  console.log('Event choice sample 0:', JSON.stringify(eventChoiceSamples[0], null, 2));
}
if (eventChoiceSamples.length > 5) {
  console.log('Event choice sample 5:', JSON.stringify(eventChoiceSamples[5], null, 2));
}
