const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");
const qs = require("qs")

const width = 1440
const height = 1200
const maxage = 60 * 60 * 24 * 7



exports.handler = async (event, context) => {
  const path = event.path.replace("/.netlify/functions", "").replace("/screenshot", "").replace(".png", "");
    if (path.indexOf('favicon.ico') > -1) {
        return {
            statusCode: 404
        }
    }
  event.queryStringParameters.takingss = 1;
  event.queryStringParameters.cookieAccept = 1;
  event.queryStringParameters.swnDismiss = 1;
  const url = `${process.env.BASE_URL}${path}${qs.stringify(event.queryStringParameters, { addQueryPrefix: true })}`


    let args = chromium.args;
    args.push(...[
        '--autoplay-policy=user-gesture-required',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-dev-shm-usage',
        '--disable-domain-reliability',
        '--disable-extensions',
        '--disable-features=AudioServiceOutOfProcess',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-notifications',
        '--disable-offer-store-unmasked-wallet-cards',
        '--disable-popup-blocking',
        '--disable-print-preview',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-setuid-sandbox',
        '--disable-speech-api',
        '--disable-sync',
        '--hide-scrollbars',
        '--ignore-gpu-blacklist',
        '--disable-gpu',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check',
        '--no-first-run',
        '--no-pings',
        '--no-sandbox',
        '--no-zygote',
        '--password-store=basic',
        '--use-gl=swiftshader',
        '--use-mock-keychain',
        '--disable-local-storage',
    ]);

  const browser = await puppeteer.launch({
    args: args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: true, // chromium.headless,
    userDataDir: '/tmp'
  })

  console.log(1);
  console.time('timer');
    const page = await browser.newPage();
    console.log(2);
    console.timeLog('timer');
    await page.setViewport({ width, height, deviceScaleFactor: 2 })
    console.log(3);
    console.timeLog('timer');
    await page.goto(url, { waitUntil: "networkidle0" })
    console.log(4);
    console.timeLog('timer');
    await page.waitForSelector(event.queryStringParameters.view === 'table' ? '#mifDataTable'  : '#screenshotPdfFrame');
    console.log(5);
    console.timeLog('timer');
  const frame = await page.$('#screenshotPdfFrame');
    console.log(6);
    console.timeLog('timer');
  const screenshot = await frame.screenshot({
    type:'png',
    omitBackground: 'true'
  })
    console.log(7);
    console.timeEnd('timer');
//   const screenshot = await page.screenshot();

  await browser.close()

  return {
    statusCode: 200,
    headers: {
      "Cache-Control": `public, max-age=${maxage}`,
      "Content-Type": "image/png",
      "Content-Disposition": "attachment; filename=2024-iiag.png",
      "Expires": new Date(Date.now() + maxage * 1000).toUTCString(),
    },
    body: screenshot.toString("base64"),
    isBase64Encoded: true,
  }
}
