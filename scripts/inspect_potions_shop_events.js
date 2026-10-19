const fs = require('fs');
const path = require('path');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

let totalBoughtPotions = 0;
let totalEventPotions = 0;
let totalCombatPotions = 0;
let sampleBought = [];
let sampleEvent = [];

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

      (fl.player_stats || []).forEach(ps => {
        if (ps.bought_potions && ps.bought_potions.length > 0) {
          totalBoughtPotions += ps.bought_potions.length;
          if (sampleBought.length < 5) sampleBought.push({ run: f, floor: fl.floor, bought: ps.bought_potions });
        }
        if (ps.potion_choices) {
          ps.potion_choices.forEach(pc => {
            if (pc.was_picked) {
              if (isEvent) {
                totalEventPotions++;
                if (sampleEvent.length < 5) sampleEvent.push({ run: f, floor: fl.floor, choice: pc.choice });
              } else if (!isShop) {
                totalCombatPotions++;
              }
            }
          });
        }
      });
    });
  });
});

console.log('Total bought potions:', totalBoughtPotions);
console.log('Total event potions:', totalEventPotions);
console.log('Total combat potions:', totalCombatPotions);
console.log('Sample bought potions:', sampleBought);
console.log('Sample event potions:', sampleEvent);
