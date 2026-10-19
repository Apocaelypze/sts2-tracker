const fs = require('fs');
const path = require('path');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

const cardCharCounts = {}; // cardId -> { IRONCLAD: 5, NECROBINDER: 20, ... }

files.forEach(f => {
  const content = fs.readFileSync(path.join(runsDir, f), 'utf8');
  const safeJson = content.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const run = JSON.parse(safeJson);

  // Map each player id to their character
  const playerChars = {};
  (run.players || []).forEach(pl => {
    if (pl.id && pl.character) {
      playerChars[String(pl.id)] = pl.character.replace('CHARACTER.', '').toUpperCase();
    }
  });

  // Check decks
  (run.players || []).forEach(pl => {
    const cChar = pl.character ? pl.character.replace('CHARACTER.', '').toUpperCase() : null;
    if (cChar) {
      (pl.deck || []).forEach(c => {
        if (c.id) {
          if (!cardCharCounts[c.id]) cardCharCounts[c.id] = {};
          cardCharCounts[c.id][cChar] = (cardCharCounts[c.id][cChar] || 0) + 1;
        }
      });
    }
  });

  // Check combat choices (not events like Colorful Philosophers)
  (run.map_point_history || []).forEach(act => {
    (Array.isArray(act) ? act : [act]).forEach(fl => {
      const rm = (fl.rooms && fl.rooms[0]) || {};
      const isCombat = rm.room_type === 'monster' || rm.room_type === 'elite' || rm.room_type === 'boss';
      if (isCombat) {
        (fl.player_stats || []).forEach(ps => {
          const cChar = playerChars[String(ps.player_id)];
          if (cChar) {
            (ps.card_choices || []).forEach(cc => {
              const cId = cc.card ? cc.card.id : (cc.id || cc);
              if (cId) {
                if (!cardCharCounts[cId]) cardCharCounts[cId] = {};
                cardCharCounts[cId][cChar] = (cardCharCounts[cId][cChar] || 0) + 2; // Weight combat offers higher
              }
            });
          }
        });
      }
    });
  });
});

console.log('Calcify:', cardCharCounts['CARD.CALCIFY']);
console.log('High Five:', cardCharCounts['CARD.HIGH_FIVE']);
console.log('Twin Strike:', cardCharCounts['CARD.TWIN_STRIKE']);
