const fs = require('fs');
const path = require('path');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

let shopSamples = [];
let eventSamples = [];
let boughtColorlessSamples = [];

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
        if (ps.bought_colorless && ps.bought_colorless.length > 0 && boughtColorlessSamples.length < 5) {
          boughtColorlessSamples.push({ run: f, floor: fl.floor, bought_colorless: ps.bought_colorless, cards_gained: ps.cards_gained });
        }
        if (isShop && ps.cards_gained && ps.cards_gained.length > 0 && shopSamples.length < 5) {
          shopSamples.push({ run: f, floor: fl.floor, roomType, modelId, cards_gained: ps.cards_gained, card_choices: ps.card_choices });
        }
        if (isEvent && ps.cards_gained && ps.cards_gained.length > 0 && eventSamples.length < 5) {
          eventSamples.push({ run: f, floor: fl.floor, roomType, modelId, cards_gained: ps.cards_gained, event_choices: ps.event_choices });
        }
      });
    });
  });
});

console.log('=== BOUGHT COLORLESS SAMPLES ===', JSON.stringify(boughtColorlessSamples, null, 2));
console.log('=== SHOP CARDS GAINED SAMPLES ===', JSON.stringify(shopSamples, null, 2));
console.log('=== EVENT CARDS GAINED SAMPLES ===', JSON.stringify(eventSamples, null, 2));
