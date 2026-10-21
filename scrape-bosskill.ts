export interface Tank {
    boss_name: string;
    guid: string;
    realm: string;
    name: string;
    class: string;
    avg_item_lvl: string;
    dmg_done: string;
    dmg_taken: string;
    dmg_absorbed: string;
    dps: string;
    deaths?: number;
}

export interface StoredBosskill {
    id: number;
    boss_name: string;
    raid: string;
    guild: string;
    realm: string;
    time: string;
    fight_length?: string;
    tanks: Tank[];
    error?: string;
}

export type DayBosskillResult = StoredBosskill;

export interface BosskillListItem {
    id: number;
    entry: number;
    bossname: string;
    raid: string;
    guildrealm: string;
    map: string;
    realm: string;
    realmid: string;
    mode: number;
    guild: string;
    hasDetail: number;
    time: string;
    length: number;
}

export const BOSS_KILLS_FILE = "bosskills.json";
export const BASE_URL = "https://bosskills.twinstar-wow.com";
export const DEFAULT_REALM = "KronosV";
export const DEFAULT_REALM_ID = "26";
export const DEFAULT_PAGES_TO_SCAN = 11; // page 0 to 10 inclusive
export const IGNORED_RAIDS = new Set(["blackrock spire"]);

const CLASS_NAME_TO_ID: Record<string, string> = {
    warrior: "1",
    paladin: "2",
    hunter: "3",
    rogue: "4",
    priest: "5",
    "death knight": "6",
    deathknight: "6",
    shaman: "7",
    mage: "8",
    warlock: "9",
    druid: "11",
};

export function decodeHtmlEntities(str: string): string {
    if (!str) return "";
    return str
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

function stripTags(html: string): string {
    return decodeHtmlEntities(html.replace(/<[^>]*>/g, "")).trim();
}

export function isIgnoredRaid(raid: string | undefined | null): boolean {
    if (!raid) return false;
    const cleaned = decodeHtmlEntities(raid)
        .replace(/\s*\(\d+\)\s*$/, "")
        .trim()
        .toLowerCase();
    return IGNORED_RAIDS.has(cleaned);
}

export async function fetchHtml(url: string, referrer = `${BASE_URL}/`): Promise<string> {
    const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": referrer,
        "Upgrade-Insecure-Requests": "1",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
    };

    let html = "";
    let status = 0;

    // 1. Attempt standard fetch
    try {
        const res = await fetch(url, { headers, method: "GET" });
        status = res.status;
        if (res.ok) {
            html = await res.text();
            if (!html.includes("<title>Just a moment...</title>") && !html.includes("cf-mitigated")) {
                return html;
            }
        }
    } catch (_) {}

    // 2. Fallback to curl with browser headers (handles Cloudflare when fetch gets challenged)
    try {
        const proc = Bun.spawn([
            "curl",
            "-sL",
            "--compressed",
            "--max-time", "20",
            "-H", `User-Agent: ${headers["User-Agent"]}`,
            "-H", `Accept: ${headers["Accept"]}`,
            "-H", `Accept-Language: ${headers["Accept-Language"]}`,
            "-H", `Referer: ${referrer}`,
            url,
        ]);
        html = await new Response(proc.stdout).text();
        if (html && !html.includes("<title>Just a moment...</title>")) {
            return html;
        }
    } catch (_) {}

    if (html.includes("<title>Just a moment...</title>")) {
        throw new Error(`Cloudflare bot challenge blocked request to ${url}`);
    }
    if (!html) {
        throw new Error(`Failed to fetch HTML from ${url} (HTTP ${status || "unknown"})`);
    }
    return html;
}

export function parseDurationToMs(durStr: string): number {
    if (!durStr) return 0;
    const trimmed = durStr.trim();
    const colonParts = trimmed.split(":").map(Number);
    if (colonParts.length >= 2 && !colonParts.some(isNaN)) {
        if (colonParts.length === 2) {
            return (colonParts[0] * 60 + colonParts[1]) * 1000;
        }
        if (colonParts.length === 3) {
            return (colonParts[0] * 3600 + colonParts[1] * 60 + colonParts[2]) * 1000;
        }
    }
    const minMatch = trimmed.match(/(\d+)\s*min/i);
    const secMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*sec/i);
    if (minMatch || secMatch) {
        const mins = minMatch ? Number(minMatch[1]) : 0;
        const secs = secMatch ? Number(secMatch[1]) : 0;
        return Math.round((mins * 60 + secs) * 1000);
    }
    return 0;
}

export function formatFightLength(msOrStr: number | string | undefined | null): string | undefined {
    if (msOrStr === undefined || msOrStr === null || msOrStr === "") return undefined;
    if (typeof msOrStr === "string") {
        const parsedMs = parseDurationToMs(msOrStr);
        if (parsedMs > 0) {
            return formatFightLength(parsedMs);
        }
        return msOrStr.trim();
    }
    const ms = Number(msOrStr);
    if (isNaN(ms) || ms <= 0) return undefined;
    const totalSec = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    if (minutes > 0) {
        return `${minutes}min ${seconds}sec`;
    }
    const secWithDec = (ms / 1000).toFixed(1);
    return secWithDec.endsWith(".0") ? `${Math.round(ms / 1000)}sec` : `${secWithDec}sec`;
}

/**
 * Normalizes user-provided date strings (e.g. "2026-09-26" or "2026/9/26")
 * into "YYYY/MM/DD" format used by Twinhead timestamps.
 */
export function normalizeDate(dateStr: string): string {
    const parts = dateStr.replace(/-/g, "/").split("/");
    if (parts.length === 3) {
        const year = parts[0].padStart(4, "0");
        const month = parts[1].padStart(2, "0");
        const day = parts[2].padStart(2, "0");
        return `${year}/${month}/${day}`;
    }
    return dateStr;
}

/**
 * Parses a single bosskills list HTML page into BosskillListItem records.
 * Returns both raw row count (before raid filtering) and filtered items.
 */
export function parseBosskillsListPage(
    html: string,
    defaultRealm = DEFAULT_REALM
): { rawRowCount: number; items: BosskillListItem[] } {
    const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    if (!tbodyMatch) {
        if (!html.includes("kills-table") && !html.includes("Latest kills")) {
            throw new Error(
                `Could not find bosskills table on page. HTML snippet: ${html.slice(0, 300)}`
            );
        }
        return { rawRowCount: 0, items: [] };
    }

    const tbody = tbodyMatch[1];
    const items: BosskillListItem[] = [];
    let rawRowCount = 0;

    for (const rowMatch of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const rowHtml = rowMatch[1];
        const tds = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
        if (tds.length < 7) continue;

        rawRowCount++;

        const bossname = stripTags(tds[0]);
        const entryMatch = tds[0].match(/\/boss\/(\d+)/i);
        const entry = entryMatch ? Number(entryMatch[1]) : 0;

        const raid = stripTags(tds[1]).replace(/\s*\(\d+\)\s*$/, "").trim();
        if (isIgnoredRaid(raid)) {
            continue;
        }

        const mode = Number(stripTags(tds[2])) || 0;
        const guild = stripTags(tds[3]);
        const length = parseDurationToMs(stripTags(tds[4]));
        const timeRaw = stripTags(tds[5]);
        const time = timeRaw.replace(/-/g, "/");

        const detailMatch = tds[6].match(/href="\/([^/]+)\/boss-kills\/(?:(\d+)_)?(\d+)"/i)
            ?? tds[6].match(/boss-kill=(\d+)/i);
        if (!detailMatch) continue;

        let realm = defaultRealm;
        let realmid = DEFAULT_REALM_ID;
        let id = 0;

        if (detailMatch.length >= 4) {
            realm = decodeHtmlEntities(detailMatch[1]) || defaultRealm;
            realmid = detailMatch[2] || DEFAULT_REALM_ID;
            id = Number(detailMatch[3]);
        } else {
            id = Number(detailMatch[1]);
        }

        if (!id || isNaN(id)) continue;

        items.push({
            id,
            entry,
            bossname,
            raid,
            guildrealm: realm,
            map: raid,
            realm,
            realmid,
            mode,
            guild,
            hasDetail: 1,
            time,
            length,
        });
    }

    return { rawRowCount, items };
}

/**
 * Fetches the latest bosskills catalog list from bosskills.twinstar-wow.com.
 * Scans at least pages 0 to 10 (11 pages) by default and filters out ignored raids (e.g. Blackrock Spire).
 */
export async function fetchBosskillsList(
    options: { startPage?: number; endPage?: number; realm?: string; concurrency?: number } = {}
): Promise<BosskillListItem[]> {
    const startPage = options.startPage ?? 0;
    const endPage = options.endPage ?? (DEFAULT_PAGES_TO_SCAN - 1);
    const realm = options.realm ?? DEFAULT_REALM;
    const concurrency = options.concurrency ?? 4;

    const pages: number[] = [];
    for (let p = startPage; p <= endPage; p++) {
        pages.push(p);
    }

    const pageResults = new Array<BosskillListItem[]>(pages.length);
    let currentIndex = 0;

    async function worker() {
        while (currentIndex < pages.length) {
            const idx = currentIndex++;
            const page = pages[idx];
            const url = `${BASE_URL}/${realm}/boss-kills?page=${page}`;
            const referrer = page === startPage
                ? `${BASE_URL}/${realm}/boss-kills`
                : `${BASE_URL}/${realm}/boss-kills?page=${page - 1}`;

            const html = await fetchHtml(url, referrer);
            const { items } = parseBosskillsListPage(html, realm);
            pageResults[idx] = items;
        }
    }

    const workers = Array.from(
        { length: Math.min(concurrency, pages.length) },
        () => worker()
    );
    await Promise.all(workers);

    const allItems: BosskillListItem[] = [];
    const seenIds = new Set<number>();
    for (const items of pageResults) {
        if (!items) continue;
        for (const item of items) {
            if (!seenIds.has(item.id)) {
                seenIds.add(item.id);
                allItems.push(item);
            }
        }
    }

    return allItems;
}

/**
 * Fetches and extracts surviving primary tanks for a single bosskill encounter.
 */
export async function getTanks(
    bosskillId: number | string,
    realm = DEFAULT_REALM,
    realmId = DEFAULT_REALM_ID
): Promise<Tank[]> {
    const rawId = String(bosskillId).trim();
    const slug = rawId.includes("_") ? rawId : `${realmId}_${rawId}`;
    const html = await fetchHtml(
        `${BASE_URL}/${realm}/boss-kills/${slug}`,
        `${BASE_URL}/${realm}/boss-kills?page=0`
    );

    // Check raid and filter out ignored raids (e.g. Blackrock Spire)
    const raidMatch = html.match(/<dt[^>]*>\s*Raid\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i);
    if (raidMatch) {
        const raidName = stripTags(raidMatch[1]);
        if (isIgnoredRaid(raidName)) {
            return [];
        }
    }

    const bossMatch = html.match(/<dt[^>]*>\s*Boss\s*<\/dt>\s*<dd[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i)
        ?? html.match(/<title>([^<]+?)\s+kill\s+-/i)
        ?? html.match(/<td>Boss<\/td>\s*<td><a[^>]*\?npc=[^>]*>([^<]+)<\/a><\/td>/i);
    const bossName = bossMatch ? decodeHtmlEntities(bossMatch[1]).trim() : "Unknown";

    const realmMatch = html.match(/<dt[^>]*>\s*Realm\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i);
    const defaultRealm = realmMatch ? stripTags(realmMatch[1]) || realm : realm;

    // Extract deaths per player from <bk-chart data-config="..."> (or legacy var chart_data)
    const deathCounts = new Map<string, number>();
    const chartAttrMatch = html.match(/<bk-chart[^>]*data-config="([^"]+)"/i);
    if (chartAttrMatch) {
        try {
            const decodedJson = decodeHtmlEntities(chartAttrMatch[1]);
            const chartConfig = JSON.parse(decodedJson);
            const series = Array.isArray(chartConfig?.series) ? chartConfig.series : [];
            const deathsSeries = series.find((s: any) => s?.name === "Deaths") ?? series[4];
            const deathsData = Array.isArray(deathsSeries?.data) ? deathsSeries.data : [];
            for (const entry of deathsData) {
                const rawName = typeof entry === "object" && entry !== null
                    ? (entry.name ?? entry[2])
                    : undefined;
                if (rawName) {
                    const deadNames = String(rawName)
                        .split(",")
                        .map((s) => s.trim().toLowerCase())
                        .filter(Boolean);
                    for (const deadName of deadNames) {
                        deathCounts.set(deadName, (deathCounts.get(deadName) ?? 0) + 1);
                    }
                }
            }
        } catch (_) {}
    }

    // Parse participant stats from #stats-table
    const statsSectionMatch = html.match(/<div id="stats-table">([\s\S]*?)<\/table>/i);
    if (!statsSectionMatch) {
        throw new Error(`Could not find '#stats-table' for bosskill ${bosskillId}`);
    }

    const tableHtml = statsSectionMatch[1];
    const tbodyMatch = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    if (!tbodyMatch) {
        throw new Error(`Could not find stats tbody for bosskill ${bosskillId}`);
    }

    // Determine column indices from thead (with standard fallback indices)
    let colName = 0;
    let colClass = 2;
    let colDps = 3;
    let colDmgDone = 4;
    let colDmgTaken = 5;
    let colDmgAbsorb = 6;
    let colIlvl = 13;

    const theadMatch = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
    if (theadMatch) {
        const ths = [...theadMatch[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) =>
            stripTags(m[1]).toLowerCase()
        );
        ths.forEach((h, idx) => {
            if (h.startsWith("name")) colName = idx;
            else if (h.startsWith("class")) colClass = idx;
            else if (h.startsWith("dps")) colDps = idx;
            else if (h.startsWith("dmg done") || h.startsWith("damage done")) colDmgDone = idx;
            else if (h.startsWith("dmg taken") || h.startsWith("damage taken")) colDmgTaken = idx;
            else if (h.startsWith("dmg absorb") || h.startsWith("damage absorb")) colDmgAbsorb = idx;
            else if (h.startsWith("ilvl") || h.startsWith("item level")) colIlvl = idx;
        });
    }

    const bosskillData: Array<{
        guid: string;
        realm: string;
        name: string;
        class: string;
        avg_item_lvl: string;
        dmg_done: string;
        dmg_taken: string;
        dmg_absorbed: string;
        dps: string;
    }> = [];

    const cleanNumberStr = (val: string | undefined): string => {
        if (!val) return "0";
        const cleaned = stripTags(val).replace(/,/g, "").trim();
        return cleaned || "0";
    };

    for (const rowMatch of tbodyMatch[1].matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/gi)) {
        const trAttrs = rowMatch[1] ?? "";
        const rowHtml = rowMatch[2];
        const tds = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
        if (tds.length <= Math.max(colName, colClass, colDps, colDmgDone, colDmgTaken, colDmgAbsorb)) {
            continue;
        }

        const nameCell = tds[colName] ?? "";
        const name = stripTags(nameCell);
        if (!name) continue;

        const charRealmMatch = nameCell.match(/href="\/([^/]+)\/character\//i);
        const playerRealm = charRealmMatch ? decodeHtmlEntities(charRealmMatch[1]) : defaultRealm;

        const classCell = tds[colClass] ?? "";
        const classIdMatch = classCell.match(/type=class(?:&amp;|&)id=(\d+)/i);
        const classLabelMatch = classCell.match(/data-label="([^"]+)"/i);
        let playerClass = classIdMatch ? classIdMatch[1] : "";
        if (!playerClass && classLabelMatch) {
            const label = decodeHtmlEntities(classLabelMatch[1]).trim().toLowerCase();
            playerClass = CLASS_NAME_TO_ID[label] ?? classLabelMatch[1];
        }

        const dps = cleanNumberStr(tds[colDps]);
        const dmg_done = cleanNumberStr(tds[colDmgDone]);
        const dmg_taken = cleanNumberStr(tds[colDmgTaken]);
        const dmg_absorbed = cleanNumberStr(tds[colDmgAbsorb]);
        const avg_item_lvl = cleanNumberStr(tds[colIlvl] ?? tds[tds.length - 1]);

        // Rows with text-red indicate player death in the encounter
        if (/text-red/i.test(trAttrs)) {
            const nameKey = name.toLowerCase();
            if (!deathCounts.has(nameKey)) {
                deathCounts.set(nameKey, 1);
            }
        }

        bosskillData.push({
            guid: "",
            realm: playerRealm,
            name,
            class: playerClass,
            avg_item_lvl,
            dmg_done,
            dmg_taken,
            dmg_absorbed,
            dps,
        });
    }

    // Rank all players by total mitigated damage (dmg_taken + dmg_absorbed) to identify the tank
    const allCandidates = bosskillData
        .map((player) => {
            const taken = Number(player.dmg_taken) || 0;
            const absorbed = Number(player.dmg_absorbed) || 0;
            const deaths = deathCounts.get(String(player.name).trim().toLowerCase()) ?? 0;
            return {
                player,
                dmg_taken: taken,
                dmg_absorbed: absorbed,
                total_mitigated: taken + absorbed,
                deaths,
            };
        })
        .filter((c) => c.total_mitigated > 0)
        .sort((a, b) => b.total_mitigated - a.total_mitigated);

    const tanks: Tank[] = [];
    const primaryTank = allCandidates[0];

    // If the primary tank (highest dmg_taken + dmg_absorbed) died, no tank is recorded for that fight.
    // Only record if the tank survived without dying (death counter 0).
    if (primaryTank && primaryTank.deaths === 0) {
        tanks.push({
            boss_name: bossName,
            guid: primaryTank.player.guid,
            realm: primaryTank.player.realm,
            name: primaryTank.player.name,
            class: String(primaryTank.player.class ?? ""),
            avg_item_lvl: primaryTank.player.avg_item_lvl,
            dmg_done: primaryTank.player.dmg_done,
            dmg_taken: primaryTank.player.dmg_taken,
            dmg_absorbed: primaryTank.player.dmg_absorbed ?? String(primaryTank.dmg_absorbed),
            dps: primaryTank.player.dps,
            deaths: 0,
        });
    }

    return tanks;
}

/**
 * Scrapes a single catalog item into a StoredBosskill record.
 */
export async function scrapeBosskillItem(kill: BosskillListItem): Promise<StoredBosskill> {
    let tanks: Tank[] = [];
    let errorMsg: string | undefined;

    try {
        const slug = kill.realmid ? `${kill.realmid}_${kill.id}` : kill.id;
        tanks = await getTanks(slug, kill.realm || DEFAULT_REALM, kill.realmid || DEFAULT_REALM_ID);
    } catch (err: any) {
        errorMsg = err?.message ?? String(err);
    }

    const fightLength = typeof kill.length === "number" && kill.length > 0
        ? formatFightLength(kill.length)
        : undefined;

    return {
        id: kill.id,
        boss_name: kill.bossname,
        raid: kill.raid,
        guild: kill.guild,
        realm: kill.realm,
        time: kill.time,
        ...(fightLength ? { fight_length: fightLength } : {}),
        tanks,
        ...(errorMsg ? { error: errorMsg } : {}),
    };
}

/**
 * Concurrently scrapes a list of BosskillListItems using a worker pool.
 */
export async function scrapeBosskillsBatch(
    kills: BosskillListItem[],
    options: {
        concurrency?: number;
        onProgress?: (completed: number, total: number, result: StoredBosskill) => void;
    } = {}
): Promise<StoredBosskill[]> {
    const concurrency = options.concurrency ?? 4;
    const results: StoredBosskill[] = new Array(kills.length);
    let currentIndex = 0;
    let completed = 0;

    async function worker() {
        while (currentIndex < kills.length) {
            const idx = currentIndex++;
            const kill = kills[idx];
            const result = await scrapeBosskillItem(kill);
            results[idx] = result;
            completed++;
            if (options.onProgress) {
                options.onProgress(completed, kills.length, result);
            }
        }
    }

    const workers = Array.from(
        { length: Math.min(concurrency, kills.length) },
        () => worker()
    );
    await Promise.all(workers);
    return results;
}

/**
 * Filters the bosskills catalog list for a given day (YYYY-MM-DD or YYYY/MM/DD).
 */
export async function getBosskillsForDay(
    dateStr: string,
    allKills?: BosskillListItem[]
): Promise<BosskillListItem[]> {
    const list = allKills ?? (await fetchBosskillsList());
    const normalized = normalizeDate(dateStr);
    return list.filter(
        (k) => !isIgnoredRaid(k.raid) && k.time && normalizeDate(k.time.split(" ")[0]) === normalized
    );
}

/**
 * Scrapes bosskills and surviving tanks for a given day.
 */
export async function scrapeBosskillsForDay(
    dateStr: string,
    options: {
        concurrency?: number;
        onProgress?: (completed: number, total: number, result: StoredBosskill) => void;
    } = {}
): Promise<StoredBosskill[]> {
    const dayKills = await getBosskillsForDay(dateStr);
    return scrapeBosskillsBatch(dayKills, options);
}

if (import.meta.main) {
    const arg = process.argv[2];
    const isDate = arg && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(arg);

    if (isDate) {
        const targetDate = normalizeDate(arg);
        console.error(`Fetching latest bosskills catalog for ${targetDate}...`);
        const dayKills = await getBosskillsForDay(targetDate);
        console.error(`Found ${dayKills.length} bosskill(s) for ${targetDate}.`);

        if (dayKills.length === 0) {
            console.log(JSON.stringify([], null, 2));
            process.exit(0);
        }

        console.error(`Scraping tanks for ${dayKills.length} bosskills (concurrency: 4)...`);
        const results = await scrapeBosskillsBatch(dayKills, {
            concurrency: 4,
            onProgress: (done, total, res) => {
                console.error(`[${done}/${total}] Scraped #${res.id} (${res.boss_name} - ${res.guild || "No Guild"})`);
            },
        });
        console.log(JSON.stringify(results, null, 2));
    } else {
        const bosskillId = arg ?? "26_945819";
        const tanks = await getTanks(bosskillId);
        console.log(tanks);
    }
}