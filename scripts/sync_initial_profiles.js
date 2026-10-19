const fs = require('fs');
const path = require('path');

const FORUM_RTDB_BASE = 'https://slay-the-spire-2-tracker-default-rtdb.firebaseio.com/forum';
const runsDir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';

function getPlayer(r) {
  if (r.players && Array.isArray(r.players) && r.players.length > 0) {
    return r.players[0];
  }
  return r.player || {};
}

function getCharKey(r) {
  const p = getPlayer(r);
  const raw = (p.character || r.character || '').toUpperCase();
  if (raw.includes('IRONCLAD')) return 'IRONCLAD';
  if (raw.includes('SILENT')) return 'SILENT';
  if (raw.includes('DEFECT')) return 'DEFECT';
  if (raw.includes('REGENT')) return 'REGENT';
  if (raw.includes('NECROBINDER')) return 'NECROBINDER';
  return raw || 'UNKNOWN';
}

function isDailyOrChallengeRun(r) {
  if (!r) return false;
  if (r.game_mode && String(r.game_mode).toLowerCase() !== 'standard') return true;
  if (r.is_daily || r.daily || r.challenge) return true;
  if (r.modifiers && Array.isArray(r.modifiers) && r.modifiers.length > 0) return true;
  return false;
}

function getRunFloors(r) {
  if (typeof r.floors === 'number') return r.floors;
  if (r.map_point_history && Array.isArray(r.map_point_history)) {
    let fCount = 0;
    r.map_point_history.forEach(act => {
      fCount += Array.isArray(act) ? act.length : 1;
    });
    return fCount;
  }
  return 0;
}

function getRunKills(r) {
  let elitesKilled = 0;
  let bossesKilled = 0;
  if (r.map_point_history && Array.isArray(r.map_point_history)) {
    r.map_point_history.forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(node => {
        if (node.map_point_type === 'elite') elitesKilled++;
        if (node.map_point_type === 'boss') bossesKilled++;
      });
    });
  }
  return { elitesKilled, bossesKilled };
}

function computeLifetimeBadges(runs) {
  const badgeCounts = {};
  (runs || []).forEach(r => {
    const localP = getPlayer(r);
    if (localP && localP.badges) {
      localP.badges.forEach(b => {
        const id = b.id;
        badgeCounts[id] = (badgeCounts[id] || 0) + 1;
      });
    }
  });
  return Object.entries(badgeCounts)
    .sort((a,b) => b[1] - a[1])
    .map(([id, count]) => ({ id, count }));
}

function buildPlayerProfileData(runs, handle, isCreator, role) {
  const standardRuns = (runs || []).filter(r => !isDailyOrChallengeRun(r));
  const totalRuns = standardRuns.length;
  const winRuns = standardRuns.filter(r => r.win);
  const totalVictories = winRuns.length;
  const winRate = totalRuns > 0 ? ((totalVictories / totalRuns) * 100).toFixed(1) : '0.0';

  let maxAscension = 0;
  let fastestWinSeconds = null;
  let curStreak = 0, longestStreak = 0;

  const chronoRuns = [...standardRuns].sort((a,b) => (a.start_time || 0) - (b.start_time || 0));
  chronoRuns.forEach(r => {
    if (r.win) {
      curStreak++;
      if (curStreak > longestStreak) longestStreak = curStreak;
      if (typeof r.ascension === 'number' && r.ascension > maxAscension) maxAscension = r.ascension;
      const t = r.run_time || 0;
      if (t > 0 && (fastestWinSeconds === null || t < fastestWinSeconds)) fastestWinSeconds = t;
    } else {
      curStreak = 0;
    }
  });

  const powerScore = (totalVictories * 150) + (maxAscension * 120) + (longestStreak * 200) + Math.min(totalRuns * 10, 500);

  const charStats = {};
  ['IRONCLAD', 'SILENT', 'DEFECT', 'REGENT', 'NECROBINDER'].forEach(k => {
    charStats[k] = { runs: 0, wins: 0, maxAscWon: 0, elites: 0, bosses: 0 };
  });

  standardRuns.forEach(r => {
    const cKey = getCharKey(r);
    if (charStats[cKey]) {
      charStats[cKey].runs++;
      if (r.win) {
        charStats[cKey].wins++;
        if (typeof r.ascension === 'number' && r.ascension > charStats[cKey].maxAscWon) {
          charStats[cKey].maxAscWon = r.ascension;
        }
      }
      const kills = getRunKills(r);
      charStats[cKey].elites += kills.elitesKilled || 0;
      charStats[cKey].bosses += kills.bossesKilled || 0;
    }
  });

  const cardTally = {};
  standardRuns.forEach(r => {
    const p = getPlayer(r);
    const seenInRun = new Set();
    (p.deck || []).forEach(c => {
      const cId = c && (c.id || c.TextKey);
      if (cId && !seenInRun.has(cId)) {
        seenInRun.add(cId);
        if (!cardTally[cId]) cardTally[cId] = { count: 0, wins: 0 };
        cardTally[cId].count++;
        if (r.win) cardTally[cId].wins++;
      }
    });
  });
  const top10Cards = Object.keys(cardTally)
    .map(id => ({ id, count: cardTally[id].count, wins: cardTally[id].wins, winRate: Math.round((cardTally[id].wins / cardTally[id].count) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  let mostUpg = 0, mostUpgDeck = 0;
  let leastUpg = 999, leastUpgDeck = 0;
  let largestDeck = 0, smallestDeck = 999;
  let mostRelics = 0, fewestRelics = 999;
  let mostElites = 0;

  const cardChoicesStats = {};
  standardRuns.forEach(r => {
    const p = getPlayer(r);
    const deck = p.deck || [];
    const relics = p.relics || [];
    const upgCount = deck.filter(c => (c.current_upgrade_level || 0) > 0).length;

    if (upgCount > mostUpg) { mostUpg = upgCount; mostUpgDeck = deck.length; }
    if (deck.length > 0 && upgCount < leastUpg) { leastUpg = upgCount; leastUpgDeck = deck.length; }
    if (deck.length > largestDeck) largestDeck = deck.length;
    if (deck.length > 0 && deck.length < smallestDeck) smallestDeck = deck.length;
    if (relics.length > mostRelics) mostRelics = relics.length;
    if (relics.length > 0 && relics.length < fewestRelics) fewestRelics = relics.length;

    let elites = 0;
    (r.map_point_history || []).forEach(act => {
      (Array.isArray(act) ? act : [act]).forEach(node => {
        if (node.map_point_type === 'elite') elites++;
        (node.player_stats || []).forEach(ps => {
          (ps.card_choices || []).forEach(ch => {
            const cId = ch.card && (ch.card.id || ch.card.TextKey);
            if (!cId) return;
            if (!cardChoicesStats[cId]) cardChoicesStats[cId] = { offered: 0, picked: 0 };
            cardChoicesStats[cId].offered++;
            if (ch.was_picked) cardChoicesStats[cId].picked++;
          });
        });
      });
    });
    if (elites > mostElites) mostElites = elites;
  });

  let mostPicked = null, leastTaken = null;
  const cardChoicesList = Object.keys(cardChoicesStats).map(id => ({
    id,
    offered: cardChoicesStats[id].offered,
    picked: cardChoicesStats[id].picked,
    pickRate: cardChoicesStats[id].offered > 0 ? (cardChoicesStats[id].picked / cardChoicesStats[id].offered) : 0
  }));
  if (cardChoicesList.length > 0) {
    cardChoicesList.sort((a,b) => b.picked - a.picked);
    if (cardChoicesList[0] && cardChoicesList[0].picked > 0) mostPicked = cardChoicesList[0];
    const eligibleSkips = cardChoicesList.filter(c => c.offered >= 5);
    if (eligibleSkips.length > 0) {
      eligibleSkips.sort((a,b) => a.pickRate !== b.pickRate ? a.pickRate - b.pickRate : b.offered - a.offered);
      leastTaken = eligibleSkips[0];
    }
  }

  let totalBosses = 0, totalElites = 0, totalFloors = 0;
  standardRuns.forEach(r => {
    const k = getRunKills(r);
    totalBosses += k.bossesKilled || 0;
    totalElites += k.elitesKilled || 0;
    totalFloors += getRunFloors(r);
  });

  const earnedBadges = computeLifetimeBadges(standardRuns);

  return {
    handle,
    isCreator: !!isCreator,
    role: role || (isCreator ? 'owner' : 'slayer'),
    powerScore,
    totalRuns,
    totalVictories,
    winRate,
    maxAscension,
    fastestWinSeconds,
    longestStreak,
    charStats,
    top10Cards,
    records: {
      mostUpg, mostUpgDeck,
      leastUpg: leastUpg === 999 ? 0 : leastUpg, leastUpgDeck,
      largestDeck, smallestDeck: smallestDeck === 999 ? 0 : smallestDeck,
      mostRelics, fewestRelics: fewestRelics === 999 ? 0 : fewestRelics,
      mostElites,
      mostPicked,
      leastTaken
    },
    epochs: {
      totalBosses,
      totalElites,
      totalFloors
    },
    badges: earnedBadges,
    updatedAt: Date.now()
  };
}

async function main() {
  console.log('Loading local run files...');
  const runFiles = fs.readdirSync(runsDir).filter(f => f.endsWith('.run'));
  const loadedRuns = [];

  runFiles.forEach(f => {
    try {
      const raw = fs.readFileSync(path.join(runsDir, f), 'utf8');
      const safeJson = raw.replace(/"(player_)?id"\s*:\s*([0-9]{15,20})/g, '"$1id":"$2"');
      const obj = JSON.parse(safeJson);
      loadedRuns.push(obj);
    } catch (e) {
      console.warn('Error reading ' + f, e.message);
    }
  });

  console.log(`Loaded ${loadedRuns.length} runs.`);

  // 1. Build profile for Apocaelypze
  const apocProfile = buildPlayerProfileData(loadedRuns, 'Apocaelypze', true, 'owner');
  console.log('Apocaelypze profile summary:', {
    powerScore: apocProfile.powerScore,
    totalVictories: apocProfile.totalVictories,
    totalRuns: apocProfile.totalRuns,
    maxAscension: apocProfile.maxAscension,
    fastestWinSeconds: apocProfile.fastestWinSeconds,
    longestStreak: apocProfile.longestStreak
  });

  const apocResp = await fetch(`${FORUM_RTDB_BASE}/profiles/apocaelypze.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(apocProfile)
  });
  console.log('Uploaded apocaelypze.json:', apocResp.status);

  // 2. Fetch Kratos77x from RTDB and build profile
  const kratosPlayerResp = await fetch(`${FORUM_RTDB_BASE}/leaderboard/players/kratos77x.json`);
  const kratosPlayer = await kratosPlayerResp.json();
  const kratosRunResp = await fetch(`${FORUM_RTDB_BASE}/leaderboard/runs/1791549399.json`);
  const kratosRun = await kratosRunResp.json();

  const kratosRuns = kratosRun && kratosRun.fullRun ? [kratosRun.fullRun] : (kratosRun ? [kratosRun] : []);
  const kratosProfile = buildPlayerProfileData(kratosRuns, 'Kratos77x', false, 'steam');
  if (kratosPlayer) {
    if (kratosPlayer.powerScore) kratosProfile.powerScore = kratosPlayer.powerScore;
    if (kratosPlayer.totalRuns) kratosProfile.totalRuns = kratosPlayer.totalRuns;
    if (kratosPlayer.totalVictories) kratosProfile.totalVictories = kratosPlayer.totalVictories;
    if (kratosPlayer.winRate) kratosProfile.winRate = kratosPlayer.winRate;
    if (kratosPlayer.maxAscension) kratosProfile.maxAscension = kratosPlayer.maxAscension;
    if (kratosPlayer.longestStreak) kratosProfile.longestStreak = kratosPlayer.longestStreak;
    if (kratosPlayer.fastestWinSeconds) kratosProfile.fastestWinSeconds = kratosPlayer.fastestWinSeconds;
  }

  const kratosResp = await fetch(`${FORUM_RTDB_BASE}/profiles/kratos77x.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(kratosProfile)
  });
  console.log('Uploaded kratos77x.json:', kratosResp.status);

  console.log('All profiles successfully synced!');
}

main().catch(console.error);
