// Native UI acceptance: temporary fixture state, no provider/network access.
const { _electron, expect } = require('@playwright/test');
const path = require('node:path');
const { mkdir } = require('node:fs/promises');
const root = path.resolve(__dirname, '../..');
(async () => {
  const app = await _electron.launch({executablePath:require(path.join(root,'node_modules/electron')),
    args:[path.join(__dirname,'offline-desktop.cjs')], env:{...process.env,AGENTLENS_QA_SUPPORT_PRESET:'imports'}});
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    await expect(page.getByRole('heading',{name:'1 finding needs review'})).toBeVisible();
    await page.locator('.support-pending > summary').click();
    await page.locator('.support-claim-checks > summary').click();
    await expect(page.getByText('Local evidence check · Needs review',{exact:true})).toBeVisible();
    await page.getByText('Why this needs inspection',{exact:true}).click();
    await expect(page.locator('.support-claim').filter({hasText:'Local evidence check · Needs review'}).getByText(/Original AI assessment: supported/)).toBeVisible();
    await page.getByText('Matched import facts',{exact:true}).click();
    await expect(page.getByText('src/entry.ts:1 · north',{exact:true}).first()).toBeVisible();
    await page.getByText('Saved source identity',{exact:true}).first().click();
    await expect(page.getByText(/SHA-256:/).first()).toBeVisible();
    await mkdir(path.join(root,'.local/import-policy-qa'),{recursive:true});
    await page.locator('.support-claim-group').screenshot({path:path.join(root,'.local/import-policy-qa/claims.png')});
    await page.reload();
    await expect(page.getByRole('heading',{name:'1 finding needs review'})).toBeVisible();
    console.log('Native import policy QA passed: withheld claim, original AI opinion, parsed source facts, identity and reload.');
  } finally { await app.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
