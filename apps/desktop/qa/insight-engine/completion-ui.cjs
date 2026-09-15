// Native acceptance with synthetic evidence, temporary settings and provider network disabled.
const { _electron, expect } = require('@playwright/test');
const path = require('node:path');
const { mkdir } = require('node:fs/promises');
const root = path.resolve(__dirname, '../..');
(async () => {
  const app = await _electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [path.join(__dirname, 'offline-desktop.cjs')],
  });
  let page;
  try {
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    await expect(page.getByRole('heading', { name: 'OFFLINE QA · Compare validation approaches' })).toBeVisible();
    await page.getByText('Analysis options', {exact:true}).click();
    await page.getByRole('button', {name: 'Provider settings', exact: true}).click();
    await page.getByLabel('Analysis model ID', {exact:true}).fill('offline-limit');
    await page.getByLabel('This endpoint does not require an API key').check();
    await page.getByLabel('Enable analysis at this endpoint').check();
    await page.locator('details').filter({has:page.locator('summary', {hasText:'Response limits'})}).locator('summary').click();
    await page.getByLabel('Reasoning effort').selectOption('low');
    await page.getByLabel('Output token limit', {exact:true}).fill('12000');
    await page.getByLabel('Time limit (seconds)', {exact:true}).fill('180');
    for (const [width, height] of [[1440,940],[820,900]]) {
      await app.evaluate(({BrowserWindow}, bounds) => BrowserWindow.getAllWindows()[0].setSize(...bounds), [width,height]);
      await expect(page.getByRole('button',{name:'Save settings',exact:true})).toBeInViewport();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await mkdir(path.join(__dirname,'completion'),{recursive:true});
    await page.screenshot({path:path.join(__dirname,'completion/settings-820.png')});
    await page.getByRole('button',{name:'Save settings',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Ready to explore how the agents differ?'})).toBeVisible();
    await page.getByRole('button',{name:'Review evidence for analysis',exact:true}).click();
    await expect(page.getByText(/This request: up to 12,000 output tokens/)).toBeVisible();
    await expect(page.getByText(/180 seconds · reasoning low/)).toBeVisible();
    await page.getByLabel(/I reviewed these excerpts/).check();
    await page.getByRole('button',{name:'Generate insights',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Response limit reached'})).toBeVisible({timeout:10000});
    await page.getByText('Provider response details',{exact:true}).first().click();
    await expect(page.getByText('Reasoning tokens',{exact:true}).first()).toBeVisible();
    await expect(page.getByText('5,994',{exact:true}).first()).toBeVisible();
    await page.screenshot({path:path.join(__dirname,'completion/limit-820.png')});
    await page.getByText(/Analysis history ·/).click();
    await expect(page.locator('.insight-history-row')).toHaveCount(1);
    await page.reload();
    await expect(page.getByRole('heading',{name:'Response limit reached'})).toBeVisible();
    await page.getByText(/Analysis history ·/).click();
    await expect(page.locator('.insight-history-row')).toHaveCount(1);
    await page.getByRole('button',{name:'Adjust provider settings',exact:true}).click();
    await page.getByText('Response limits',{exact:true}).click();
    await expect(page.getByLabel('Output token limit',{exact:true})).toHaveValue('12000');
    await expect(page.getByLabel('Time limit (seconds)',{exact:true})).toHaveValue('180');
    await expect(page.getByLabel('Reasoning effort')).toHaveValue('low');
    console.log('Native completion QA passed: settings, review, bounded failure, diagnostics, reload and responsive footer.');
  } catch (error) {
    if(page) {
      await page.screenshot({path:'/tmp/agentlens-completion-ui-failure.png'});
      console.log(await page.locator('[role=dialog]').innerText().catch(()=>''));
    }
    throw error;
  } finally { await app.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
