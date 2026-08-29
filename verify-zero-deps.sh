#!/bin/sh
echo "Checking package.json dependencies block..."
node -e "const p=require('./package.json'); const d={...p.dependencies}; if(Object.keys(d).length){console.error('FAIL: found deps', d); process.exit(1)} else {console.log('PASS: zero runtime dependencies')}"
echo "Checking that src/ imports only Node built-ins..."
node -e "
const fs=require('fs'),path=require('path');
const builtins=new Set(require('module').builtinModules);
let bad=[];
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
if(e.isDirectory())walk(p);
else if(e.name.endsWith('.js')){const s=fs.readFileSync(p,'utf8');
for(const m of s.matchAll(/require\((['\"])(.*?)\1\)/g)){const id=m[2];
const bare=id.startsWith('node:')?id.slice(5):id;
if(!id.startsWith('.')&&!builtins.has(bare))bad.push(p+' -> '+id);}}}})('./src');
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
if(e.isDirectory())walk(p);
else if(e.name.endsWith('.js')){const s=fs.readFileSync(p,'utf8');
for(const m of s.matchAll(/require\((['\"])(.*?)\1\)/g)){const id=m[2];
const bare=id.startsWith('node:')?id.slice(5):id;
if(!id.startsWith('.')&&!builtins.has(bare))bad.push(p+' -> '+id);}}}})('./bin');
if(bad.length){console.error('FAIL: non-builtin imports:'); bad.forEach(b=>console.error('  '+b)); process.exit(1);}
console.log('PASS: every import in src/ and bin/ is a Node built-in or a relative path');
"
echo "Checking node_modules for anything beyond devDependencies..."
ls node_modules 2>/dev/null || echo "no node_modules directory present"
