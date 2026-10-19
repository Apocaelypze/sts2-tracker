const fs = require('fs');
const path = require('path');

const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

let matchedShop = 0;
let unmatchedShop = 0;

files.forEach(f => {
  const raw = fs.readFileSync(path.join(runsDir, f), 'utf8');
  const safeJson = raw.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const run = JSON.parse(safeJson);
  const p = run.players ? run.players[0] : null;
  if (!p) return;

  const deckRelicIds = new Set((p.relics || []).map(r => r.id));

  if (run.map_point_history) {
    run.map_point_history.forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(node => {
        const ps = (node.player_stats && node.player_stats[0]) || {};
        if (ps.bought_relics) {
          ps.bought_relics.forEach(bId => {
            if (deckRelicIds.has(bId)) matchedShop++;
            else {
              console.log('Unmatched bought relic:', bId, 'deckRelics sample:', Array.from(deckRelicIds).slice(0, 3));
              unmatchedShop++;
            }
          });
        }
      });
    });
  }
});

console.log('Matched shop relics:', matchedShop, 'Unmatched:', unmatchedShop);
