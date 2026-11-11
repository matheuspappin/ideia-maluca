const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://miwra.space/controle-ed.html');
  await page.locator('input[type="email"]').first().fill('vendalachef@gmail.com');
  await page.locator('input[type="password"]').first().fill('33bnpyu9sm');
  await Promise.all([
    page.waitForNavigation(),
    page.locator('button[type="submit"]').first().click()
  ]);
  console.log('Current URL:', page.url());
  await page.screenshot({path: 'login.png'});
  await browser.close();
})();
