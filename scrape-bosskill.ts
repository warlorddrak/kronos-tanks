export interface WarriorTank {
    boss_name: string;
    guid: string;
    realm: string;
    name: string;
    avg_item_lvl: string;
    dmg_done: string;
    dps: string;
}

export async function getWarriorTanks(bosskillId: number | string): Promise<WarriorTank[]> {
    const bosskill = await fetch(`https://vanilla-twinhead.twinstar.cz/?boss-kill=${bosskillId}`, {
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
        referrer: "https://vanilla-twinhead.twinstar.cz/?latest=bosskills",
        method: "GET",
        mode: "cors",
    });

    const html = await bosskill.text();

    const bossMatch = html.match(/<td>Boss<\/td>\s*<td><a[^>]*\?npc=[^>]*>([^<]+)<\/a><\/td>/i)
        ?? html.match(/<a[^>]*\?npc=\d+[^>]*>([^<]+)<\/a>/i);
    const bossName = bossMatch ? bossMatch[1].trim() : "Unknown";

    const line = html.split("\n").find((l) => l.includes("var bosskillData"));
    if (!line) {
        throw new Error(`Could not find 'var bosskillData' for bosskill ${bosskillId}`);
    }

    const jsonStr = line.slice(line.indexOf("["), line.lastIndexOf("]") + 1);
    const bosskillData: any[] = JSON.parse(jsonStr);

    const totalDmgTaken = bosskillData.reduce(
        (sum: number, player: any) => sum + Number(player.dmg_taken),
        0
    );
    const avgDmgTaken = totalDmgTaken / bosskillData.length;

    // Threshold set to 2.5x the average damage taken, yielding at most 1-4 tanks
    const tankThreshold = avgDmgTaken * 2.5;

    // Filter warriors (class "1") and sort descending by dmg_taken
    const warriors = bosskillData
        .filter((player: any) => player.class === "1")
        .sort((a: any, b: any) => Number(b.dmg_taken) - Number(a.dmg_taken));

    const tanks: WarriorTank[] = [];
    for (let i = 0; i < warriors.length; i++) {
        const player = warriors[i];
        const dmg = Number(player.dmg_taken);
        if (dmg > 0 && i < 4 && (dmg >= tankThreshold || i === 0)) {
            tanks.push({
                boss_name: bossName,
                guid: player.guid,
                realm: player.realm,
                name: player.name,
                avg_item_lvl: player.avg_item_lvl,
                dmg_done: player.dmg_done,
                dps: player.dps,
            });
        }
    }

    return tanks;
}

if (import.meta.main) {
    const bosskillId = process.argv[2] ?? 944440;
    const tanks = await getWarriorTanks(bosskillId);
    console.log(tanks);
}