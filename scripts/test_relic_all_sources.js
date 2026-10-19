const fs = require('fs');
const path = require('path');

const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

const STARTER_RELIC_IDS = new Set([
  'RELIC.BURNING_BLOOD',
  'RELIC.RING_OF_THE_SNAKE',
  'RELIC.CRACKED_CORE',
  'RELIC.DIVINE_RIGHT',
  'RELIC.BOUND_PHYLACTERY'
]);

const relicStats = {};

function getOrCreate(rId) {
  if (!relicStats[rId]) {
    relicStats[rId] = {
      id: rId,
      count: 0,
      wins: 0,
      isStarter: STARTER_RELIC_IDS.has(rId),
      // Counts acquired
      chestCount: 0,
      bossCount: 0,
      combatCount: 0,
      shopCount: 0,
      ancientCount: 0,
      eventCount: 0,
      // Choices
      bossOffered: 0,
      bossPicked: 0,
      ancientOffered: 0,
      ancientPicked: 0,
      ancients: new Set(),
      floorsReached: []
    };
  }
  return relicStats[rId];
}

files.forEach(f => {
  const raw = fs.readFileSync(path.join(runsDir, f), 'utf8');
  const safeJson = raw.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const run = JSON.parse(safeJson);
  const p = run.players ? run.players[0] : null;
  if (!p) return;

  const finalFloor = (run.map_point_history ? run.map_point_history.flat().length : 1);
  const runSeen = new Set();

  if (p.relics) {
    p.relics.forEach(rl => {
      const rId = rl.id;
      if (!rId || runSeen.has(rId)) return;
      runSeen.add(rId);
      const st = getOrCreate(rId);
      st.count++;
      if (run.win) st.wins++;
      st.floorsReached.push(finalFloor);
    });
  }

  if (run.map_point_history) {
    run.map_point_history.forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(node => {
        const ps = (node.player_stats && node.player_stats[0]) || {};
        const rm = (node.rooms && node.rooms[0]) || {};
        const roomType = String(rm.room_type || rm.model_id || '').toLowerCase();
        const modelId = String(rm.model_id || '').toUpperCase();

        const isBoss = roomType.includes('boss') || modelId.includes('BOSS');
        const isTreasure = roomType.includes('treasure') || roomType.includes('chest') || modelId.includes('CHEST');
        const isShop = roomType.includes('shop') || roomType.includes('merchant') || modelId.includes('SHOP');
        const isEvent = roomType.includes('event') || modelId.includes('EVENT');
        const isCombat = roomType.includes('elite') || roomType.includes('monster') || modelId.includes('ENCOUNTER');

        // 1. Bought relics
        if (ps.bought_relics) {
          ps.bought_relics.forEach(bId => {
            const st = getOrCreate(bId);
            st.shopCount++;
          });
        }

        // 2. Ancient choices
        if (ps.ancient_choice) {
          const ancientName = modelId ? modelId.replace('EVENT.', '') : 'NEOW';
          ps.ancient_choice.forEach(ch => {
            const rId = ch.TextKey && (ch.TextKey.startsWith('RELIC.') ? ch.TextKey : ('RELIC.' + ch.TextKey));
            if (rId) {
              const st = getOrCreate(rId);
              st.ancientOffered++;
              st.ancients.add(ancientName);
              if (ch.was_chosen) {
                st.ancientCount++;
                st.ancientPicked++;
              }
            }
          });
        }

        // 3. Relic choices (Boss chest, treasure chests, combats, events)
        if (ps.relic_choices) {
          ps.relic_choices.forEach(rc => {
            const rId = rc.choice;
            if (rId) {
              const st = getOrCreate(rId);
              if (isBoss) {
                st.bossOffered++;
                if (rc.was_picked) {
                  st.bossCount++;
                  st.bossPicked++;
                }
              } else if (isTreasure) {
                if (rc.was_picked) st.chestCount++;
              } else if (isShop) {
                // shop choice offer
              } else if (isEvent) {
                if (rc.was_picked) st.eventCount++;
              } else {
                // elite/combat
                if (rc.was_picked) st.combatCount++;
              }
            }
          });
        }
      });
    });
  }
});

console.log('Total tracked relics:', Object.keys(relicStats).length);

// Let's print sample of different types:
const samples = [
  'RELIC.TOOLBOX',          // shop
  'RELIC.WAR_PAINT',        // boss + chest + combat
  'RELIC.VAJRA',            // chest + combat
  'RELIC.NUTRITIOUS_SOUP',   // ancient
  'RELIC.RING_OF_THE_SNAKE' // starter
];

samples.forEach(id => {
  const r = relicStats[id];
  if (r) {
    console.log(id, '=>', {
      count: r.count,
      wins: r.wins,
      chest: r.chestCount,
      boss: r.bossCount,
      combat: r.combatCount,
      shop: r.shopCount,
      ancient: r.ancientCount,
      event: r.eventCount,
      isStarter: r.isStarter,
      ancientPickRate: r.ancientOffered > 0 ? (r.ancientPicked + '/' + r.ancientOffered) : null,
      bossPickRate: r.bossOffered > 0 ? (r.bossPicked + '/' + r.bossOffered) : null
    });
  }
});
