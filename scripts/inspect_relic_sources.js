const fs = require('fs');
const path = require('path');

const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

let relicSourceStats = {};

files.forEach(f => {
  const raw = fs.readFileSync(path.join(runsDir, f), 'utf8');
  const safeJson = raw.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const run = JSON.parse(safeJson);
  const p = run.players ? run.players[0] : null;
  if (!p) return;

  const floorRelicAcquisitions = {}; // relicId -> { source: 'boss'|'shop'|'ancient'|'chest'|'elite'|'combat'|'event'|'starter' }
  const runBought = new Set();
  const runAncientPicked = new Set();
  const runChoicePicked = new Set();
  const runChoiceOffered = {};

  if (run.map_point_history) {
    run.map_point_history.forEach((act, actIdx) => {
      (Array.isArray(act) ? act : [act]).forEach(node => {
        const ps = (node.player_stats && node.player_stats[0]) || {};
        const roomType = (node.rooms && node.rooms[0] && (node.rooms[0].room_type || node.rooms[0].model_id)) || '';

        // Bought relics (Shop)
        if (ps.bought_relics) {
          ps.bought_relics.forEach(rId => {
            runBought.add(rId);
            floorRelicAcquisitions[rId] = 'shop';
          });
        }

        // Ancient choices
        if (ps.ancient_choice) {
          ps.ancient_choice.forEach(ch => {
            const rId = ch.TextKey && (ch.TextKey.startsWith('RELIC.') ? ch.TextKey : ('RELIC.' + ch.TextKey));
            if (rId) {
              runChoiceOffered[rId] = (runChoiceOffered[rId] || 0) + 1;
              if (ch.was_chosen) {
                runAncientPicked.add(rId);
                floorRelicAcquisitions[rId] = 'ancient';
              }
            }
          });
        }

        // Relic choices (Boss chest, Elite combat drops, Treasure chests)
        if (ps.relic_choices) {
          const isBoss = roomType.toLowerCase().includes('boss');
          const isTreasure = roomType.toLowerCase().includes('treasure') || roomType.toLowerCase().includes('chest');
          const isElite = roomType.toLowerCase().includes('elite');

          ps.relic_choices.forEach(rc => {
            const rId = rc.choice;
            if (rId) {
              runChoiceOffered[rId] = (runChoiceOffered[rId] || 0) + 1;
              if (rc.was_picked) {
                runChoicePicked.add(rId);
                if (isBoss) floorRelicAcquisitions[rId] = 'boss';
                else if (isTreasure) floorRelicAcquisitions[rId] = 'chest';
                else if (isElite) floorRelicAcquisitions[rId] = 'elite';
                else floorRelicAcquisitions[rId] = 'combat';
              }
            }
          });
        }
      });
    });
  }

  // Check player.relics
  if (p.relics) {
    p.relics.forEach(rl => {
      const rId = rl.id;
      if (!rId) return;
      if (!relicSourceStats[rId]) {
        relicSourceStats[rId] = {
          id: rId,
          totalCarried: 0,
          boss: 0,
          chest: 0,
          shop: 0,
          ancient: 0,
          combatOrElite: 0,
          eventOrOther: 0,
          starter: 0,
          offered: 0
        };
      }
      relicSourceStats[rId].totalCarried++;
      const src = floorRelicAcquisitions[rId];
      if (src === 'boss') relicSourceStats[rId].boss++;
      else if (src === 'chest') relicSourceStats[rId].chest++;
      else if (src === 'shop') relicSourceStats[rId].shop++;
      else if (src === 'ancient') relicSourceStats[rId].ancient++;
      else if (src === 'elite' || src === 'combat') relicSourceStats[rId].combatOrElite++;
      else {
        // Starters or mystery events / unclassified
        relicSourceStats[rId].eventOrOther++;
      }
    });
  }
});

console.log('Total tracked relics with sources:', Object.keys(relicSourceStats).length);
const topRelics = Object.values(relicSourceStats).sort((a,b) => b.totalCarried - a.totalCarried).slice(0, 10);
console.log('Top 10 Relics Breakdown:', JSON.stringify(topRelics, null, 2));
