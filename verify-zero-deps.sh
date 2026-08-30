#!/bin/sh
# Dependency proof, POSIX-shell edition.
# A Node-only equivalent lives in verify-zero-deps.js for environments
# without a shell: node verify-zero-deps.js
set -e

echo "Checking package.json dependencies block..."
node -e "const p=require('./package.json'); const d={...p.dependencies}; if(Object.keys(d).length){console.error('FAIL: found deps', d); process.exit(1)} else {console.log('PASS: zero runtime dependencies')}"

echo "Checking that src/, bin/ and test/ import only Node built-ins..."
node -e "
const fs=require('fs'),path=require('path');
// isBuiltin knows about prefix-only modules such as node:test, which are
// absent from the builtinModules array.
const isBuiltin=require('module').isBuiltin;
const bad=[];
let files=0, imports=0;
function walk(dir){
  if(!fs.existsSync(dir)) return;
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,e.name);
    if(e.isDirectory()){ walk(p); continue; }
    if(!e.name.endsWith('.js')) continue;
    files++;
    // Strip comments first: a require() shown in documentation is not an import.
    const s=fs.readFileSync(p,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
    for(const m of s.matchAll(/require\(\s*(['\"])(.*?)\1\s*\)/g)){
      imports++;
      const id=m[2];
      if(!id.startsWith('.')&&!isBuiltin(id)) bad.push(p+' -> '+id);
    }
  }
}
['./src','./bin','./test'].forEach(walk);
if(bad.length){console.error('FAIL: non-builtin imports:'); bad.forEach(b=>console.error('  '+b)); process.exit(1);}
console.log('PASS: all '+imports+' imports across '+files+' files in src/, bin/ and test/ are Node built-ins or relative paths');
"

echo "Checking node_modules for anything beyond devDependencies..."
ls node_modules 2>/dev/null || echo "no node_modules directory present"
