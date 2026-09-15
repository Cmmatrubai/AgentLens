// Native UI acceptance: temporary saved records, no analysis/key/provider call.
const { _electron, expect } = require('@playwright/test');
const path = require('node:path');
const { mkdir } = require('node:fs/promises');
const root = path.resolve(__dirname, '../..');
(async () => {
  const app = await _electron.launch({executablePath:require(path.join(root,'node_modules/electron')),
    args:[path.join(__dirname,'offline-desktop.cjs')],env:{...process.env,AGENTLENS_QA_SUPPORT_PRESET:'facts'}});
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    const facts = page.locator('.recorded-facts');
    await expect(facts).toBeVisible();
    await expect(facts).not.toHaveAttribute('open','');
    await facts.locator(':scope > summary').click();
    await expect(facts.getByText('Unknown',{exact:true})).toHaveCount(2);
    const north = facts.getByRole('region',{name:'Recorded facts for orion-code (north)'});
    await north.locator('.recorded-fact-row').filter({hasText:'Independent regression'}).locator(':scope > summary').click();
    await north.getByText('Selected evidence · Independent regression',{exact:true}).click();
    await expect(north.getByText('north independent result: pass',{exact:true})).toBeVisible();
    await north.locator('.recorded-command-facts > summary').click();
    await expect(north.getByText('Exit 1',{exact:true})).toBeVisible();
    await mkdir(path.join(root,'.local/recorded-facts-qa'),{recursive:true});
    await facts.screenshot({path:path.join(root,'.local/recorded-facts-qa/desktop.png')});
    await page.setViewportSize({width:820,height:960});
    await expect(facts).toBeVisible();
    const columns = await page.locator('.recorded-facts-attempts').evaluate(el => getComputedStyle(el).gridTemplateColumns);
    if (columns.trim().split(/\s+/).length !== 1) throw Error('Expected one fact column in narrow window');
    if (await facts.evaluate(el => el.scrollWidth > el.clientWidth + 1)) throw Error('Fact panel overflow');
    await page.screenshot({path:path.join(root,'.local/recorded-facts-qa/narrow.png')});
    await page.reload();
    await expect(facts).not.toHaveAttribute('open','');
    await facts.locator(':scope > summary').click();
    await expect(facts.getByText('Unknown',{exact:true})).toHaveCount(2);
    console.log('Recorded facts native QA passed: no analysis required, unknown planned checks, owning evidence, command exits, narrow layout and reload.');
  } finally { await app.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
