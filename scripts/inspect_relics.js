const fs = require('fs');
const path = require('path');

const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

let relicChoiceSamples = [];
let boughtRelicSamples = [];
let ancientChoiceSamples = [];
let roomTypesWithRelics = new Set();
let allNodePlayerStatsKeys = new Set();

for (const f of files) {
  const raw = fs.readFileSync(path.join(runsDir, f), 'utf8');
  const safeJson = raw.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const run = JSON.parse(safeJson);

  if (run.map_point_history) {
    run.map_point_history.forEach((act, actIdx) => {
      (Array.isArray(act) ? act : [act]).forEach(node => {
        const ps = (node.player_stats && node.player_stats[0]) || {};
        for (const k in ps) allNodePlayerStatsKeys.add(k);

        const roomModel = (node.rooms && node.rooms[0] && (node.rooms[0].model_id || node.rooms[0].room_type)) || 'UNKNOWN';

        if (ps.relic_choices && ps.relic_choices.length > 0) {
          relicChoiceSamples.push({ roomModel, choices: ps.relic_choices });
        }
        if (ps.bought_relics && ps.bought_relics.length > 0) {
          boughtRelicSamples.push({ roomModel, bought: ps.bought_relics });
        }
        if (ps.ancient_choice && ps.ancient_choice.length > 0) {
          ancientChoiceSamples.push({ roomModel, ancients: ps.ancient_choice });
        }
      });
    });
  }
}

console.log('All player_stats keys in map nodes:', Array.from(allNodePlayerStatsKeys));
console.log('Total relic_choices samples:', relicChoiceSamples.length);
if (relicChoiceSamples.length > 0) console.log('Relic choices sample 0:', JSON.stringify(relicChoiceSamples[0], null, 2));
if (relicChoiceSamples.length > 1) console.log('Relic choices sample 1:', JSON.stringify(relicChoiceSamples[1], null, 2));

console.log('Total bought_relics samples:', boughtRelicSamples.length);
if (boughtRelicSamples.length > 0) console.log('Bought relics sample 0:', JSON.stringify(boughtRelicSamples[0], null, 2));

console.log('Total ancient_choice samples:', ancientChoiceSamples.length);
if (ancientChoiceSamples.length > 0) console.log('Ancient choices sample 0:', JSON.stringify(ancientChoiceSamples[0], null, 2));
