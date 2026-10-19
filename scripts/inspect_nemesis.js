const fs = require('fs');
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));

const killerCounts = {};
const killerByTier = { boss: 0, elite: 0, monster: 0 };
let dailyDeaths = 0, standardDeaths = 0;
let abandonedCount = 0;

files.forEach(f => {
  const raw = fs.readFileSync(runsDir + '/' + f, 'utf8').replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
  const r = JSON.parse(raw);
  const isWin = !!r.win;
  const isDaily = !!(r.daily_run || r.is_daily || (r.modifiers && r.modifiers.length > 0) || (r.custom_run && r.custom_run.is_daily));
  
  if (!isWin) {
    if (isDaily) dailyDeaths++; else standardDeaths++;
    if (r.was_abandoned) abandonedCount++;
    const foe = r.killed_by_encounter;
    if (foe && foe !== 'NONE.NONE') {
      killerCounts[foe] = (killerCounts[foe] || 0) + 1;
      let tier = 'monster';
      const fUpper = foe.toUpperCase();
      if (fUpper.includes('BOSS') || fUpper.includes('CHAMP') || fUpper.includes('COLLECTOR') || fUpper.includes('AUTOMATON') || fUpper.includes('AWAKENED') || fUpper.includes('TIME') || fUpper.includes('DONU') || fUpper.includes('HEART')) tier = 'boss';
      else if (fUpper.includes('ELITE') || fUpper.includes('NOB') || fUpper.includes('LAGAVULIN') || fUpper.includes('SENTRY') || fUpper.includes('BOOK') || fUpper.includes('LEADER') || fUpper.includes('SLAVERS') || fUpper.includes('NEMESIS') || fUpper.includes('GIANT_HEAD') || fUpper.includes('REPTOMANCER')) tier = 'elite';
      killerByTier[tier]++;
    }
  }
});

const sorted = Object.entries(killerCounts).sort((a,b)=>b[1]-a[1]);
console.log('Top 10 killers:', sorted.slice(0, 10));
console.log('Total losses:', standardDeaths + dailyDeaths, '(Standard:', standardDeaths, 'Daily:', dailyDeaths, ')');
console.log('Total abandoned:', abandonedCount);
console.log('Total enemies in graveyard:', Object.keys(killerCounts).length);
console.log('Sum of kills on you across all graveyard foes:', Object.values(killerCounts).reduce((a,b)=>a+b, 0));
console.log('Killer by Tier:', killerByTier);
