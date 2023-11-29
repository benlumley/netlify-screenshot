const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");
const qs = require("qs")

const width = 1440
const height = 1280

const maxage = 60 * 60 * 24 * 7

exports.handler = async (event, context) => {
  const path = event.path.replace("/.netlify/functions", "").replace("/print", "").replace(".pdf", "")
    if (path.indexOf('favicon.ico') > -1) {
        return {
            statusCode: 404
        }
    }
    event.queryStringParameters.screenshot = 1;
    event.queryStringParameters.cookieAccept = 1;
    event.queryStringParameters.cachebust = Date.now();
    // const url = `http://leadershipethos.localhost/${path}${qs.stringify(event.queryStringParameters, { addQueryPrefix: true })}`
    // const url = `https://staging:password@leadership-ethos.onyx-sites.io${path}${qs.stringify(event.queryStringParameters, { addQueryPrefix: true })}`
    const url = `${process.env.BASE_URL}${path}${qs.stringify(event.queryStringParameters, { addQueryPrefix: true })}`
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

    console.log('check 1');
  const browser = await puppeteer.launch({
    args: args,
    defaultViewport: { width, height, deviceScaleFactor: 2 },
    executablePath: await chromium.executablePath(),
    // executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, // chromium.headless,
    userDataDir: '/tmp',
    emulateMediaType: 'screen',

  })

    console.log('check 2');
    const [page] = await browser.pages();
    console.log('check 3');
    await page.setCacheEnabled(false);
    console.log('check 4');
    await page.goto(url, { waitUntil: "networkidle0" })
    console.log('check 5');
    await page.waitForSelector('.gauge--chart');
    console.log('check 6');

    await page.evaluate(function () {
        document.getElementById('cookie-law-info-bar').remove();
    });
    console.log('check 7');

    await page.emulateMediaType('screen');
        console.log('check 8');
        const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        scale: 0.8,
        preferCSSPageSize: true
    })
    console.log('check 9');

    await browser.close()
    console.log('check 10');

  return {
    statusCode: 200,
    headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=Your Leadership Gauge Summary.pdf",
        // "Cache-Control": `public, max-age=${maxage}`,
    },
    body: pdf.toString("base64"),
    isBase64Encoded: true,
  }
}
