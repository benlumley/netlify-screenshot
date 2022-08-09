const chromium = require("chrome-aws-lambda")
const qs = require("qs")

const width = 1200
const height = 630
const maxage = 60 * 60 * 24 * 7

exports.handler = async (event, context) => {
  const path = event.path.replace("/.netlify/functions", "").replace("/screenshot", "").replace(".png", "")
  event.queryStringParameters.takingss = 1;
  const url = `${process.env.BASE_URL}${path}${qs.stringify(event.queryStringParameters, { addQueryPrefix: true })}`
console.log(url);
  const browser = await chromium.puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: true // chromium.headless,
  })

  console.log(1);
  const page = await browser.defaultPage()
    console.log(2);
   await page.setViewport({ width, height })
    console.log(3);
  await page.goto(url)
    console.log(4);
  await page.waitForSelector('#screenshotPdfFrame');
    console.log(5);
  const frame = await page.$('#screenshotPdfFrame');
    console.log(6);
  const screenshot = await frame.screenshot()
    console.log(7);
//   const screenshot = await page.screenshot();

  await browser.close()

  return {
    statusCode: 200,
    headers: {
      "Cache-Control": `public, max-age=${maxage}`,
      "Content-Type": "image/png",
      "Expires": new Date(Date.now() + maxage * 1000).toUTCString(),
    },
    body: screenshot.toString("base64"),
    isBase64Encoded: true,
  }
}
