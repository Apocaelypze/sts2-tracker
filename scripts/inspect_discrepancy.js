const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/wjb21/AppData/Roaming/SlayTheSpire2/steam/76561199078562869/profile1/saves/history';
const files = fs.readdirSync(dir);
const runFiles = files.filter(f => f.endsWith('.run'));
const backupFiles = files.filter(f => f.endsWith('.backup'));
const otherFiles = files.filter(f => !f.endsWith('.run') && !f.endsWith('.backup'));

console.log('Total files in directory:', files.length);
console.log('.run files:', runFiles.length);
console.log('.backup files:', backupFiles.length);
console.log('Other files:', otherFiles.length, otherFiles);

let identical = 0;
backupFiles.forEach(b => {
  const orig = b.replace(/\.backup$/, '');
  if (fs.existsSync(path.join(dir, orig))) {
    const bBuf = fs.readFileSync(path.join(dir, b));
    const oBuf = fs.readFileSync(path.join(dir, orig));
    if (bBuf.equals(oBuf)) identical++;
    else console.log('Different:', b);
  } else {
    console.log('No original found for:', b);
  }
});

console.log(`Backup files identical to .run files: ${identical} / ${backupFiles.length}`);

// Check timestamps
backupFiles.slice(0, 5).forEach(b => {
  const stat = fs.statSync(path.join(dir, b));
  console.log(b, 'mtime:', stat.mtime);
});
