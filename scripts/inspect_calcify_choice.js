const fs = require('fs');
const content = fs.readFileSync('C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history/1791833934.run', 'utf8');
const safeJson = content.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
const run = JSON.parse(safeJson);
run.map_point_history.forEach((act, aIdx) => {
  (Array.isArray(act) ? act : [act]).forEach((fl, fIdx) => {
    (fl.player_stats || []).forEach(ps => {
      (ps.card_choices || []).forEach(cc => {
        const id = cc.card ? cc.card.id : (cc.id || cc);
        if (id && id.includes('CALCIFY')) {
          console.log(`Act ${aIdx+1} Floor ${fIdx+1}`);
          console.log('Room:', fl.rooms);
          console.log('Choices for pId ' + ps.player_id + ':', ps.card_choices.map(c => (c.card ? c.card.id : c.id) + (c.was_picked ? ' (PICKED)' : '')));
        }
      });
    });
  });
});
