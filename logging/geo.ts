/**
 * Looks up a visitor's approximate city and country from their IP address, on this server, in
 * DB-IP's free IP-to-city database (CC BY 4.0, https://db-ip.com). The IP address is never sent
 * to another service, and the caller doesn't record it.
 *
 * DB-IP publishes a new database each month, and IP addresses keep being reassigned, so this
 * downloads the latest one when the service starts without one, and again whenever the one
 * it has is over a month old. The file is kept in a Docker volume (see docker-compose.yml), so
 * a restart doesn't download it again.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import maxmind, { type CityResponse, type Reader } from 'maxmind';

const DB_PATH = process.env.GEO_DB || '/app/data/dbip-city-lite.mmdb';
/** Where each month's database is published; {month} is e.g. 2026-11. */
const DB_URL = process.env.GEO_DB_URL || 'https://download.db-ip.com/free/dbip-city-lite-{month}.mmdb.gz';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Download a newer database once the current one is this old. */
const MAX_AGE_MS = 32 * DAY_MS;

let reader: Reader<CityResponse> | null = null;

/** "2026-11" for this month, then last month's, which is still the latest early in a month. */
const recentMonths = (): string[] => {
    const date = new Date();
    const thisMonth = date.toISOString().slice(0, 7);
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - 1);
    return [thisMonth, date.toISOString().slice(0, 7)];
};

/** The database's age in milliseconds, or undefined if there isn't one. */
const ageOfDatabase = async (): Promise<number | undefined> => {
    try {
        return Date.now() - (await stat(DB_PATH)).mtimeMs;
    } catch {
        return undefined;
    }
};

/** Open a database file, checking it's one this can read. Throws if not. */
const open = async (path: string): Promise<Reader<CityResponse>> => {
    const opened = await maxmind.open<CityResponse>(path, { watchForUpdates: false });
    if (!opened.metadata.databaseType.toLowerCase().includes('city')) {
        throw new Error(`${path} is a ${opened.metadata.databaseType} database, not a city database`);
    }
    return opened;
};

/** When a database was built, e.g. "2026-11-01", from its own metadata. */
const builtOn = (opened: Reader<CityResponse>) => opened.metadata.buildEpoch.toISOString().slice(0, 10);

/**
 * Download the latest database and start using it. It's written to a temporary file and only
 * replaces the current one once it has opened successfully, so a failed or partial download
 * never leaves the service without a working database.
 */
const download = async (): Promise<void> => {
    const temporary = `${DB_PATH}.download`;
    const failures: string[] = [];
    for (const month of recentMonths()) {
        const url = DB_URL.replace('{month}', month);
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
            if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
            await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), createGunzip(), createWriteStream(temporary));
            const downloaded = await open(temporary);
            await rename(temporary, DB_PATH);
            reader = downloaded;
            console.log(`IP location database updated from ${url} (built ${builtOn(downloaded)}).`);
            return;
        } catch (error) {
            failures.push(`${url}: ${(error as Error).message}`);
            await rm(temporary, { force: true });
        }
    }
    throw new Error(`Could not download the IP location database. ${failures.join('; ')}`);
};

/** Download a newer database if the current one is missing or over a month old. */
const updateIfStale = async (): Promise<void> => {
    const age = await ageOfDatabase();
    if (age !== undefined && age < MAX_AGE_MS) return;
    try {
        await download();
    } catch (error) {
        console.error(`ERROR: ${(error as Error).message} `
            + (reader ? `Still using the database built ${builtOn(reader)}.`
                : 'Until it downloads, every city and country is logged as Unknown.'));
    }
};

/**
 * Load the saved database, if there is one, then keep it up to date: check now and once a day,
 * downloading a new one when it's over a month old. Reports clearly whether it loaded.
 */
export const startGeo = async (): Promise<void> => {
    await mkdir(dirname(DB_PATH), { recursive: true });
    try {
        reader = await open(DB_PATH);
        console.log(`IP location database loaded (built ${builtOn(reader)}).`);
    } catch {
        console.log('No IP location database yet, so downloading one.');
    }
    await updateIfStale();
    setInterval(() => void updateIfStale(), DAY_MS).unref();
};

/** The approximate city and country of an IP address, or Unknown. */
export const locate = (ip: string | undefined): { city: string; country: string } => {
    let record: CityResponse | null = null;
    try {
        if (reader && ip && isIP(ip)) record = reader.get(ip);
    } catch {
        // An address the database can't read is just unknown.
    }
    return {
        city: record?.city?.names?.en ?? 'Unknown',
        country: record?.country?.names?.en ?? 'Unknown',
    };
};
