import { chromium } from '@playwright/test';

const browser = await chromium.launch();

// Desktop — full page
const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await desktop.goto('http://localhost:3000/get-usdc', { waitUntil: 'load', timeout: 60000 });
await desktop.waitForSelector('text=Get your wallet on Base', { timeout: 30000 });
await desktop.waitForTimeout(2000);
await desktop.screenshot({ path: '/tmp/getusdc-desktop-full.png', fullPage: true });

// MetaMask card with Mobile tab selected (toggle check)
await desktop.click('text=📱 Mobile');
await desktop.waitForTimeout(500);
const mmCard = desktop.locator('h3:has-text("I use MetaMask")').locator('xpath=ancestor::div[contains(@class,"glass-card")][1]');
await mmCard.screenshot({ path: '/tmp/getusdc-metamask-mobiletab.png' });

// Mobile viewport — full page
const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
await mobile.goto('http://localhost:3000/get-usdc', { waitUntil: 'load', timeout: 60000 });
await mobile.waitForSelector('text=Get your wallet on Base', { timeout: 30000 });
await mobile.waitForTimeout(2000);
await mobile.screenshot({ path: '/tmp/getusdc-mobile-full.png', fullPage: true });

// FAQ deep link — section auto-expanded
const faq = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
await faq.goto('http://localhost:3000/faq#base-usdc', { waitUntil: 'load', timeout: 60000 });
await faq.waitForTimeout(2500);
await faq.screenshot({ path: '/tmp/faq-baseusdc.png', fullPage: false });

await browser.close();
console.log('done');
