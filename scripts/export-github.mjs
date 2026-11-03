import {cp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const target=process.argv[2];
if(!['hub','dock'].includes(target))throw Error('Choose hub or dock');
const out=resolve(root,'..',target==='hub'?'github-SujaLifeTools':'github-SujaDockStatus');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
for(const name of ['dist','scripts','package.json','.gitignore','AGENTS.md','ARTWORK.md','.github'])await cp(resolve(root,name),resolve(out,name),{recursive:true});
if(target==='hub'){
 for(const name of ['functions','tests','database.rules.json','firebase.json','firebase-rules-status.json','SETUP.md','README.md'])await cp(resolve(root,name),resolve(out,name),{recursive:true});
}else{
 await writeFile(resolve(out,'README.md'),`# Suja Dock Status\n\nStandalone frontend for docks 16–19, sharing accounts, roles, messages, and themes with [Suja Life Tools](https://github.com/Sujalife/SujaLifeTools).\n\n**Live Firebase is not yet configured or deployed.** Open Explore demo for explicitly labeled browser-only sample data.\n\nThe authoritative shared backend, rules, setup instructions, and tests are in SujaLifeTools. This export never deploys a separate backend.\n\nSet Settings → Pages → Source → GitHub Actions to publish the frontend. The workflow verifies assets and JavaScript syntax. Deployment does not activate Firebase.\n\nUpdate public Firebase config in dist/shared/config.js when the shared backend is ready. Both repository paths on sujalife.github.io share Firebase authentication persistence.\n\nBuilt with native-generated art and the existing Suja light/dark palette.\n`);
 const pkg=JSON.parse(await readFile(resolve(out,'package.json'),'utf8'));pkg.name='suja-dock-status';pkg.scripts.test='node --check dist/shared/platform.js';await writeFile(resolve(out,'package.json'),JSON.stringify(pkg,null,2)+'\n');
 let entry=await readFile(resolve(out,'dist/dock/index.html'),'utf8');entry=entry.replaceAll('../assets/','./assets/').replaceAll('../shared/','./shared/');await writeFile(resolve(out,'dist/index.html'),entry);
}
const host='https://sujalife.github.io';
const configPath=resolve(out,'dist/shared/config.js');let config=await readFile(configPath,'utf8');config=config.replace("hub: ''",`hub: '${host}/SujaLifeTools/'`).replace("dock: ''",`dock: '${host}/SujaDockStatus/'`);await writeFile(configPath,config);
for(const [name,url] of [['index.html',`${host}/${target==='hub'?'SujaLifeTools':'SujaDockStatus'}/`],['dock/index.html',`${host}/${target==='hub'?'SujaLifeTools':'SujaDockStatus'}/`]]){
 const p=resolve(out,'dist',name);let html=await readFile(p,'utf8');html=html.replaceAll('https://suja-life-tools.fatherearth.chatgpt.site/assets/',url+'assets/');await writeFile(p,html);
}
console.log(out);
