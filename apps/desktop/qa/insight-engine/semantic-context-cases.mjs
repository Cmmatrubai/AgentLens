import { buildSemanticCases as buildBaseline } from './semantic-cases.mjs';

export const SEMANTIC_SUITE_VERSION = 'semantic-context-v1';
function addUnrelatedFiles(pair) {
  for(const attempt of pair.attempts) {
    attempt.run.git.files = Array.from({length:8},(_,fileIndex)=>{
      const path=`src/warehouse-${attempt.key}-${fileIndex}.ts`;
      const rows=Array.from({length:24},(_,row)=>`+  { slot: ${row}, aisle: "zone-${fileIndex}", marker: "${String(row).padStart(3,'0')}-${'abcdef0123456789'.repeat(3)}", enabled: ${row%2===0} },`);
      const content=[`diff --git a/${path} b/${path}`,'new file mode 100644','--- /dev/null',`+++ b/${path}`,`@@ -0,0 +1,${rows.length+2} @@`,`+export const warehouseRows${fileIndex} = [`,...rows,'+];',''].join('\n');
      return {path,content,truncated:false};
    });
  }
}
export function buildSemanticCases() {
  const baseline=buildBaseline();
  return buildBaseline(addUnrelatedFiles).map((expanded,index)=>{
    const original=baseline[index];
    const originalIds=new Set(original.bundle.sources.map(s=>s.id));
    const byId=new Map(expanded.bundle.sources.map(s=>[s.id,s]));
    if(original.bundle.sources.some(s=>JSON.stringify(byId.get(s.id))!==JSON.stringify(s)) || expanded.bundle.coverage.omittedSources) throw Error('context_source_guard_failed');
    // Keep the original citation IDs/positions and draft identical; append only
    // the newly selected file excerpts after the original evidence catalog.
    expanded.bundle.sources=[...original.bundle.sources,...expanded.bundle.sources.filter(s=>!originalIds.has(s.id))];
    expanded.draft=structuredClone(original.draft);
    return expanded;
  });
}
