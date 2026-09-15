// --check is offline; --run makes six explicit paid requests, with no retries.
const {main}=require('./review-semantics.cjs');
const {matchesEntryFile}=require('./review-models.cjs');
if(require.main===module || (process.versions.electron && matchesEntryFile(process.argv[1],__filename))) void main({suite:'compound'});
