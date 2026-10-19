const fs = require('fs');
const path = require('path');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

console.log('Searching all run files for TWIN_STRIKE in deck or gained...');
let countDeck = 0;
files.forEach(f => {
  const content = fs.readFileSync(path.join(runsDir, f), 'utf8');
  if (content.includes('TWIN_STRIKE')) {
    const raw = JSON.parse(content.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"'));
    (raw.players || []).forEach(p => {
      const match = (p.deck || []).filter(c => c.id && c.id.includes('TWIN_STRIKE'));
      if (match.length) {
        countDeck++;
        console.log(`Run ${f}: Player ${p.id} (${p.character}) has Twin Strike:`, match);
      }
    });
  }
});
console.log('Total runs with Twin Strike in deck:', countDeck);
