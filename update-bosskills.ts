import { existsSync, readFileSync, writeFileSync } from "fs";
import { getTanks, formatFightLength, type Tank } from "./scrape-bosskill.ts";
import { fetchBosskillsList } from "./scrape-bosskills-for-day.ts";
import { render } from "./render.ts";

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

export const BOSS_KILLS_FILE = "bosskills.json";

export async function updateBosskills(options: {
    filePath?: string;
    maxInitialKills?: number;
    concurrency?: number;
} = {}): Promise<{ added: number; total: number }> {
    const filePath = options.filePath ?? BOSS_KILLS_FILE;
    const maxInitial = options.maxInitialKills ?? 50;
    const concurrency = options.concurrency ?? 4;

    let existingKills: StoredBosskill[] = [];
    if (existsSync(filePath)) {
        try {
            const raw = readFileSync(filePath, "utf-8");
            existingKills = JSON.parse(raw);
        } catch (e) {
            console.error(`Warning: Failed to parse ${filePath}, starting fresh.`, e);
        }
    }

    const existingIds = new Set(existingKills.map((k) => k.id));
    const maxExistingId = existingKills.length > 0
        ? Math.max(...existingKills.map((k) => k.id))
        : 0;

    console.log(`Loaded ${existingKills.length} existing bosskills from ${filePath} (max ID: ${maxExistingId || "none"})`);

    console.log("Fetching latest bosskills catalog from Twinhead...");
    let latestList;
    try {
        latestList = await fetchBosskillsList();
    } catch (err: any) {
        console.error(`Warning: Could not fetch bosskills catalog: ${err?.message ?? err}`);
        console.log("Skipping update for this cycle; existing records remain untouched.");
        return { added: 0, total: existingKills.length };
    }
    console.log(`Fetched ${latestList.length} bosskills in catalog.`);

    const catalogMap = new Map(latestList.map((k) => [k.id, k]));
    let backfilledCount = 0;
    let cleanedCount = 0;
    for (const kill of existingKills) {
        // Cleanup redundant fight_length_ms if present
        if ("fight_length_ms" in kill) {
            delete (kill as any).fight_length_ms;
            cleanedCount++;
        }
        // Cleanup redundant fight_length on tanks if present
        for (const t of kill.tanks) {
            if ("fight_length" in t) {
                delete (t as any).fight_length;
                cleanedCount++;
            }
        }
        if (!kill.fight_length && catalogMap.has(kill.id)) {
            const catItem = catalogMap.get(kill.id)!;
            if (typeof catItem.length === "number" && catItem.length > 0) {
                kill.fight_length = formatFightLength(catItem.length);
                backfilledCount++;
            }
        }
    }
    if (backfilledCount > 0) {
        console.log(`Backfilled fight length for ${backfilledCount} existing bosskill(s).`);
    }
    if (cleanedCount > 0) {
        console.log(`Cleaned up redundant fields in existing bosskill(s).`);
    }

    // If we already have stored kills, only check for kills strictly newer than our highest recorded ID
    let newKillsToScrape = existingKills.length > 0
        ? latestList.filter((k) => k.id > maxExistingId && !existingIds.has(k.id))
        : latestList.slice(0, maxInitial);

    if (newKillsToScrape.length === 0) {
        if (backfilledCount > 0 || cleanedCount > 0) {
            writeFileSync(filePath, JSON.stringify(existingKills, null, 2) + "\n", "utf-8");
            console.log(`Saved ${existingKills.length} bosskills with updated records to ${filePath}.`);
            render(filePath, "index.html");
        } else {
            console.log("No new bosskills found. Repository is up to date.");
        }
        return { added: 0, total: existingKills.length };
    }

    console.log(`Found ${newKillsToScrape.length} new bosskill(s) to scrape.`);

    const newlyScraped: StoredBosskill[] = new Array(newKillsToScrape.length);
    let currentIndex = 0;
    let completed = 0;

    async function worker() {
        while (currentIndex < newKillsToScrape.length) {
            const idx = currentIndex++;
            const kill = newKillsToScrape[idx];

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

            newlyScraped[idx] = {
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

            completed++;
            console.log(
                `[${completed}/${newKillsToScrape.length}] Scraped #${kill.id} (${kill.bossname} - ${kill.guild || "No Guild"}): ${tanks.length} tank(s)`
            );
        }
    }

    const workers = Array.from(
        { length: Math.min(concurrency, newKillsToScrape.length) },
        () => worker()
    );
    await Promise.all(workers);

    // Merge: newly scraped + existing, sorted descending by ID
    const mergedMap = new Map<number, StoredBosskill>();
    for (const kill of newlyScraped) {
        mergedMap.set(kill.id, kill);
    }
    for (const kill of existingKills) {
        if (!mergedMap.has(kill.id)) {
            mergedMap.set(kill.id, kill);
        }
    }

    const mergedList = Array.from(mergedMap.values()).sort((a, b) => b.id - a.id);

    writeFileSync(filePath, JSON.stringify(mergedList, null, 2) + "\n", "utf-8");
    console.log(
        `Successfully saved ${mergedList.length} bosskills (${newlyScraped.length} new) to ${filePath}.`
    );

    render(filePath, "index.html");

    return { added: newlyScraped.length, total: mergedList.length };
}

if (import.meta.main) {
    await updateBosskills();
}
