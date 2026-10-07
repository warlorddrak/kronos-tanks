import { existsSync, readFileSync, writeFileSync } from "fs";
import {
    BOSS_KILLS_FILE,
    fetchBosskillsList,
    formatFightLength,
    scrapeBosskillsBatch,
    type StoredBosskill,
    type Tank,
} from "./scrape-bosskill.ts";
import { render } from "./render.ts";

export { BOSS_KILLS_FILE, type StoredBosskill, type Tank };

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
    console.log("Fetched first page of bosskills catalog.");

    const catalogMap = new Map(latestList.map((k) => [k.id, k]));
    let backfilledCount = 0;
    for (const kill of existingKills) {
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

    // If we already have stored kills, only check for kills strictly newer than our highest recorded ID
    const newKillsToScrape = existingKills.length > 0
        ? latestList.filter((k) => k.id > maxExistingId && !existingIds.has(k.id))
        : latestList.slice(0, maxInitial);

    if (newKillsToScrape.length === 0) {
        if (backfilledCount > 0) {
            writeFileSync(filePath, JSON.stringify(existingKills, null, 2) + "\n", "utf-8");
            console.log(`Saved ${existingKills.length} bosskills with updated records to ${filePath}.`);
            render(filePath, "index.html");
        } else {
            console.log("No new bosskills found. Repository is up to date.");
        }
        return { added: 0, total: existingKills.length };
    }

    console.log(`Found ${newKillsToScrape.length} new bosskill(s) to scrape.`);

    const newlyScraped = await scrapeBosskillsBatch(newKillsToScrape, {
        concurrency,
        onProgress: (completed, total, result) => {
            console.log(
                `[${completed}/${total}] Scraped #${result.id} (${result.boss_name} - ${result.guild || "No Guild"}): ${result.tanks.length} tank(s)`
            );
        },
    });

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
