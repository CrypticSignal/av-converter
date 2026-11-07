import express, { Request, Response } from 'express';

const app = express();
const PORT = process.env.PORT || 3000;
const LOKI_URL = 'http://loki:3100/loki/api/v1/push';

// The page calls this service from the same origin, so no CORS headers are sent:
// other sites can't read responses or send JSON here from a browser.
app.use(express.json({ limit: '2kb' }));
// nginx is the only hop in front of this service. Trusting just that hop makes req.ip
// the address nginx saw, not the leftmost X-Forwarded-For entry, which visitors can forge.
app.set('trust proxy', 1);

/** Keep a browser-supplied value only if it is a short string; anything else is discarded. */
const shortString = (value: unknown, fallback: string, maxLength = 100): string =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback;

app.post('/logging/visit', (req: Request, res: Response) => {
    // Cross-origin pages can only send JSON after a CORS preflight, which this service
    // never approves; their simple (non-JSON) requests are refused here.
    if (!req.is('application/json')) {
        res.sendStatus(415);
        return;
    }
    // The path comes from the browser, so only accept a short, absolute path.
    const rawPath = req.body?.path;
    const path = typeof rawPath === 'string' && rawPath.startsWith('/')
        ? rawPath.slice(0, 200)
        : 'Unknown';

    const logEntry = {
        "Path": path,
        "IP": req.ip || req.socket.remoteAddress,
        "Device Model": shortString(req.body?.deviceModel, 'Unknown Device'),
        "Device Platform": shortString(req.body?.devicePlatform, 'Unknown Platform'),
        "User Agent": shortString(req.headers['user-agent'], 'Unknown', 500)
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
