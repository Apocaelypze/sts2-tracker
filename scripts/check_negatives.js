const fs = require('fs');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

const cardsInRuns = new Set();
files.forEach(f => {
  const raw = fs.readFileSync(runsDir + '/' + f, 'utf8').replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const r = JSON.parse(raw);
  const p = (r.players && r.players[0]) || null;
  if (!p) return;
  if (p.deck) p.deck.forEach(c => cardsInRuns.add(c.id));
});

const list = [...cardsInRuns].sort();
list.forEach(id => {
  const u = id.toUpperCase();
  if (u.includes('PAIN') || u.includes('BANE') || u.includes('CURSE') || u.includes('HEX') || u.includes('DOOM') || u.includes('PARASITE') || u.includes('NECRO') || u.includes('SLIME') || u.includes('BURN') || u.includes('WOUND') || u.includes('DAZED') || u.includes('VOID') || u.includes('INFEST') || u.includes('SPORE') || u.includes('HAUNT') || u.includes('BAD_LUCK')) {
    console.log(id);
  }
});
