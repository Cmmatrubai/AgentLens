// Read-only acceptance against an explicitly selected saved revision. No generation clicks.
const { _electron, expect } = require('@playwright/test');
const path = require('node:path');
const { mkdir } = require('node:fs/promises');
const root = path.resolve(__dirname, '../..');
const revision = process.env.AGENTLENS_QA_REVISION;
if (!/^[a-f0-9-]{36}$/.test(revision || '')) throw Error('Set AGENTLENS_QA_REVISION to the saved revision under review.');
(async () => {
  const app = await _electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [root],
  });
  let page;
  try {
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    await page.getByRole('button', {name:'Comparison', exact:true}).click();
    const findings = page.locator('.comparison-findings').filter({hasText:'Generated analysis · This saved revision'});
    await expect(findings).toBeVisible();
    await page.getByText('Analysis revision details', {exact:true}).click();
    await expect(page.getByText(revision, {exact:true})).toBeVisible();
    await expect(page.getByText('comparison-rubric-v3', {exact:true})).toBeVisible();
    await page.getByText('Analysis revision details', {exact:true}).click();
    const summaries = await findings.locator('.finding-card > p').allTextContents();
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries.length).toBeLessThanOrEqual(3);
    expect(summaries.every(text => text.length <= 280)).toBe(true);
    expect((await findings.locator('.finding-card h3').allTextContents()).every(text => text.length <= 80)).toBe(true);
    await mkdir(path.join(__dirname, 'concise'), {recursive:true});
    for (const [width,height] of [[1440,940],[820,900]]) {
      await app.evaluate(({BrowserWindow}, bounds) => BrowserWindow.getAllWindows()[0].setSize(...bounds), [width,height]);
      await findings.scrollIntoViewIfNeeded();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({path:path.join(__dirname, `concise/c01-${width}.png`)});
    }
    await findings.getByRole('button', {name:/^Compare evidence:/}).first().click();
    await expect(page.locator('.finding-evidence-side')).toHaveCount(2);
    expect((await page.locator('.finding-observation p').allTextContents()).every(text => text.length <= 500)).toBe(true);
    await expect(page.getByRole('button', {name:'Back to findings', exact:true})).toBeInViewport();
    await page.screenshot({path:path.join(__dirname, 'concise/c01-evidence-820.png')});
    await page.getByRole('button', {name:'Back to findings', exact:true}).click();
    await page.reload();
    await expect(findings).toBeVisible();
    expect(await findings.locator('.finding-card > p').allTextContents()).toEqual(summaries);
    console.log(JSON.stringify({revision,findings:summaries.length,summaryCharacters:summaries.map(text=>text.length),nativeWidths:[1440,820],pairedEvidence:true,reload:true}));
  } finally { await app.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
