import { getWarriorTanks, type WarriorTank } from "./scrape-bosskill.ts";

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

export interface DayBosskillResult {
    id: number;
    boss_name: string;
    raid: string;
    guild: string;
    realm: string;
    time: string;
    tanks: WarriorTank[];
    error?: string;
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
 * Fetches the latest bosskills list from Twinhead.
 */
export async function fetchBosskillsList(): Promise<BosskillListItem[]> {
    const res = await fetch("https://vanilla-twinhead.twinstar.cz/?latest=bosskills", {
        credentials: "include",
        headers: {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:156.0) Gecko/20100101 Firefox/156.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,de-DE;q=0.9,en;q=0.8",
            "Sec-GPC": "1",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Priority": "u=0, i",
            "Pragma": "no-cache",
            "Cache-Control": "no-cache",
        },
        referrer: "https://vanilla-twinhead.twinstar.cz/",
        method: "GET",
    });

    const html = await res.text();
    const start = html.indexOf("new Listview({template:'bosskill'");
    if (start === -1) {
        throw new Error("Could not find Listview with bosskills on latest=bosskills page");
    }

    const arrayStart = html.indexOf("[", start);
    const arrayEnd = html.indexOf("}]", arrayStart);
    if (arrayStart === -1 || arrayEnd === -1) {
        throw new Error("Could not find bosskills data array bounds in page");
    }

    const arrayStr = html.slice(arrayStart, arrayEnd + 2);
    return new Function("return " + arrayStr)();
}

/**
 * Filters the bosskills list for a given day (YYYY-MM-DD or YYYY/MM/DD).
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
 * Scrapes warrior tanks for all bosskills that occurred on a specific day.
 */
export async function scrapeBosskillsForDay(
    dateStr: string,
    options: { concurrency?: number; onProgress?: (completed: number, total: number, kill: BosskillListItem) => void } = {}
): Promise<DayBosskillResult[]> {
    const concurrency = options.concurrency ?? 4;
    const allKills = await fetchBosskillsList();
    const dayKills = await getBosskillsForDay(dateStr, allKills);

    const results: DayBosskillResult[] = new Array(dayKills.length);
    let currentIndex = 0;
    let completedCount = 0;

    async function worker() {
        while (currentIndex < dayKills.length) {
            const index = currentIndex++;
            const kill = dayKills[index];

            let tanks: WarriorTank[] = [];
            let errorMsg: string | undefined;

            try {
                tanks = await getWarriorTanks(kill.id);
            } catch (err: any) {
                errorMsg = err?.message ?? String(err);
            }

            results[index] = {
                id: kill.id,
                boss_name: kill.bossname,
                raid: kill.raid,
                guild: kill.guild,
                realm: kill.realm,
                time: kill.time,
                tanks,
                ...(errorMsg ? { error: errorMsg } : {}),
            };

            completedCount++;
            if (options.onProgress) {
                options.onProgress(completedCount, dayKills.length, kill);
            }
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, dayKills.length) }, () => worker());
    await Promise.all(workers);

    return results;
}

if (import.meta.main) {
    const argDate = process.argv[2];

    console.error("Fetching latest bosskills list from Twinhead...");
    const allKills = await fetchBosskillsList();

    // Default to the most recent kill's date if not specified
    const latestDate = allKills[0]?.time?.split(" ")[0]?.replace(/\//g, "-") ?? "2026-09-26";
    const targetDate = argDate ?? latestDate;
    const normalizedTarget = normalizeDate(targetDate);

    const dayKills = allKills.filter((k) => k.time && k.time.startsWith(normalizedTarget));
    console.error(`Found ${dayKills.length} bosskill(s) for ${normalizedTarget}.`);

    if (dayKills.length === 0) {
        console.error(`No bosskills found for date ${targetDate}.`);
        console.log(JSON.stringify([], null, 2));
        process.exit(0);
    }

    console.error(`Scraping warrior tanks for ${dayKills.length} bosskills (concurrency: 4)...`);
    const results = await scrapeBosskillsForDay(targetDate, {
        concurrency: 4,
        onProgress: (done, total, kill) => {
            console.error(`[${done}/${total}] Scraped #${kill.id} (${kill.bossname} - ${kill.guild || "No Guild"})`);
        },
    });

    console.log(JSON.stringify(results, null, 2));
}
