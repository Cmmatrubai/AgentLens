// Six evidence-volume probes, isolated from the frozen small-case baseline.
// --check is offline; --run makes six paid requests without retries.
const { main } = require('./review-semantics.cjs');
const { matchesEntryFile } = require('./review-models.cjs');
if(require.main===module || (process.versions.electron && matchesEntryFile(process.argv[1],__filename))) void main({suite:'context'});
