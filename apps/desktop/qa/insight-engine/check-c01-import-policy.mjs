// Offline regression on the frozen original review. Never contacts a provider or writes saved jobs.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildC01GranularityCases, validateAndScoreC01Output } from "./c01-granularity.mjs";
import { applyLocalSupportPolicy } from "../../server/insights/import-facts.mjs";
const root = new URL("../../.local/insight-engine/", import.meta.url);
const names = ["job-be0406bf-b8b8-40f5-89a1-c467757e33de.json", "support-aa58e3de-caa7-445f-b459-d158f812dadd.json", "c01-granularity-evaluation/12f8d39a-cdef-4bfd-8dc5-f8695e58468f/f0-observation-1.json"];
const sha = value => createHash("sha256").update(value).digest("hex");
const paths = names.map(name => fileURLToPath(new URL(name, root)));
const originals = await Promise.all(paths.map(path => readFile(path)));
const [job, support, response] = originals.map(raw => JSON.parse(raw));
if (sha(originals[0]) !== "4640cd3da1680fddc723dc8856b86c77e620b0cab618dc781b46fc8035caf740" ||
    sha(JSON.stringify(job.output)) !== "5ba6d09f32af9e6de48468407481af99d979740860db873cedcd0d59819867dc" ||
    sha(JSON.stringify(support.draft)) !== sha(JSON.stringify(job.output)) || support.evidence.inputHash !== job.inputHash ||
    sha(JSON.stringify(response.output)) !== "222a0fa74e0292d4f919ce7e1d1a16fee5577e97e678e29fabe66bb110fcbe66") throw Error("Frozen evidence guard failed");
const fixture = buildC01GranularityCases(support.evidence, job.output)[0];
const checked = validateAndScoreC01Output(fixture, response.output);
const result = applyLocalSupportPolicy(support.evidence, job.output, {findings:[{
  findingId: fixture.originalUnit.findingId, verdict:checked.actualVerdict, claims:checked.claims, issues:[], reason:"Frozen exact-unit review"
}]});
const claim = result.findings[0].claims.find(item => item.text.includes("imported by"));
if (claim?.verdict !== "needs_review" || claim.providerAssessment?.verdict !== "supported") throw Error("Import regression failed");
const after = await Promise.all(paths.map(path => readFile(path)));
if (after.some((raw, index) => sha(raw) !== sha(originals[index]))) throw Error("Original file changed");
console.log(JSON.stringify({state:"passed", policyVersion:result.policyVersion, unitId:fixture.unitId,
  providerVerdict:claim.providerAssessment.verdict, effectiveVerdict:claim.verdict, localCheck:claim.localCheck.status,
  parsedSources:result.importFacts.coverage.filter(c => c.status === "parsed").length,
  importFacts:result.importFacts.facts.length, originalFilesUnchanged:true, providerRequests:0,
  scope:"One frozen import claim; not a semantic-accuracy score or a human audit."}, null, 2));
