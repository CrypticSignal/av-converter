import express, { Request, Response } from 'express';
import { locate, startGeo } from './geo.js';

const app = express();
const PORT = process.env.PORT || 3000;
const LOKI_URL = process.env.LOKI_URL || 'http://loki:3100/loki/api/v1/push';
/**
 * The visitor's operating system, from their user agent. Every browser includes it, unlike the
 * User-Agent Client Hints API, which only Chromium browsers have. Order matters: iPhone and
 * Android user agents also mention macOS and Linux.
 */
const PLATFORMS: [RegExp, string][] = [
    [/iPhone|iPad|iPod/, 'iOS'],
    [/Android/, 'Android'],
    [/CrOS/, 'ChromeOS'],
    [/Windows/, 'Windows'],
    [/Mac OS X|Macintosh/, 'macOS'],
    [/Linux|X11/, 'Linux'],
];
const platformOf = (userAgent: string): string =>
    PLATFORMS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Unknown Platform';

/**
 * The visitor's browser, from their user agent. Order matters: Edge, Opera and Samsung Internet
 * also say Chrome, and Chrome also says Safari. On iOS, Chrome and Firefox name themselves
 * CriOS and FxiOS.
 */
const BROWSERS: [RegExp, string][] = [
    [/Edg(e|A|iOS)?\//, 'Edge'],
    [/OPR\/|Opera/, 'Opera'],
    [/SamsungBrowser/, 'Samsung Internet'],
    [/Firefox|FxiOS/, 'Firefox'],
    [/Chrome|CriOS/, 'Chrome'],
    [/Safari/, 'Safari'],
];
/**
 * The time zone the visitor's device is set to, e.g. "Europe/London", as the page reported it.
 * Kept only if it looks like an IANA time zone name.
 */
const timeZoneOf = (value: unknown): string =>
    typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+){0,2}$/.test(value) && value.length <= 64
        ? value : 'Unknown';

const browserOf = (userAgent: string): string =>
    BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Unknown Browser';

// The page calls this service from the same origin, so no CORS headers are sent:
// other sites can't read responses or send JSON here from a browser.
app.use(express.json({ limit: '2kb' }));

/** Keep a browser-supplied value only if it is a short string; anything else is discarded. */
const shortString = (value: unknown, fallback: string, maxLength = 100): string =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback;

/**
 * User agents of crawlers, link previewers, monitoring tools, HTTP libraries and automated or
 * headless browsers. Real browsers' user agents contain none of these words.
 */
const BOT_USER_AGENT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|prerender|preview|scrape|fetch|curl|wget|python|java\/|go-http|axios|node-fetch|phantomjs|selenium|puppeteer|playwright|facebookexternalhit|embedly|bingpreview/i;

/** Whether a request comes from a bot rather than a person. A missing user agent counts as a bot. */
const isBot = (userAgent: string | undefined): boolean => !userAgent || BOT_USER_AGENT.test(userAgent);

app.post('/logging/visit', (req: Request, res: Response) => {
    // Cross-origin pages can only send JSON after a CORS preflight, which this service
    // never approves; their simple (non-JSON) requests are refused here.
    if (!req.is('application/json')) {
        res.sendStatus(415);
        return;
    }
    // Only real visitors are recorded. The page skips automated browsers itself; this also
    // drops crawlers that run JavaScript (e.g. Googlebot) and anything that calls this directly.
    // The user agent is only checked, never recorded.
    if (isBot(req.headers['user-agent'])) {
        res.sendStatus(204);
        return;
    }
    // The path comes from the browser, so only accept a short, absolute path.
    const rawPath = req.body?.path;
    const path = typeof rawPath === 'string' && rawPath.startsWith('/')
        ? rawPath.slice(0, 200)
        : 'Unknown';

    // Nginx sets X-Real-IP to the address it saw, replacing any value the visitor sent.
    const realIp = req.headers['x-real-ip'];
    const { city, country } = locate(typeof realIp === 'string' ? realIp : undefined);
    // The IP address and user agent are used above but not recorded.
    const logEntry = {
        "Path": path,
        "City": city,
        "Country": country,
        "Time Zone": timeZoneOf(req.body?.timeZone),
        "Device Model": shortString(req.body?.deviceModel, 'Unknown Device'),
        "Device Platform": platformOf(req.headers['user-agent'] ?? ''),
        "Browser": browserOf(req.headers['user-agent'] ?? ''),
    };

    const lokiPayload = {
        streams: [
            {
                stream: { job: 'visits' },
                values: [
                    [ (Date.now() * 1000000).toString(), JSON.stringify(logEntry) ]
                ]
            }
        ]
    };

    fetch(LOKI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lokiPayload)
    }).catch(err => console.error('Failed to push to Loki:', err));
    
    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`Logging API running on port ${PORT}`);
});
// Load the IP location database and keep it up to date, without delaying requests: until it's
// ready, cities are logged as Unknown.
void startGeo();
