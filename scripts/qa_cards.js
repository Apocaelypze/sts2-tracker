const fs = require('fs');
const path = require('path');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

let twinStrike = { decks: 0, picked: 0, offered: 0, gained: 0, runsWithDeck: 0 };
let highFive = { decks: 0, picked: 0, offered: 0, gained: 0, runsWithDeck: 0 };

files.forEach(f => {
  const content = fs.readFileSync(path.join(runsDir, f), 'utf8');
  const safeJson = content.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const r = JSON.parse(safeJson);
  const p = (r.players && r.players[0]) || {};

  let hasTS = false;
  let hasHF = false;
  (p.deck || []).forEach(c => {
    const id = (c.id || '').toUpperCase();
    if (id.includes('TWIN_STRIKE')) { twinStrike.decks++; hasTS = true; }
    if (id.includes('HIGH_FIVE')) { highFive.decks++; hasHF = true; }
  });
  if (hasTS) twinStrike.runsWithDeck++;
  if (hasHF) highFive.runsWithDeck++;

  if (r.map_point_history) {
    r.map_point_history.forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(fl => {
        (fl.player_stats || []).forEach(ps => {
          const isMe = !p || String(ps.player_id) === String(p.id);
          if (!isMe) return;

          (ps.card_choices || []).forEach(cc => {
            const id = (cc.card ? cc.card.id : (cc.id || cc)) || '';
            const uid = id.toUpperCase();
            if (uid.includes('TWIN_STRIKE')) {
              twinStrike.offered++;
              if (cc.was_picked) twinStrike.picked++;
            }
            if (uid.includes('HIGH_FIVE')) {
              highFive.offered++;
              if (cc.was_picked) highFive.picked++;
            }
          });

          (ps.cards_gained || []).forEach(cg => {
            const id = (typeof cg === 'object' ? cg.id : cg) || '';
            const uid = id.toUpperCase();
            if (uid.includes('TWIN_STRIKE')) twinStrike.gained++;
            if (uid.includes('HIGH_FIVE')) highFive.gained++;
          });
        });
      });
    });
  }
});

console.log('Twin Strike results:', twinStrike);
console.log('High Five results:', highFive);
