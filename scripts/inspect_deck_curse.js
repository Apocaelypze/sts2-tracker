const fs = require('fs');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

for (const f of files) {
  const raw = fs.readFileSync(runsDir + '/' + f, 'utf8').replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const r = JSON.parse(raw);
  const p = (r.players && r.players[0]) || null;
  if (!p || !p.deck) continue;

  for (const c of p.deck) {
    if (c.id.includes('ASCENDER') || c.id.includes('CLUMSY') || c.id.includes('INJURY') || c.id.includes('CURSE')) {
      console.log('Sample Curse/Status in deck:', JSON.stringify(c, null, 2));
      return;
    }
  }
}
