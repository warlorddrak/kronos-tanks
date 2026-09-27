import { existsSync, readFileSync, writeFileSync } from "fs";
import { getWarriorTanks, type WarriorTank } from "./scrape-bosskill.ts";
import { fetchBosskillsList } from "./scrape-bosskills-for-day.ts";
import { render } from "./render.ts";

export interface StoredBosskill {
    id: number;
    boss_name: string;
    raid: string;
    guild: string;
    realm: string;
    time: string;
    tanks: WarriorTank[];
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
    const latestList = await fetchBosskillsList();
    console.log(`Fetched ${latestList.length} bosskills in catalog.`);

    // If we already have stored kills, only check for kills strictly newer than our highest recorded ID
    let newKillsToScrape = existingKills.length > 0
        ? latestList.filter((k) => k.id > maxExistingId && !existingIds.has(k.id))
        : latestList.slice(0, maxInitial);

    if (newKillsToScrape.length === 0) {
        console.log("No new bosskills found. Repository is up to date.");
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

            let tanks: WarriorTank[] = [];
            let errorMsg: string | undefined;

            try {
                tanks = await getWarriorTanks(kill.id);
            } catch (err: any) {
                errorMsg = err?.message ?? String(err);
            }

            newlyScraped[idx] = {
                id: kill.id,
                boss_name: kill.bossname,
                raid: kill.raid,
                guild: kill.guild,
                realm: kill.realm,
                time: kill.time,
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
