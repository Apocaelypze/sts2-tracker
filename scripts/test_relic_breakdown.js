const fs = require('fs');
const path = require('path');

const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

const relicStats = {};

files.forEach(f => {
  const raw = fs.readFileSync(path.join(runsDir, f), 'utf8');
  const safeJson = raw.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const run = JSON.parse(safeJson);
  const p = run.players ? run.players[0] : null;
  if (!p) return;

  const floorRelicAcquisitions = {};
  const runOffered = {};
  const runPicked = {};

  if (run.map_point_history) {
    run.map_point_history.forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(node => {
        const ps = (node.player_stats && node.player_stats[0]) || {};
        const roomType = (node.rooms && node.rooms[0] && (node.rooms[0].room_type || node.rooms[0].model_id)) || '';
        const isBoss = roomType.toLowerCase().includes('boss');
        const isTreasure = roomType.toLowerCase().includes('treasure') || roomType.toLowerCase().includes('chest');
        const isShop = roomType.toLowerCase().includes('shop') || roomType.toLowerCase().includes('merchant');

        if (ps.bought_relics) {
          ps.bought_relics.forEach(rId => {
            floorRelicAcquisitions[rId] = 'shop';
          });
        }

        if (ps.ancient_choice) {
          ps.ancient_choice.forEach(ch => {
            const rId = ch.TextKey && (ch.TextKey.startsWith('RELIC.') ? ch.TextKey : ('RELIC.' + ch.TextKey));
            if (rId) {
              if (!relicStats[rId]) relicStats[rId] = initRelic(rId);
              relicStats[rId].ancientOffered++;
              if (ch.was_chosen) {
                relicStats[rId].ancientPicked++;
                floorRelicAcquisitions[rId] = 'ancient';
              }
            }
          });
        }

        if (ps.relic_choices) {
          ps.relic_choices.forEach(rc => {
            const rId = rc.choice;
            if (rId) {
              if (!relicStats[rId]) relicStats[rId] = initRelic(rId);
              if (isBoss) {
                relicStats[rId].bossOffered++;
                if (rc.was_picked) {
                  relicStats[rId].bossPicked++;
                  floorRelicAcquisitions[rId] = 'boss';
                }
              } else if (isTreasure) {
                relicStats[rId].chestOffered++;
                if (rc.was_picked) {
                  relicStats[rId].chestPicked++;
                  floorRelicAcquisitions[rId] = 'chest';
                }
              } else {
                relicStats[rId].combatOffered++;
                if (rc.was_picked) {
                  relicStats[rId].combatPicked++;
                  floorRelicAcquisitions[rId] = 'combat';
                }
              }
            }
          });
        }
      });
    });
  }

  if (p.relics) {
    p.relics.forEach(rl => {
      const rId = rl.id;
      if (!rId) return;
      if (!relicStats[rId]) relicStats[rId] = initRelic(rId);
      relicStats[rId].count++;
      if (run.win) relicStats[rId].wins++;

      const src = floorRelicAcquisitions[rId];
      if (src === 'boss') relicStats[rId].bossCount++;
      else if (src === 'chest') relicStats[rId].chestCount++;
      else if (src === 'shop') relicStats[rId].shopCount++;
      else if (src === 'ancient') relicStats[rId].ancientCount++;
      else if (src === 'combat') relicStats[rId].combatCount++;
      else relicStats[rId].eventOrStarterCount++;
    });
  }
});

function initRelic(id) {
  return {
    id,
    count: 0,
    wins: 0,
    bossCount: 0,
    chestCount: 0,
    shopCount: 0,
    ancientCount: 0,
    combatCount: 0,
    eventOrStarterCount: 0,
    bossOffered: 0,
    bossPicked: 0,
    ancientOffered: 0,
    ancientPicked: 0,
    chestOffered: 0,
    chestPicked: 0,
    combatOffered: 0,
    combatPicked: 0
  };
}

const shopRelics = Object.values(relicStats).filter(r => r.shopCount > 0);
console.log('Relics with shop purchases count:', shopRelics.length);
console.log('Sample shop relics:', shopRelics.slice(0, 3));

const bossRelics = Object.values(relicStats).filter(r => r.bossCount > 0 || r.bossOffered > 0);
console.log('Relics with boss choices count:', bossRelics.length);
console.log('Sample boss relics:', bossRelics.slice(0, 3));

const chestRelics = Object.values(relicStats).filter(r => r.chestCount > 0);
console.log('Relics with chest acquisitions count:', chestRelics.length);
console.log('Sample chest relics:', chestRelics.slice(0, 3));
