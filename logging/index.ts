import express, { Request, Response } from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;
const LOKI_URL = 'http://loki:3100/loki/api/v1/push';

app.use(cors());
app.use(express.json());
// nginx is the only hop in front of this service. Trusting just that hop makes req.ip
// the address nginx saw, not the leftmost X-Forwarded-For entry, which visitors can forge.
app.set('trust proxy', 1);

app.post('/logging/visit', async (req: Request, res: Response) => {
    try {
        // The path comes from the browser, so only accept a short, absolute path.
        const rawPath = req.body?.path;
        const path = typeof rawPath === 'string' && rawPath.startsWith('/')
            ? rawPath.slice(0, 200)
            : 'Unknown';

        const logEntry = {
            "Path": path,
            "IP": req.ip || req.socket.remoteAddress,
            "Device Model": req.body.deviceModel,
            "Device Platform": req.body.devicePlatform,
            "User Agent": req.headers['user-agent'] || 'Unknown'
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
        
        res.sendStatus(200)
    } catch (error) {
        res.sendStatus(200)
    }
});

app.listen(PORT, () => {
    console.log(`Logging API running on port ${PORT}`);
});
