const fs = require('fs');
const path = require('path');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

files.forEach(f => {
  const content = fs.readFileSync(path.join(runsDir, f), 'utf8');
  if (content.includes('CALCIFY')) {
    const raw = JSON.parse(content.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"'));
    console.log(`\nRun ${f}: run.character=${raw.character}, win=${raw.win}`);
    (raw.players || []).forEach((pl, i) => {
      const hasC = (pl.deck || []).some(c => c.id && c.id.includes('CALCIFY'));
      console.log(`  P${i+1} (${pl.id}) char=${pl.character}, hasCalcifyInDeck=${hasC}`);
    });
    // Check choices
    (raw.map_point_history || []).forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(fl => {
        (fl.player_stats || []).forEach(ps => {
          (ps.card_choices || []).forEach(cc => {
            const id = cc.card ? cc.card.id : (cc.id || cc);
            if (id && id.includes('CALCIFY')) {
              console.log(`  choice at floor ${fl.floor} by pId=${ps.player_id}: picked=${cc.was_picked}`);
            }
          });
        });
      });
    });
  }
});
