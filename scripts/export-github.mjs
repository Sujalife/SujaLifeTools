import {cp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const target=process.argv[2];
if(!['hub','dock'].includes(target))throw Error('Choose hub or dock');
const out=resolve(root,'..',target==='hub'?'github-SujaLifeTools':'github-SujaDockStatus');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
for(const name of ['dist','scripts','package.json','.gitignore','AGENTS.md','ARTWORK.md','.github'])await cp(resolve(root,name),resolve(out,name),{recursive:true});
if(target==='hub'){
 for(const name of ['package-lock.json','tests','database.rules.json','firebase.json','firebase-rules-status.json','SETUP.md','README.md'])await cp(resolve(root,name),resolve(out,name),{recursive:true});
}else{
 await writeFile(resolve(out,'README.md'),`# Suja Dock Status\n\nStandalone frontend for docks 16–19, sharing accounts, roles, messages, and themes with [Suja Life Tools](https://github.com/Sujalife/SujaLifeTools).\n\nThis version uses **direct Firebase Authentication and Realtime Database access protected by rules**. Core operation requires no Cloud Functions deployment or Blaze upgrade. Firebase's service limits still apply.\n\nThe supplied public Firebase configuration is included. **Live activation still requires the matching version 2 rules and the owner UID at toolsV2/config/masterUid.** The authoritative rules, setup instructions, and tests are maintained in [SujaLifeTools](https://github.com/Sujalife/SujaLifeTools/blob/main/SETUP.md). This export does not deploy a separate backend or maintain a second rules copy.\n\nUse Create account to make a pending identity and copy its UID. Only a Firebase project administrator can pin Master in the Console; the first visitor never becomes Master automatically. The Master approves other accounts and assigns roles. Both repository paths on sujalife.github.io share Firebase authentication persistence.\n\nThe dock board and hub support icon/card and list views. The interface shows the last 72 hours of history and messages; authorized open apps clean up expired entries while active. Physical deletion is not guaranteed while every browser is closed, and current dock status is retained.\n\nBoth apps use the live Firebase workspace only. Old sample sessions are retired automatically; unconfirmed docks remain unconfirmed until an authorized update.\n\nPersonal alert preferences are available from your account or Messages → Preferences. Choose dock statuses and team, role, or direct messages independently. The inbox and unread count follow your choices; the dock board and history remain complete. Version 2.1 rules in the hub enable account sync; UID-scoped device choices work while sync is unavailable. Phone layouts keep dock cards compact and editing actions visible.\n\nSet Settings → Pages → Source → GitHub Actions to publish the frontend. Pages publication does not publish Firebase rules.\n\nShared source changes belong in SujaLifeTools and should be exported to this repository together. Native-generated artwork and the existing Suja light/dark palette are preserved.\n`);
 await rm(resolve(out,'scripts/rules.mjs'),{force:true});
 const pkg=JSON.parse(await readFile(resolve(out,'package.json'),'utf8'));pkg.name='suja-dock-status';pkg.scripts.test='node --check dist/shared/platform.js';delete pkg.scripts['test:rules'];delete pkg.devDependencies;await writeFile(resolve(out,'package.json'),JSON.stringify(pkg,null,2)+'\n');
 await writeFile(resolve(out,'.github/workflows/pages.yml'),`name: Publish site
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  publish:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: $\u007b{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm test && npm run check && npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
`);

 let entry=await readFile(resolve(out,'dist/dock/index.html'),'utf8');entry=entry.replaceAll('../assets/','./assets/').replaceAll('../shared/','./shared/');await writeFile(resolve(out,'dist/index.html'),entry);
}
const host='https://sujalife.github.io';
const configPath=resolve(out,'dist/shared/config.js');let config=await readFile(configPath,'utf8');config=config.replace("hub: ''",`hub: '${host}/SujaLifeTools/'`).replace("dock: ''",`dock: '${host}/SujaDockStatus/'`);await writeFile(configPath,config);
for(const [name,url] of [['index.html',`${host}/${target==='hub'?'SujaLifeTools':'SujaDockStatus'}/`],['dock/index.html',`${host}/${target==='hub'?'SujaLifeTools':'SujaDockStatus'}/`]]){
 const p=resolve(out,'dist',name);let html=await readFile(p,'utf8');html=html.replaceAll('https://suja-life-tools.fatherearth.chatgpt.site/assets/',url+'assets/');await writeFile(p,html);
}
console.log(out);
