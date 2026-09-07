const {app,safeStorage}=require('electron');
const {mkdtemp,rm,readFile}=require('node:fs/promises');
const {tmpdir}=require('node:os');const {join}=require('node:path');
const {createCredentialStore}=require('../../electron/insight-credentials.cjs');
app.whenReady().then(async()=>{let root;let code=1;try{root=await mkdtemp(join(tmpdir(),'agentlens-key-smoke-'));const store=createCredentialStore({safeStorage,root});await store.set('agentlens-noncredential-test-value');const roundTrip=await store.get()==='agentlens-noncredential-test-value';const encrypted=!(await readFile(join(root,'credential.json'),'utf8')).includes('agentlens-noncredential-test-value');await store.remove();console.log(JSON.stringify({roundTrip,encrypted,removed:!await store.has(),platform:process.platform}));code=roundTrip&&encrypted?0:1;}catch{console.log(JSON.stringify({ok:false,error:'credential_smoke_unavailable'}));code=1;}finally{if(root)await rm(root,{recursive:true,force:true});app.exit(code);}});
