const fs = require('fs');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

const CURSE_AND_STATUS_IDS = new Set([
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
  'CARD.BAD_LUCK',
  'CARD.BURN',
  'CARD.DAZED',
  'CARD.SLIMED',
  'CARD.VOID',
  'CARD.WOUND',
  'CARD.MOCK_CURSE_CARD'
]);

const cardStats = {};

files.forEach(f => {
  const raw = fs.readFileSync(runsDir + '/' + f, 'utf8').replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const r = JSON.parse(raw);
  const p = (r.players && r.players[0]) || null;
  if (!p || !p.deck) return;

  const runCardsInDeck = new Set();
  const runUpgrades = new Set();

  p.deck.forEach(c => {
    runCardsInDeck.add(c.id);
    if (c.current_upgrade_level > 0) runUpgrades.add(c.id);
  });

  // Track map point history
  if (r.map_point_history) {
    r.map_point_history.forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(fl => {
        if (!fl.player_stats) return;
        const ps = (p && p.id) ? (fl.player_stats.find(s => String(s.player_id) === String(p.id)) || fl.player_stats[0]) : fl.player_stats[0];
        if (!ps) return;

        const pickedInChoicesThisFloor = new Set();
        if (ps.card_choices) {
          ps.card_choices.forEach(cc => {
            const cId = cc.card ? cc.card.id : (cc.id || cc);
            if (!cId || CURSE_AND_STATUS_IDS.has(cId)) return;

            if (!cardStats[cId]) {
              cardStats[cId] = {
                id: cId,
                offered: 0,
                picks: 0,
                otherAcquired: 0,
                runsPresent: 0,
                wins: 0,
                upgrades: 0
              };
            }
            cardStats[cId].offered++;
            if (cc.was_picked) {
              cardStats[cId].picks++;
              pickedInChoicesThisFloor.add(cId);
            }
          });
        }

        // Shop / Event / Transform / Relic gains
        if (ps.cards_gained) {
          ps.cards_gained.forEach(cg => {
            const cId = (typeof cg === 'object' && cg.id) ? cg.id : cg;
            if (!cId || CURSE_AND_STATUS_IDS.has(cId)) return;

            if (!cardStats[cId]) {
              cardStats[cId] = {
                id: cId,
                offered: 0,
                picks: 0,
                otherAcquired: 0,
                runsPresent: 0,
                wins: 0,
                upgrades: 0
              };
            }

            // Only count as otherAcquired if not picked from card choices on this floor
            if (!pickedInChoicesThisFloor.has(cId)) {
              cardStats[cId].otherAcquired++;
            }
          });
        }

        if (ps.upgraded_cards) {
          ps.upgraded_cards.forEach(uId => {
            if (uId) runUpgrades.add(uId);
          });
        }
      });
    });
  }

  // Runs present & wins for deck cards
  runCardsInDeck.forEach(cId => {
    if (CURSE_AND_STATUS_IDS.has(cId)) return;
    if (!cardStats[cId]) {
      cardStats[cId] = {
        id: cId,
        offered: 0,
        picks: 0,
        otherAcquired: 0,
        runsPresent: 0,
        wins: 0,
        upgrades: 0
      };
    }
    cardStats[cId].runsPresent++;
    if (r.win) cardStats[cId].wins++;
    if (runUpgrades.has(cId)) cardStats[cId].upgrades++;
  });
});

console.log('Lightning Rod stats:');
console.log(cardStats['CARD.LIGHTNING_ROD']);

console.log('\nWhite Noise stats:');
console.log(cardStats['CARD.WHITE_NOISE']);

const allItems = Object.values(cardStats);
const over100 = allItems.filter(c => c.picks > c.offered);
console.log('\nAny card with picks > offered?', over100.length);

const anyNegative = allItems.filter(c => CURSE_AND_STATUS_IDS.has(c.id));
console.log('Any curse or status in table?', anyNegative.length);

// Top 10 by picks
allItems.sort((a,b) => b.picks - a.picks);
console.log('\nTop 10 most picked cards:');
console.table(allItems.slice(0, 10).map(c => ({
  id: c.id,
  picks: c.picks,
  offered: c.offered,
  pickRate: c.offered > 0 ? ((c.picks / c.offered) * 100).toFixed(1) + '%' : '0%',
  otherAcquired: c.otherAcquired,
  runsPresent: c.runsPresent,
  wins: c.wins
})));
