import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";

const prototype = fileURLToPath(new URL("../../", import.meta.url));
const privateRoot = join(prototype, ".local/comparison-C01");
const name = process.argv[2];
if (!["sol", "terra"].includes(name)) throw new Error("Choose a frozen attempt");
const manifest = JSON.parse(await readFile(join(privateRoot, "manifest.json"), "utf8"));
const permissionArgs = JSON.parse(await readFile(join(privateRoot, name + "-permissions.json"), "utf8"));
const attempt = manifest.attempts.find(a => a.key === name);
const dir = join(privateRoot, name);
await mkdir(dir); // Refuse to silently repeat an already-started attempt.
for (const [relative, expected] of Object.entries(manifest.inputs)) {
  const bytes = await readFile(join(prototype, relative));
  if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("Frozen experiment input changed");
}
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: attempt.workspace, encoding: "utf8" }).trim();
const status = execFileSync("git", ["status", "--porcelain"], { cwd: attempt.workspace, encoding: "utf8" }).trim();
if (head !== manifest.baseCommit || status) throw new Error("Attempt starting state is not clean and matched");
const prompt = await readFile(join(prototype, "experiments/C01/prompt.md"));
const { recordRun } = await import(pathToFileURL(join(manifest.recorder.repository, "apps/cli/src/recordRun.ts")).href);
const stop = new AbortController();
const startedAt = Date.now();
let timedOut = false, eventCount = 0, runId;
const timer = setTimeout(() => { timedOut = true; stop.abort(); }, manifest.timeoutMs);
const argv = ["codex", "exec", "--json", "--ephemeral", "--ignore-user-config", "--ignore-rules",
  "-m", attempt.model, ...permissionArgs, "-c", 'model_reasoning_effort="high"',
  "-c", 'approval_policy="never"', "-c", "project_doc_max_bytes=0", "-c", "features.chronicle=false",
  "-c", "features.multi_agent=false", "-c", 'web_search="disabled"',
  "-c", 'shell_environment_policy.inherit="core"', "-c", 'shell_environment_policy.ignore_default_excludes=false', "-C", attempt.workspace, "-"];
await writeFile(join(dir, "launch.json"), JSON.stringify({manifestId:manifest.id, manifestHash:manifest.manifestHash, name, model:attempt.model, reasoningEffort:"high", argv, startedAt},null,2)+"\n");
const update = async state => writeFile(join(dir,"status.json"),JSON.stringify({name,runId,startedAt,eventCount,timedOut,...state},null,2)+"\n");
process.on("SIGINT",()=>stop.abort());process.on("SIGTERM",()=>stop.abort());
try {
  const result = await recordRun({name:"record",capture:"standard",dataRoot:attempt.dataRoot,label:`comparison:C01:${name}:high`,childArgs:argv},{
    cwd:attempt.workspace, env:process.env,
    signal:stop.signal,stdin:Object.assign(Readable.from([prompt]),{isTTY:false}),
    stdout:{write(chunk){process.stdout.write(String(chunk));return true;}},
    async onRunIdPrinted(id){runId=id;await update({state:"recording"});},
    async onObservedEventPersisted(){eventCount++;if(eventCount%10===0){await update({state:"recording"});process.stdout.write(JSON.stringify({name,eventCount,elapsedSeconds:Math.round((Date.now()-startedAt)/1000)})+"\n");}}
  });
  await writeFile(join(dir,"result.json"),JSON.stringify({manifestId:manifest.id,manifestHash:manifest.manifestHash,name,model:attempt.model,reasoningEffort:"high",startedAt,endedAt:Date.now(),timedOut,result},null,2)+"\n");
  await update({state:"recorded",endedAt:Date.now(),result});
  process.stdout.write(JSON.stringify({name,status:result.status,runId:result.runId,timedOut})+"\n");
} catch(error) {
  await update({state:"failed",endedAt:Date.now(),error:String(error?.message??error)});
  throw error;
} finally { clearTimeout(timer); }
