const fs = require('fs');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

const cardStats = {};

files.forEach(f => {
  const raw = fs.readFileSync(runsDir + '/' + f, 'utf8').replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const r = JSON.parse(raw);
  const p = (r.players && r.players[0]) || null;
  if (!p) return;

  if (r.map_point_history) {
    r.map_point_history.forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(node => {
        if (!node.player_stats) return;
        node.player_stats.forEach(ps => {
          // Card choices (Draft offers & picks)
          if (ps.card_choices) {
            ps.card_choices.forEach(cc => {
              const cId = cc.card ? cc.card.id : (cc.id || cc);
              if (!cId) return;
              if (!cardStats[cId]) {
                cardStats[cId] = { offered: 0, pickedChoice: 0, gainedOther: 0, inDeckTotal: 0 };
              }
              cardStats[cId].offered++;
              if (cc.was_picked) {
                cardStats[cId].pickedChoice++;
              }
            });
          }

          // Cards gained outside of card choices (shop, event, chest, relic)
          if (ps.cards_gained) {
            // Find which cards were gained that were NOT picked in card_choices on this floor
            const pickedOnThisFloor = new Set();
            if (ps.card_choices) {
              ps.card_choices.forEach(cc => {
                if (cc.was_picked) {
                  const cId = cc.card ? cc.card.id : (cc.id || cc);
                  if (cId) pickedOnThisFloor.add(cId);
                }
              });
            }

            ps.cards_gained.forEach(cg => {
              const cId = (typeof cg === 'object' && cg.id) ? cg.id : cg;
              if (!cId) return;
              if (!cardStats[cId]) {
                cardStats[cId] = { offered: 0, pickedChoice: 0, gainedOther: 0, inDeckTotal: 0 };
              }
              if (!pickedOnThisFloor.has(cId)) {
                cardStats[cId].gainedOther++;
              }
            });
          }
        });
      });
    });
  }
});

console.log('Lightning Rod:', cardStats['CARD.LIGHTNING_ROD']);
console.log('White Noise:', cardStats['CARD.WHITE_NOISE']);

// Check cards with offered > 0
const topCards = Object.entries(cardStats)
  .filter(([id, s]) => s.offered > 0)
  .map(([id, s]) => ({
    id,
    offered: s.offered,
    pickedChoice: s.pickedChoice,
    pickRate: ((s.pickedChoice / s.offered) * 100).toFixed(1) + '%',
    gainedOther: s.gainedOther
  }))
  .sort((a, b) => b.offered - a.offered);

console.log('Top 10 most offered cards:');
console.table(topCards.slice(0, 10));

// Check if ANY card has pickedChoice > offered
const over100 = topCards.filter(c => c.pickedChoice > c.offered);
console.log('Cards where pickedChoice > offered:', over100);
