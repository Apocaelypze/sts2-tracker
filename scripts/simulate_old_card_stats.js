const fs = require('fs');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

const oldCardStats = {};

files.forEach(f => {
  const raw = fs.readFileSync(runsDir + '/' + f, 'utf8').replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const r = JSON.parse(raw);
  const p = (r.players && r.players[0]) || null;
  if (!p || !p.deck) return;

  const runOfferedCounts = {};
  const runPickCounts = {};

  if (r.map_point_history) {
    r.map_point_history.forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(fl => {
        if (fl.player_stats) {
          const ps = (p && p.id) ? (fl.player_stats.find(s => String(s.player_id) === String(p.id)) || fl.player_stats[0]) : fl.player_stats[0];
          if (ps && ps.card_choices) {
            ps.card_choices.forEach(cc => {
              const cId = cc.card ? cc.card.id : (cc.id || cc);
              if (cId) {
                runOfferedCounts[cId] = (runOfferedCounts[cId] || 0) + 1;
                if (cc.was_picked) {
                  runPickCounts[cId] = (runPickCounts[cId] || 0) + 1;
                }
              }
            });
          }
          if (ps && ps.cards_gained) {
            ps.cards_gained.forEach(cg => {
              const cId = (typeof cg === 'object' && cg.id) ? cg.id : cg;
              if (cId) {
                runPickCounts[cId] = (runPickCounts[cId] || 0) + 1;
              }
            });
          }
        }
      });
    });
  }

  // Aggregate offered cards
  Object.entries(runOfferedCounts).forEach(([cId, count]) => {
    if (!oldCardStats[cId]) oldCardStats[cId] = { picks: 0, offered: 0 };
    oldCardStats[cId].offered += count;
  });

  // Aggregate picked cards
  Object.entries(runPickCounts).forEach(([cId, count]) => {
    if (!oldCardStats[cId]) oldCardStats[cId] = { picks: 0, offered: 0 };
    oldCardStats[cId].picks += count;
  });
});

console.log('Old code stats for Lightning Rod:', oldCardStats['CARD.LIGHTNING_ROD']);
console.log('Old code stats for White Noise:', oldCardStats['CARD.WHITE_NOISE']);
