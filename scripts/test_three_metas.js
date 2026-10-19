const fs = require('fs');
const path = require('path');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

console.log('Testing extraction across', files.length, 'runs...');

const cardStats = {};
const relicStats = {};
const potStats = {};

files.forEach(f => {
  const content = fs.readFileSync(path.join(runsDir, f), 'utf8');
  const safeJson = content.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const r = JSON.parse(safeJson);
  const p = (r.players && r.players[0]) || {};

  if (r.map_point_history) {
    r.map_point_history.forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(fl => {
        const rm = (fl.rooms && fl.rooms[0]) || {};
        const roomType = String(rm.room_type || rm.model_id || fl.map_point_type || '').toLowerCase();
        const modelId = String(rm.model_id || '').toUpperCase();

        const isShop = roomType.includes('shop') || roomType.includes('merchant') || modelId.includes('SHOP');
        const isEvent = roomType.includes('event') || modelId.includes('EVENT') || roomType.includes('neow') || modelId.includes('NEOW');
        const isCombat = roomType.includes('monster') || roomType.includes('elite') || roomType.includes('boss');
        const isBoss = roomType.includes('boss') || modelId.includes('BOSS');
        const isTreasure = roomType.includes('treasure') || roomType.includes('chest') || modelId.includes('CHEST');

        (fl.player_stats || []).forEach(ps => {
          const isMe = !p || String(ps.player_id) === String(p.id);
          if (!isMe) return;

          // CARDS
          const pickedInChoices = new Set();
          if (ps.card_choices) {
            ps.card_choices.forEach(cc => {
              const cId = cc.card ? cc.card.id : (cc.id || cc);
              if (cId) {
                if (!cardStats[cId]) cardStats[cId] = { picks: 0, offered: 0, shopBought: 0, eventGained: 0 };
                cardStats[cId].offered++;
                if (cc.was_picked) {
                  cardStats[cId].picks++;
                  pickedInChoices.add(cId);
                }
              }
            });
          }
          if (ps.cards_gained) {
            ps.cards_gained.forEach(cg => {
              const cId = (typeof cg === 'object' && cg.id) ? cg.id : cg;
              if (cId && !pickedInChoices.has(cId)) {
                if (!cardStats[cId]) cardStats[cId] = { picks: 0, offered: 0, shopBought: 0, eventGained: 0 };
                if (isShop) {
                  cardStats[cId].shopBought++;
                } else if (isEvent) {
                  cardStats[cId].eventGained++;
                } else {
                  cardStats[cId].eventGained++; // Other non-combat gains (e.g. chest/boss/relic triggers)
                }
              }
            });
          }

          // RELICS
          if (ps.bought_relics) {
            ps.bought_relics.forEach(rId => {
              if (!relicStats[rId]) relicStats[rId] = { shopCount: 0, eventCount: 0, ancientCount: 0 };
              relicStats[rId].shopCount++;
            });
          }
          if (ps.ancient_choice) {
            ps.ancient_choice.forEach(ch => {
              const rId = ch.TextKey && (ch.TextKey.startsWith('RELIC.') ? ch.TextKey : ('RELIC.' + ch.TextKey));
              if (rId && ch.was_chosen) {
                if (!relicStats[rId]) relicStats[rId] = { shopCount: 0, eventCount: 0, ancientCount: 0 };
                relicStats[rId].ancientCount++;
              }
            });
          }
          if (ps.relic_choices) {
            ps.relic_choices.forEach(rc => {
              const rId = rc.choice;
              if (rId && rc.was_picked) {
                if (!relicStats[rId]) relicStats[rId] = { shopCount: 0, eventCount: 0, ancientCount: 0 };
                if (isEvent) {
                  relicStats[rId].eventCount++;
                }
              }
            });
          }

          // POTIONS
          if (ps.bought_potions) {
            ps.bought_potions.forEach(pId => {
              if (!potStats[pId]) potStats[pId] = { used: 0, looted: 0, passed: 0, shopCount: 0, eventCount: 0 };
              potStats[pId].shopCount++;
            });
          }
          if (ps.potion_choices) {
            ps.potion_choices.forEach(pc => {
              const pId = pc.choice;
              if (!pId) return;
              if (!potStats[pId]) potStats[pId] = { used: 0, looted: 0, passed: 0, shopCount: 0, eventCount: 0 };
              if (pc.was_picked) {
                if (isEvent) {
                  potStats[pId].eventCount++;
                } else if (!isShop) {
                  potStats[pId].looted++;
                }
              } else if (!isShop) {
                potStats[pId].passed++;
              }
            });
          }
          if (ps.potion_used) {
            ps.potion_used.forEach(pId => {
              if (!potStats[pId]) potStats[pId] = { used: 0, looted: 0, passed: 0, shopCount: 0, eventCount: 0 };
              potStats[pId].used++;
            });
          }
        });
      });
    });
  }
});

console.log('Sample Card (CARD.DISCOVERY):', cardStats['CARD.DISCOVERY']);
console.log('Sample Card (CARD.ARMAMENTS):', cardStats['CARD.ARMAMENTS']);
console.log('Top 3 Bought Relics:');
console.log(Object.entries(relicStats).sort((a,b) => b[1].shopCount - a[1].shopCount).slice(0, 3));
console.log('Top 3 Event Relics:');
console.log(Object.entries(relicStats).sort((a,b) => (b[1].eventCount + b[1].ancientCount) - (a[1].eventCount + a[1].ancientCount)).slice(0, 3));
console.log('Top 3 Bought Potions:');
console.log(Object.entries(potStats).sort((a,b) => b[1].shopCount - a[1].shopCount).slice(0, 3));
console.log('Top 3 Event Potions:');
console.log(Object.entries(potStats).sort((a,b) => b[1].eventCount - a[1].eventCount).slice(0, 3));
