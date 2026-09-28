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

export async function fetchHtml(url: string, referrer = "https://vanilla-twinhead.twinstar.cz/"): Promise<string> {
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

export function formatFightLength(msOrStr: number | string | undefined | null): string | undefined {
    if (msOrStr === undefined || msOrStr === null || msOrStr === "") return undefined;
    if (typeof msOrStr === "string") return msOrStr.trim();
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
 * Fetches the latest bosskills catalog list from Twinhead.
 */
export async function fetchBosskillsList(): Promise<BosskillListItem[]> {
    const html = await fetchHtml(
        "https://vanilla-twinhead.twinstar.cz/?latest=bosskills",
        "https://vanilla-twinhead.twinstar.cz/"
    );

    let start = html.indexOf("new Listview");
    if (start === -1) {
        start = html.indexOf("id: 'kills'");
    }
    if (start === -1) {
        start = html.indexOf('id: "kills"');
    }
    if (start === -1) {
        throw new Error(
            `Could not find bosskills Listview data on latest=bosskills page. HTML snippet: ${html.slice(0, 300)}`
        );
    }

    const arrayStart = html.indexOf("[", start);
    const arrayEnd = html.indexOf("}]", arrayStart);
    if (arrayStart === -1 || arrayEnd === -1) {
        throw new Error(`Could not find bosskills data array bounds in page (start at ${start})`);
    }

    const arrayStr = html.slice(arrayStart, arrayEnd + 2);
    return new Function("return " + arrayStr)();
}

/**
 * Fetches and extracts surviving primary tanks for a single bosskill encounter.
 */
export async function getTanks(bosskillId: number | string): Promise<Tank[]> {
    const html = await fetchHtml(
        `https://vanilla-twinhead.twinstar.cz/?boss-kill=${bosskillId}`,
        "https://vanilla-twinhead.twinstar.cz/?latest=bosskills"
    );

    const bossMatch = html.match(/<td>Boss<\/td>\s*<td><a[^>]*\?npc=[^>]*>([^<]+)<\/a><\/td>/i)
        ?? html.match(/<a[^>]*\?npc=\d+[^>]*>([^<]+)<\/a>/i);
    const bossName = bossMatch ? bossMatch[1].trim() : "Unknown";

    const line = html.split("\n").find((l) => l.includes("var bosskillData"));
    if (!line) {
        throw new Error(`Could not find 'var bosskillData' for bosskill ${bosskillId}`);
    }

    const jsonStr = line.slice(line.indexOf("["), line.lastIndexOf("]") + 1);
    const bosskillData: any[] = JSON.parse(jsonStr);

    // Extract deaths per player from chart_data
    const deathCounts = new Map<string, number>();
    const chartLine = html.split("\n").find((l) => l.includes("var chart_data"));
    if (chartLine) {
        try {
            const cJson = chartLine.slice(chartLine.indexOf("["), chartLine.lastIndexOf("]") + 1);
            const chartData = JSON.parse(cJson);
            // Series index 4 is the Deaths series on Twinhead fight timeline
            const deathsSeries = chartData[4] || [];
            for (const entry of deathsSeries) {
                if (entry && entry[2]) {
                    const deadNames = String(entry[2])
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

    // Rank all players by total mitigated damage (dmg_taken + dmg_absorbed) to identify the tank
    const allCandidates = bosskillData
        .map((player: any) => {
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
        tanks = await getTanks(kill.id);
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
    return list.filter((k) => k.time && k.time.startsWith(normalized));
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
        console.error(`Fetching latest bosskills catalog from Twinhead for ${targetDate}...`);
        const allKills = await fetchBosskillsList();
        const dayKills = allKills.filter((k) => k.time && k.time.startsWith(targetDate));
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
        const bosskillId = arg ?? 944440;
        const tanks = await getTanks(bosskillId);
        console.log(tanks);
    }
}