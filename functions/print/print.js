const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");
const qs = require("qs")

const width = 1440
const height = 1200

const maxage = 60 * 60 * 24 * 7

exports.handler = async (event, context) => {
  const path = event.path.replace("/.netlify/functions", "").replace("/print", "").replace(".pdf", "")
    if (path.indexOf('favicon.ico') > -1) {
        return {
            statusCode: 404
        }
    }
    event.queryStringParameters.takingss = 1;
    event.queryStringParameters.cookieAccept = 1;
    event.queryStringParameters.swnDismiss = 1;
    const url = `${process.env.BASE_URL}${path}${qs.stringify(event.queryStringParameters, { addQueryPrefix: true })}`
    // const url = `https://idp-test.mif.services${path}${qs.stringify(event.queryStringParameters, { addQueryPrefix: true })}`
    console.log(url);
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
    ]);

    const browser = await puppeteer.launch({
        args: args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        // executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: chromium.headless,
        userDataDir: '/tmp',
    })


    console.log(1);
    console.time('timer');
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 })
    console.log(2);
    console.timeLog('timer');
    await page.goto(url, { waitUntil: "networkidle2" })
    console.log(3);
    console.timeLog('timer');
    // await page.goto(url, { timeout: 0} )
    // console.log(4);
    // console.timeLog('timer');
    console.log(event.queryStringParameters.view === 'table' ? '#mifDataTable' : '#screenshotPdfFrame');
    await page.waitForSelector(event.queryStringParameters.view === 'table' ? '#mifDataTable'  : '#screenshotPdfFrame', { timeout: 0 });
    console.log(5);
    console.timeLog('timer');

    page.emulateMediaType('screen');
    const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    scale: 0.5,
    margin: {
      top: 20,
      right: 40,
      bottom: 20,
      left: 40,
    },
  })

  console.log(7);
  console.timeEnd('timer');


  await browser.close()

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=2024-iiag.pdf",
        "Cache-Control": `public, max-age=${maxage}`,
    },
    body: pdf.toString("base64"),
    isBase64Encoded: true,
  }
}
