// Explicit v4 entry point; historical v2 plans/results remain distinct.
// Offline: node review-passages.cjs --plan passage-review-plan.json --check
// Live: electron review-passages.cjs --plan passage-review-plan.json
const { main, matchesEntryFile } = require('./review-models.cjs');
if (require.main === module || (process.versions.electron && matchesEntryFile(process.argv[1], __filename))) {
  void main({ version: 'support-v4', promptVersion: 'evidence-support-v4', maximumOutputTokens: 12000 });
}
