/** The parts of the User-Agent Client Hints API used here. Only Chromium browsers have it. */
interface UserAgentData {
  getHighEntropyValues(hints: string[]): Promise<{ model?: string }>;
}

/**
 * User agents of crawlers that run JavaScript (e.g. Googlebot), page-speed tools and headless
 * browsers. Browsers controlled by automation (Playwright, Puppeteer, Selenium) are caught by
 * navigator.webdriver instead. The logging service checks the user agent again.
 */
const BOT_USER_AGENT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|prerender|preview|scrape|fetch|curl|wget|python|java\/|go-http|axios|node-fetch|phantomjs|selenium|puppeteer|playwright|facebookexternalhit|embedly|bingpreview/i;

/**
 * Reports a page visit to the logging service, which forwards it to Loki. The page's path,
 * device model and time zone are sent; the service doesn't record the visitor's IP address.
 */
export async function logVisit(path: string) {
  // Only real visitors are logged.
  if (navigator.webdriver || BOT_USER_AGENT.test(navigator.userAgent)) return;

  let deviceModel = 'Unknown Device';

  const userAgentData = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  if (userAgentData) {
    try {
      const { model } = await userAgentData.getHighEntropyValues(['model']);
      if (model) deviceModel = model;
    } catch (e) {
      console.error(e);
    }
  }

  fetch('/logging/visit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    // The device's own time zone, e.g. "Europe/London". Unlike the city, which the logging
    // service looks up from the IP address, a VPN doesn't change it.
    body: JSON.stringify({ path, deviceModel, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
  }).catch(err => console.error('Logging failed:', err));
}
