import express, { Request, Response } from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;
const LOKI_URL = 'http://loki:3100/loki/api/v1/push';

app.use(cors());
app.use(express.json());
app.set('trust proxy', true);

app.post('/logging/visit', async (req: Request, res: Response) => {
    try {
        const logEntry = {
            "IP": req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress,
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
