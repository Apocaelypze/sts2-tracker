const fs = require('fs');
const db = JSON.parse(fs.readFileSync('web/data/sts2_data.json', 'utf8'));

// Check cards in runsDir history
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

const cardsInRuns = new Set();
files.forEach(f => {
  const raw = fs.readFileSync(runsDir + '/' + f, 'utf8').replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const r = JSON.parse(raw);
  const p = (r.players && r.players[0]) || null;
  if (!p) return;
  if (p.deck) p.deck.forEach(c => cardsInRuns.add(c.id));
  if (r.map_point_history) {
    r.map_point_history.forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(fl => {
        if (fl.player_stats) {
          fl.player_stats.forEach(ps => {
            if (ps.card_choices) ps.card_choices.forEach(cc => {
              const id = cc.card ? cc.card.id : (cc.id || cc);
              if (id) cardsInRuns.add(id);
            });
            if (ps.cards_gained) ps.cards_gained.forEach(cg => {
              const id = (typeof cg === 'object' && cg.id) ? cg.id : cg;
              if (id) cardsInRuns.add(id);
            });
          });
        }
      });
    });
  }
});

console.log('Total distinct cards in user run history:', cardsInRuns.size);
const runsCardList = [...cardsInRuns].sort();
console.log('Sample cards in user run history (first 30):', runsCardList.slice(0, 30));

// Find curses / statuses among all runsCardList
const KNOWN_CURSES_AND_STATUSES = [
  // Classic Slay the Spire 1 & 2 curses
  'CARD.ASCENDERS_BANE',
  'CARD.CLUMSY',
  'CARD.CURSE_OF_THE_BELL',
  'CARD.DECAY',
  'CARD.DOUBT',
  'CARD.INJURY',
  'CARD.NORMALITY',
  'CARD.PAIN',
  'CARD.PARASITE',
  'CARD.REGRET',
  'CARD.SHAME',
  'CARD.WRITHE',
  'CARD.NECRONOMICURSE',
  // Statuses
  'CARD.BURN',
  'CARD.DAZED',
  'CARD.SLIMED',
  'CARD.VOID',
  'CARD.WOUND',
  // Slay the Spire 2 new curses / statuses / negative cards
  'CARD.POISONED',
  'CARD.HEX',
  'CARD.HAUNT',
  'CARD.INFESTATION',
  'CARD.SPORE',
  'CARD.SHADOW',
  'CARD.MOCK_CURSE_CARD'
];

const foundNegative = runsCardList.filter(id => {
  const u = id.toUpperCase();
  if (KNOWN_CURSES_AND_STATUSES.includes(u)) return true;
  if (u.includes('CURSE') && !u.includes('RECURSE')) return true;
  if (u.includes('BANE') && !u.includes('SKULL')) return true;
  return false;
});

console.log('Negative cards detected in user history:', foundNegative);
