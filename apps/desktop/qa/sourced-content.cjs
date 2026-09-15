// Isolated native QA: production reader/parser and UI, temporary selection only.
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { mkdtemp, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const desktop = resolve(__dirname, '..');
app.whenReady().then(async () => {
 const root = await mkdtemp(join(tmpdir(), 'agentlens-sourced-ui-'));
 const runtime = await import(pathToFileURL(join(desktop, 'server/insights/runtime.mjs')));
 const win = new BrowserWindow({ width: 1250, height: 850, webPreferences: { preload: join(desktop,'electron/preload.cjs'), contextIsolation:true, nodeIntegration:false, sandbox:true } });
 const trusted = event => event.senderFrame === win.webContents.mainFrame;
 ipcMain.handle('agentlens:read-comparison', event => trusted(event) ? runtime.readSelectedComparison(root) : {ok:false,error:'forbidden'});
 ipcMain.handle('agentlens:insight-read', () => ({ok:false,error:'qa_analysis_disabled'}));
 ipcMain.handle('agentlens:insight-open-pair', async (event, payload) => {
  if (!trusted(event)) return {ok:false,error:'forbidden'};
  const picked = await dialog.showOpenDialog(win,{title:'QA: Open evaluated comparison',properties:['openFile'],filters:[{name:'Comparison',extensions:['json']}]});
  if(picked.canceled) return {ok:true,cancelled:true};
  try { return await runtime.selectComparison(await readFile(picked.filePaths[0],'utf8'),{root,requireChecks:payload?.requireChecks === true}); }
  catch(e){return {ok:false,error:e.message === 'evaluation_missing' ? 'evaluation_missing':'invalid_comparison_bundle'};}
 });
 console.log('Isolated selection root:',root);
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 await win.loadFile(join(desktop,'dist/index.html'),{search:'?desktop=1',hash:'/comparison'});
 win.show();win.focus();
});
app.on('window-all-closed',()=>app.quit());
