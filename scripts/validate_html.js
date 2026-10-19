const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('web/index.html', 'utf8');
const scriptMatches = html.matchAll(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi);
let idx = 0;
for (const match of scriptMatches) {
  idx++;
  const code = match[1];
  if (!code.trim()) continue;
  try {
    new vm.Script(code);
    console.log(`Script block ${idx} parsed successfully.`);
  } catch (err) {
    console.error(`Syntax error in script block ${idx}:`, err.message);
    process.exit(1);
  }
}
console.log('ALL HTML SCRIPT BLOCKS VALIDATED SUCCESSFULLY!');
