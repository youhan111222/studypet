const fs = require('fs');
const src = fs.readFileSync('src/seed.ts', 'utf8');
const total = [...src.matchAll(/subject:\s*['"]/g)].length;
const imports = [...src.matchAll(/source: 'import'/g)].length;
console.log('总题数:', total, '| 真题:', imports);