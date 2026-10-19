const fs = require('fs');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

const allCards = new Set();
const deckCards = [];

files.forEach(f => {
  const raw = fs.readFileSync(runsDir + '/' + f, 'utf8').replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const r = JSON.parse(raw);
  const p = (r.players && r.players[0]) || null;
  if (!p) return;

  if (p.deck) {
    p.deck.forEach(c => {
      allCards.add(c.id);
      deckCards.push(c);
    });
  }

  if (r.map_point_history) {
    r.map_point_history.forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(fl => {
        if (fl.player_stats) {
          fl.player_stats.forEach(ps => {
            if (ps.card_choices) {
              ps.card_choices.forEach(cc => {
                const cId = cc.card ? cc.card.id : (cc.id || cc);
                if (cId) allCards.add(cId);
              });
            }
            if (ps.cards_gained) {
              ps.cards_gained.forEach(cg => {
                const cId = (typeof cg === 'object' && cg.id) ? cg.id : cg;
                if (cId) allCards.add(cId);
              });
            }
          });
        }
      });
    });
  }
});

// Look for cards with curse or status attributes in deckCards
const sampled = {};
deckCards.forEach(c => {
  if (!sampled[c.id]) {
    sampled[c.id] = c;
  }
});

const cursesAndStatuses = Object.values(sampled).filter(c => {
  const type = (c.type || '').toUpperCase();
  const rarity = (c.rarity || '').toUpperCase();
  const id = c.id.toUpperCase();
  return type === 'CURSE' || type === 'STATUS' || rarity === 'CURSE' || rarity === 'STATUS' || id.includes('CURSE') || id.includes('STATUS');
});

console.log('Detected curses/statuses by properties:');
cursesAndStatuses.forEach(c => console.log(c.id, 'type:', c.type, 'rarity:', c.rarity));

// Also find any card IDs starting with or containing CURSE or common curse/status names
const suspicious = [...allCards].filter(id => {
  const u = id.toUpperCase();
  return u.includes('CURSE') || u.includes('STATUS') || u.includes('WOUND') || u.includes('BURN') || u.includes('DAZED') || u.includes('SLIMED') || u.includes('VOID') || u.includes('CLUMSY') || u.includes('DECAY') || u.includes('DOUBT') || u.includes('INJURY') || u.includes('NORMALITY') || u.includes('PAIN') || u.includes('PARASITE') || u.includes('REGRET') || u.includes('SHAME') || u.includes('WRITHE') || u.includes('ASCENDER') || u.includes('NECRONOMICURSE');
});

console.log('\nSuspicious / Curse / Status IDs in allCards:');
suspicious.forEach(id => console.log(id, 'sample:', sampled[id] ? { type: sampled[id].type, rarity: sampled[id].rarity } : 'not in deck sample'));
