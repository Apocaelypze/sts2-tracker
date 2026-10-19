const fs = require('fs');
const path = require('path');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

const psKeys = new Set();
let boughtCardsCount = 0;
let shopGainedCards = 0;
let eventGainedCards = 0;
let combatGainedCards = 0;

files.forEach(f => {
  const content = fs.readFileSync(path.join(runsDir, f), 'utf8');
  const safeJson = content.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const raw = JSON.parse(safeJson);

  (raw.map_point_history || []).forEach(act => {
    (Array.isArray(act) ? act : [act]).forEach(fl => {
      const rm = (fl.rooms && fl.rooms[0]) || {};
      const roomType = String(rm.room_type || rm.model_id || '').toLowerCase();
      const modelId = String(rm.model_id || '').toUpperCase();
      const isShop = roomType.includes('shop') || roomType.includes('merchant') || modelId.includes('SHOP');
      const isEvent = roomType.includes('event') || modelId.includes('EVENT') || roomType.includes('neow') || modelId.includes('NEOW');
      const isCombat = roomType.includes('monster') || roomType.includes('elite') || roomType.includes('boss');

      (fl.player_stats || []).forEach(ps => {
        Object.keys(ps).forEach(k => psKeys.add(k));

        if (ps.bought_cards && ps.bought_cards.length > 0) boughtCardsCount += ps.bought_cards.length;

        if (isShop && ps.cards_gained && ps.cards_gained.length > 0) {
          shopGainedCards += ps.cards_gained.length;
        }
        if (isEvent && ps.cards_gained && ps.cards_gained.length > 0) {
          eventGainedCards += ps.cards_gained.length;
        }
        if (isCombat && ps.cards_gained && ps.cards_gained.length > 0) {
          combatGainedCards += ps.cards_gained.length;
        }
      });
    });
  });
});

console.log('All player_stats keys:', Array.from(psKeys));
console.log('bought_cards occurrences:', boughtCardsCount);
console.log('cards_gained in shop rooms:', shopGainedCards);
console.log('cards_gained in event rooms:', eventGainedCards);
console.log('cards_gained in combat rooms:', combatGainedCards);
