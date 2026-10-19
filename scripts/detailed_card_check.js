const fs = require('fs');
const path = require('path');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

console.log('--- ALL OCCURRENCES OF HIGH_FIVE ---');
files.forEach(f => {
  const content = fs.readFileSync(path.join(runsDir, f), 'utf8');
  if (content.includes('HIGH_FIVE')) {
    const raw = JSON.parse(content.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"'));
    const p1 = (raw.players && raw.players[0]) || {};
    const p2 = (raw.players && raw.players[1]) || null;
    const inDeck1 = (p1.deck || []).some(c => c.id && c.id.includes('HIGH_FIVE'));
    const inDeck2 = p2 && (p2.deck || []).some(c => c.id && c.id.includes('HIGH_FIVE'));
    
    // Check choices
    let pickedInChoices = [];
    let offeredInChoices = [];
    let gained = [];
    (raw.map_point_history || []).forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(fl => {
        (fl.player_stats || []).forEach(ps => {
          (ps.card_choices || []).forEach(cc => {
            const id = cc.card ? cc.card.id : (cc.id || cc);
            if (id && id.includes('HIGH_FIVE')) {
              offeredInChoices.push(ps.player_id);
              if (cc.was_picked) pickedInChoices.push(ps.player_id);
            }
          });
          (ps.cards_gained || []).forEach(cg => {
            const id = (typeof cg === 'object' && cg.id) ? cg.id : cg;
            if (id && id.includes('HIGH_FIVE')) gained.push(ps.player_id);
          });
        });
      });
    });

    console.log(`Run ${f} (char: ${raw.character || p1.character}, win: ${raw.win}):`);
    console.log(`  inDeck P1: ${inDeck1}, inDeck P2: ${inDeck2}`);
    console.log(`  picked: [${pickedInChoices}], offered: [${offeredInChoices}], gained: [${gained}]`);
  }
});

console.log('\n--- ALL OCCURRENCES OF TWIN_STRIKE ---');
files.forEach(f => {
  const content = fs.readFileSync(path.join(runsDir, f), 'utf8');
  if (content.includes('TWIN_STRIKE')) {
    const raw = JSON.parse(content.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"'));
    const p1 = (raw.players && raw.players[0]) || {};
    const p2 = (raw.players && raw.players[1]) || null;
    const inDeck1 = (p1.deck || []).some(c => c.id && c.id.includes('TWIN_STRIKE'));
    const inDeck2 = p2 && (p2.deck || []).some(c => c.id && c.id.includes('TWIN_STRIKE'));

    let pickedInChoices = [];
    let offeredInChoices = [];
    let gained = [];
    (raw.map_point_history || []).forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(fl => {
        (fl.player_stats || []).forEach(ps => {
          (ps.card_choices || []).forEach(cc => {
            const id = cc.card ? cc.card.id : (cc.id || cc);
            if (id && id.includes('TWIN_STRIKE')) {
              offeredInChoices.push(ps.player_id);
              if (cc.was_picked) pickedInChoices.push(ps.player_id);
            }
          });
          (ps.cards_gained || []).forEach(cg => {
            const id = (typeof cg === 'object' && cg.id) ? cg.id : cg;
            if (id && id.includes('TWIN_STRIKE')) gained.push(ps.player_id);
          });
        });
      });
    });

    console.log(`Run ${f} (char: ${raw.character || p1.character}, win: ${raw.win}):`);
    console.log(`  inDeck P1: ${inDeck1}, inDeck P2: ${inDeck2}`);
    console.log(`  picked: [${pickedInChoices}], offered: [${offeredInChoices}], gained: [${gained}]`);
  }
});
