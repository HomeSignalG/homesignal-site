import fs from 'node:fs';
const raw = JSON.parse(fs.readFileSync(process.argv[2],'utf8')).result;
const a = raw.indexOf('[{'), b = raw.lastIndexOf('}]');
const j = JSON.parse(JSON.parse(raw.slice(a,b+2))[0].j);
fs.writeFileSync('data.json', JSON.stringify(j));
console.log(Object.keys(j.radius).map(n=>n+':'+j.radius[n].length), 'hyd',j.hydrate.length,'ledger',j.ledger.length,'events',j.events.length,'health',j.health.length);
