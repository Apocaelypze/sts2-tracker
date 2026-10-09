const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'web/data/sts2_data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const loc = require('C:/Users/wjb21/.gemini/antigravity/scratch/sts2_tracker/cards_loc.json');
const vars = require('C:/Users/wjb21/.gemini/antigravity/scratch/sts2_tracker/card_vars.json');

const normVars = {};
for (const k in vars) {
  normVars[k.toLowerCase()] = vars[k];
  normVars[k.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()] = vars[k];
}

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

function formatCardDesc(cardId, title, rawDesc) {
  if (!rawDesc) return '';
  let res = rawDesc;

  const cleanId = cardId.replace(/^CARD\./i, '').replace(/_/g, '').toLowerCase();
  const rawClean = cardId.replace(/^CARD\./i, '').toLowerCase();
  const titleClean = (title || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  const cVars = normVars[cleanId] || normVars[rawClean] || normVars[titleClean] || {};

  if (cleanId === 'madscience') {
    return 'Create a custom card with chosen effects.';
  }

  // 1. Remove InCombat and conditional reminder tags with nested braces
  res = stripBalancedTag(res, 'InCombat');
  res = stripBalancedTag(res, 'GainsBlock');
  res = stripBalancedTag(res, 'TargetType');
  res = stripBalancedTag(res, 'HasRider');
  res = stripBalancedTag(res, 'CardType');

  // 2. Handle IfUpgraded: {IfUpgraded:show:upgradedText|baseText} -> baseText
  while (/\{IfUpgraded:show:([^|}]*)\|([^}]*)\}/i.test(res)) {
    res = res.replace(/\{IfUpgraded:show:([^|}]*)\|([^}]*)\}/gi, '$2');
  }

  // 3. Remove empty braces {}
  res = res.replace(/\{\s*\}/g, '');

  // 4. Remove broken empty tag {:diff()}
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

  // Catch any remaining braces / Godot tokens
  res = res.replace(/\{[^}]*\}/g, '');

  // 8. Colors
  res = res.replace(/\[gold\]/gi, '<strong>').replace(/\[\/gold\]/gi, '</strong>');
  res = res.replace(/\[blue\]/gi, '<span style="color:#38bdf8">').replace(/\[\/blue\]/gi, '</span>');
  res = res.replace(/\[red\]/gi, '<span style="color:#ef4444">').replace(/\[\/red\]/gi, '</span>');
  res = res.replace(/\[green\]/gi, '<span style="color:#10b981">').replace(/\[\/green\]/gi, '</span>');
  res = res.replace(/\[purple\]/gi, '<span style="color:#c084fc">').replace(/\[\/purple\]/gi, '</span>');
  res = res.replace(/\[orange\]/gi, '<span style="color:#f97316">').replace(/\[\/orange\]/gi, '</span>');

  // 9. Cleanup extra spaces, double punctuation, line breaks
  res = res.replace(/\n/g, '<br/>');
  res = res.replace(/\s+/g, ' ');
  res = res.replace(/Deal\s+damage\./gi, 'Deal damage.');
  res = res.replace(/Gain\s+<strong>Block<\/strong>\./gi, 'Gain <strong>Block</strong>.');
  res = res.replace(/<strong>Summon<\/strong>\s*\./gi, '<strong>Summon</strong>.');
  res = res.replace(/<br\/>\s*<br\/>/gi, '<br/>');
  res = res.trim();

  return res;
}

let updated = 0;
for (const cardId in data.cards) {
  const card = data.cards[cardId];
  const rawKey = cardId.replace(/^CARD\./i, '');
  const rawDesc = loc[rawKey + '.description'] || loc[cardId + '.description'] || card.desc || '';
  const newDesc = formatCardDesc(cardId, card.name, rawDesc);
  card.desc = newDesc;
  updated++;
}

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
console.log(`Successfully updated ${updated} card descriptions in sts2_data.json.`);

// Verify Bury and Bodyguard
console.log('Bury:', data.cards['CARD.BURY']);
console.log('Bodyguard:', data.cards['CARD.BODYGUARD']);
