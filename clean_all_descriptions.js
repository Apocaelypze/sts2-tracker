const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'web/data/sts2_data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const cardsLoc = require('C:/Users/wjb21/.gemini/antigravity/scratch/sts2_tracker/cards.json');
const relicsLoc = require('C:/Users/wjb21/.gemini/antigravity/scratch/sts2_tracker/relics.json');
const potionsLoc = require('C:/Users/wjb21/.gemini/antigravity/scratch/sts2_tracker/potions.json');

const cardVars = require('C:/Users/wjb21/.gemini/antigravity/scratch/sts2_tracker/card_vars.json');
const relicVars = require('C:/Users/wjb21/.gemini/antigravity/scratch/sts2_tracker/relic_vars.json');
const potionVars = require('C:/Users/wjb21/.gemini/antigravity/scratch/sts2_tracker/potion_vars.json');

function normalizeKeys(obj) {
  const norm = {};
  for (const k in obj) {
    norm[k.toLowerCase()] = obj[k];
    norm[k.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()] = obj[k];
  }
  return norm;
}

const normCardVars = normalizeKeys(cardVars);
const normRelicVars = normalizeKeys(relicVars);
const normPotionVars = normalizeKeys(potionVars);

function stripBalancedTag(str, tagName) {
  let tag = '{' + tagName;
  let idx;
  while ((idx = str.indexOf(tag)) !== -1) {
    let depth = 0;
    let endIdx = -1;
    for (let i = idx; i < str.length; i++) {
      if (str[i] === '{') depth++;
      else if (str[i] === '}') {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx !== -1) {
      str = str.substring(0, idx) + str.substring(endIdx + 1);
    } else {
      str = str.substring(0, idx);
    }
  }
  return str;
}

function resolveCond(str) {
  let idx;
  while ((idx = str.indexOf(':cond:')) !== -1) {
    let startIdx = str.lastIndexOf('{', idx);
    if (startIdx === -1) break;
    let depth = 0;
    let pipeIdx = -1;
    let endIdx = -1;
    for (let i = startIdx; i < str.length; i++) {
      if (str[i] === '{') depth++;
      else if (str[i] === '}') {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      } else if (str[i] === '|' && depth === 1) {
        pipeIdx = i;
      }
    }
    if (endIdx !== -1 && pipeIdx !== -1) {
      let fallbackText = str.substring(pipeIdx + 1, endIdx);
      str = str.substring(0, startIdx) + fallbackText + str.substring(endIdx + 1);
    } else {
      break;
    }
  }
  return str;
}

function cleanDescription(itemId, title, rawText, varsDict, isCard = false) {
  if (!rawText) return '';
  let res = rawText;

  const cleanId = itemId.replace(/^[A-Z]+\./i, '').replace(/_/g, '').toLowerCase();
  const rawClean = itemId.replace(/^[A-Z]+\./i, '').toLowerCase();
  const titleClean = (title || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  const cVars = varsDict[cleanId] || varsDict[rawClean] || varsDict[titleClean] || {};

  if (cleanId === 'madscience') {
    return 'Create a custom card with chosen effects.';
  }

  // 1. Remove conditional reminder tags
  res = stripBalancedTag(res, 'InCombat');
  res = stripBalancedTag(res, 'GainsBlock');
  res = stripBalancedTag(res, 'TargetType');
  res = stripBalancedTag(res, 'HasRider');
  res = stripBalancedTag(res, 'CardType');

  // 2. Handle IfUpgraded: {IfUpgraded:show:upgradedText|baseText} -> baseText
  while (/\{IfUpgraded:show:([^|}]*)\|([^}]*)\}/i.test(res)) {
    res = res.replace(/\{IfUpgraded:show:([^|}]*)\|([^}]*)\}/gi, '$2');
  }

  // 3. Handle conditionals with balanced braces
  res = resolveCond(res);

  // 4. Remove empty braces {}
  res = res.replace(/\{\s*\}/g, '');
  res = res.replace(/\{:diff\(\)\}/gi, '');

  // 5. Handle variable replacements: {VarName:diff()} or {VarName}
  res = res.replace(/\{([A-Za-z0-9_]+)(?::diff\(\))?\}/gi, (match, vName) => {
    if (vName.toLowerCase() === 'ifupgraded' || vName.toLowerCase() === 'energyprefix' || vName.toLowerCase() === 'stars') {
      return match;
    }
    if (cVars[vName] !== undefined) {
      return cVars[vName];
    }
    for (const vk in cVars) {
      if (vk.toLowerCase() === vName.toLowerCase()) {
        return cVars[vk];
      }
    }

    const vLower = vName.toLowerCase();
    if (vLower === 'damage') return '';
    if (vLower === 'block') return '';
    if (vLower === 'summon') return '';
    if (vLower.includes('power')) return '';
    if (vLower.includes('cards')) return '';
    if (vLower.includes('hploss')) return '';
    return '';
  });

  // 6. Handle Plural tags: {Var:plural:singular|plural}
  res = res.replace(/\{([A-Za-z0-9_]+):plural:([^|]+)\|([^}]+)\}/gi, (match, vName, singular, plural) => {
    let val = cVars[vName];
    if (val === undefined) {
      for (const vk in cVars) {
        if (vk.toLowerCase() === vName.toLowerCase()) {
          val = cVars[vk];
          break;
        }
      }
    }
    if (val !== undefined) {
      return Number(val) === 1 ? singular.trim() : plural.trim();
    }
    return plural.trim() || singular.trim();
  });

  // 7. Handle energy / icons
  res = res.replace(/\{energyPrefix:energyIcons\((\d+)\)\}/gi, '[$1 Energy]');
  res = res.replace(/\{[Ee]nergy:energyIcons\(\)\}/gi, 'Energy');
  res = res.replace(/\{ExtraCost:energyIcons\(\)\}/gi, 'Energy');
  res = res.replace(/\{singleStarIcon\}/gi, '★');
  res = res.replace(/\{Stars:starIcons\(\)\}/gi, '★');

  // Strip any remaining Godot braces
  res = res.replace(/\{[^}]*\}/g, '');

  // 8. Strip BBCode color tags [gold], [blue], etc.
  res = res.replace(/\[\/?(gold|blue|red|green|purple|orange|b|i|u|s|color=[^\]]+)\]/gi, '');

  // 9. Strip ALL HTML tags (<br/>, <strong>, <span>, etc.)
  res = res.replace(/<br\s*\/?>/gi, ' ');
  res = res.replace(/<[^>]+>/g, '');

  // 10. Clean up whitespace and punctuation
  res = res.replace(/\r?\n/g, ' ');
  res = res.replace(/\s+/g, ' ');
  res = res.replace(/ \./g, '.').replace(/ ,/g, ',');
  res = res.replace(/Deal\s+damage\./gi, 'Deal damage.');
  res = res.replace(/Gain\s+Block\./gi, 'Gain Block.');
  res = res.replace(/Summon\s*\./gi, 'Summon.');

  return res.trim();
}

// 1. Process Cards
let cardCount = 0;
for (const id in data.cards) {
  const card = data.cards[id];
  const rawKey = id.replace(/^CARD\./i, '');
  const rawLoc = cardsLoc[rawKey + '.description'] || cardsLoc[id + '.description'] || card.desc || '';
  card.desc = cleanDescription(id, card.name, rawLoc, normCardVars, true);
  cardCount++;
}

// 2. Process Relics
let relicCount = 0;
for (const id in data.relics) {
  const relic = data.relics[id];
  const rawKey = id.replace(/^RELIC\./i, '');
  const rawLoc = relicsLoc[rawKey + '.description'] || relicsLoc[id + '.description'] || relic.desc || '';
  relic.desc = cleanDescription(id, relic.name, rawLoc, normRelicVars, false);
  relicCount++;
}

// 3. Process Potions
let potionCount = 0;
for (const id in data.potions) {
  const potion = data.potions[id];
  const rawKey = id.replace(/^POTION\./i, '');
  const rawLoc = potionsLoc[rawKey + '.description'] || potionsLoc[id + '.description'] || potion.desc || '';
  potion.desc = cleanDescription(id, potion.name, rawLoc, normPotionVars, false);
  potionCount++;
}

// 4. Clean any other categories (events, monsters, etc.)
['events', 'monsters', 'powers'].forEach(cat => {
  if (!data[cat]) return;
  for (const id in data[cat]) {
    const item = data[cat][id];
    if (item.desc) {
      item.desc = cleanDescription(id, item.name, item.desc, {});
    }
    if (item.description) {
      item.description = cleanDescription(id, item.name, item.description, {});
    }
  }
});

// Final recursive strip of any stray HTML or BBCode across the entire object
function stripAllHtml(val) {
  if (typeof val === 'string') {
    let s = val;
    s = s.replace(/<br\s*\/?>/gi, ' ');
    s = s.replace(/<[^>]+>/g, '');
    s = s.replace(/\[\/?(gold|blue|red|green|purple|orange|b|i|u|s|color=[^\]]+)\]/gi, '');
    s = s.replace(/[ \t]+/g, ' ');
    s = s.replace(/ \./g, '.').replace(/ ,/g, ',');
    return s.trim();
  } else if (Array.isArray(val)) {
    return val.map(stripAllHtml);
  } else if (typeof val === 'object' && val !== null) {
    for (const k in val) {
      val[k] = stripAllHtml(val[k]);
    }
    return val;
  }
  return val;
}

stripAllHtml(data);

// Save updated sts2_data.json
fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');

console.log(`Processed ${cardCount} cards, ${relicCount} relics, ${potionCount} potions.`);
console.log('Touch of Orobas:', JSON.stringify(data.relics['RELIC.TOUCH_OF_OROBAS'].desc));
console.log('Archaic Tooth:', JSON.stringify(data.relics['RELIC.ARCHAIC_TOOTH'].desc));
console.log('Dusty Tome:', JSON.stringify(data.relics['RELIC.DUSTY_TOME'].desc));
console.log('Sea Glass:', JSON.stringify(data.relics['RELIC.SEA_GLASS'].desc));
console.log('Bodyguard:', JSON.stringify(data.cards['CARD.BODYGUARD'].desc));
