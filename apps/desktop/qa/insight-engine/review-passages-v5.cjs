// Explicit v5 entry point; historical v2 plans/results remain distinct.
// Offline: node review-passages-v5.cjs --plan passage-review-plan.json --check
// Live: electron review-passages-v5.cjs --plan passage-review-plan.json
const { main, matchesEntryFile } = require('./review-models.cjs');
if (require.main === module || (process.versions.electron && matchesEntryFile(process.argv[1], __filename))) {
  void main({ version: 'support-v5', promptVersion: 'evidence-support-v5', maximumOutputTokens: 12000 });
}
