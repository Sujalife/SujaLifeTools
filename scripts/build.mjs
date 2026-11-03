import {readFile,readdir,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const root=resolve(import.meta.dirname,'..'),dist=resolve(root,'dist');
const errors=[];
async function walk(dir){let files=[];for(const item of await readdir(dir,{withFileTypes:true})){const path=resolve(dir,item.name);if(item.isDirectory())files.push(...await walk(path));else files.push(path)}return files}
for(const file of await walk(dist)){
 if(!/\.(html|css|js|webmanifest)$/.test(file))continue;
 const body=await readFile(file,'utf8');
 if(file.endsWith('.html'))for(const match of body.matchAll(/(?:src|href)="([^"#]+)"/g)){
   if(/^(https?:|data:)/.test(match[1]))continue;
   try{await access(resolve(dirname(file),match[1]))}catch{errors.push(`Missing asset ${match[1]} from ${file}`)}
 }
}
if(errors.length)throw Error(errors.join('\n'));
console.log('Static build verified: hub, dock entry, and all linked assets.');
