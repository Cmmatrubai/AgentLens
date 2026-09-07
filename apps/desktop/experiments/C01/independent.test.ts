import { execFile as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, it } from "vitest";
import { recordRun } from "../src/recordRun.js";
import { runChildProcess } from "../src/processRunner.js";
import { openDatabase, RunRepository } from "@agentlens/storage";

// Copied unchanged into apps/cli/test only in external evaluator checkouts.
const exec = promisify(execCallback);
const roots: string[] = [];
const MAX = 1_048_576;
const fixtureSource = `#!/usr/bin/env node
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
const mode=process.argv.find(x=>x.startsWith('--mode='))?.slice(7);
const send=async(stream,bytes)=>{if(!stream.write(bytes))await once(stream,'drain')};
const msg=(id,text)=>JSON.stringify({type:'item.completed',item:{id,type:'agent_message',text}});
const padded=(id,bytes)=>{const empty=msg(id,id+':');return empty.slice(0,-3)+'x'.repeat(bytes-Buffer.byteLength(empty))+empty.slice(-3)};
if(mode==='pressure'){
 await send(process.stdout,'first\\n');
 const block=Buffer.from(('x'.repeat(1023)+'\\n').repeat(64));
 for(let i=0;i<2048;i++)await send(process.stdout,block);
 writeFileSync(process.env.PRODUCER_FINISHED,'finished');
}else if(mode==='framing'){
 const bytes=Buffer.from('first\\r\\n\\n€last');
 for(const byte of bytes)await send(process.stdout,Buffer.from([byte]));
}else{
 await send(process.stdout,JSON.stringify({type:'thread.started',thread_id:'external-evaluator'})+'\\n');
 await send(process.stdout,JSON.stringify({type:'turn.started'})+'\\n');
 if(mode==='boundary'){
  const exact=Buffer.from(padded('EXACT',1048576));
  for(let i=0;i<exact.length;i+=7777)await send(process.stdout,exact.subarray(i,i+7777));
  await send(process.stdout,'\\r');await send(process.stdout,'\\n');
  await send(process.stdout,padded('OVER',1048577)+'\\n');
 }else{
  const stream=mode==='stderr'?process.stderr:process.stdout;
  const prefix='OVERSIZE_SENTINEL_C01_';
  await send(stream,prefix);
  const chunk=Buffer.alloc(65536,120);
  let remaining=64*1024*1024-Buffer.byteLength(prefix);
  while(remaining){const n=Math.min(chunk.length,remaining);await send(stream,chunk.subarray(0,n));remaining-=n;}
  await send(stream,'\\r\\n');
 }
 await send(process.stdout,msg('RECOVERED','RECOVERED: € valid next record')+'\\n');
 await send(process.stdout,JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));
}
`;

afterEach(async () => { for (const r of roots.splice(0)) await rm(r,{recursive:true,force:true}); });
async function fixture() {
 const root=await mkdtemp(join(tmpdir(),'agentlens-c01-check-'));roots.push(root);
 const repo=join(root,'repo'),bin=join(root,'bin'),dataRoot=join(root,'data');
 await mkdir(repo);await mkdir(bin);
 await exec('git',['init','-q'],{cwd:repo});
 await exec('git',['config','user.name','External evaluator'],{cwd:repo});
 await exec('git',['config','user.email','evaluator@example.test'],{cwd:repo});
 await writeFile(join(repo,'tracked.txt'),'baseline\n');
 await exec('git',['add','tracked.txt'],{cwd:repo});await exec('git',['commit','-qm','fixture'],{cwd:repo});
 await writeFile(join(bin,'codex'),fixtureSource);await chmod(join(bin,'codex'),0o700);
 return {root,repo,dataRoot,env:{...process.env,PATH:bin+delimiter+process.env.PATH}};
}
async function capture(mode:string) {
 const c=await fixture();const stop=new AbortController();const timer=setTimeout(()=>stop.abort(),30000);
 try {
  const result=await recordRun({name:'record',capture:'standard',dataRoot:c.dataRoot,childArgs:['codex','exec','--json','--mode='+mode]},
   {cwd:c.repo,env:c.env,signal:stop.signal,stdin:Object.assign(Readable.from([]),{isTTY:false}) as any,stdout:{write(){return true}}});
  const db=openDatabase(join(c.dataRoot,'agentlens.sqlite'));
  try {return {...c,detail:new RunRepository(db,{artifactRoot:join(c.dataRoot,'artifacts','sha256')}).getRunDetail(result.runId)};}
  finally {db.close();}
 } finally {clearTimeout(timer);}
}
async function persistedFiles(root:string):Promise<Buffer[]> {
 const out:Buffer[]=[];
 for(const e of await readdir(root,{withFileTypes:true})){
  if(e.name==='secrets')continue;
  const p=join(root,e.name);if(e.isDirectory())out.push(...await persistedFiles(p));else if(e.isFile())out.push(await readFile(p));
 }
 return out;
}
for(const stream of ['stdout','stderr']) it(`C01-${stream}: discard 64 MiB without persisting content and recover`,async()=>{
 const {detail,dataRoot}=await capture(stream);
 const events=detail.events;
 const diagnostics=events.filter(e=>e.kind==='recorder.stream_diagnostic' && e.normalizedPayload.reason==='line_too_large');
 expect(diagnostics).toHaveLength(1);
 const p=diagnostics[0].normalizedPayload;
 expect(p.stream).toBe(stream);expect(p.limitBytes).toBe(MAX);
 expect(p.observedBytes??p.observedByteLength).toBe(64*1024*1024);
 expect(diagnostics[0].nativePayload).toBeUndefined();
 expect(JSON.stringify(p).length).toBeLessThan(1000);
 expect(events.some(e=>e.kind==='message.agent' && String(e.normalizedPayload.text).startsWith('RECOVERED:'))).toBe(true);
 for(const bytes of await persistedFiles(dataRoot))expect(bytes.includes(Buffer.from('OVERSIZE_SENTINEL_C01_'))).toBe(false);
},40000);

it('C01-boundary: accept exact byte limit with split CRLF and reject limit plus one',async()=>{
 const {detail}=await capture('boundary');
 const events=detail.events;
 expect(events.some(e=>e.kind==='message.agent' && e.source?.itemId==='EXACT')).toBe(true);
 expect(events.some(e=>e.kind==='message.agent' && e.source?.itemId==='OVER')).toBe(false);
 const d=events.filter(e=>e.kind==='recorder.stream_diagnostic' && e.normalizedPayload.reason==='line_too_large');
 expect(d).toHaveLength(1);expect(d[0].normalizedPayload.observedBytes??d[0].normalizedPayload.observedByteLength).toBe(MAX+1);
 expect(events.some(e=>e.kind==='message.agent' && String(e.normalizedPayload.text).startsWith('RECOVERED:'))).toBe(true);
},40000);

it('C01-framing: preserve blank records split UTF-8 CRLF and unterminated tail',async()=>{
 const c=await fixture();const lines:string[]=[];
 await runChildProcess({childArgs:['codex','exec','--json','--mode=framing'],cwd:c.repo,env:c.env,promptInput:{mode:'buffered',source:'stdin',bytes:Buffer.alloc(0)},onSpawn(){},onLine(_s,line){lines.push(line)}} as any);
 expect(lines.filter(line=>line.length>0)).toEqual(['first','€last']);
});

it('C01-backpressure: blocked persistence must stall a 128 MiB producer',async()=>{
 const c=await fixture();const done=join(c.root,'producer-finished');
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),first=new Promise<void>(r=>entered=r);
 const stop=new AbortController();let firstSeen=false,completedWhileBlocked=false;
 const timer=setTimeout(()=>{release();stop.abort()},15000);
 const pending=runChildProcess({childArgs:['codex','exec','--json','--mode=pressure'],cwd:c.repo,env:{...c.env,PRODUCER_FINISHED:done},signal:stop.signal,promptInput:{mode:'buffered',source:'stdin',bytes:Buffer.alloc(0)},onSpawn(){},async onLine(){if(!firstSeen){firstSeen=true;entered();await gate}}} as any);
 try {await first;await new Promise(r=>setTimeout(r,2000));completedWhileBlocked=await readFile(done).then(()=>true,()=>false);}
 finally {release();await pending;clearTimeout(timer);}
 expect(completedWhileBlocked).toBe(false);
 expect(await readFile(done,'utf8')).toBe('finished');
},20000);
