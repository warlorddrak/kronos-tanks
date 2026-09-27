export interface WarriorTank {
    boss_name: string;
    guid: string;
    realm: string;
    name: string;
    avg_item_lvl: string;
    dmg_done: string;
    dps: string;
}

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

export async function getWarriorTanks(bosskillId: number | string): Promise<WarriorTank[]> {
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

    // Identify the primary warrior tank (highest dmg_taken among warriors)
    const warriors = bosskillData
        .filter((player: any) => player.class === "1")
        .sort((a: any, b: any) => Number(b.dmg_taken) - Number(a.dmg_taken));

    const tanks: WarriorTank[] = [];
    const topWarrior = warriors[0];
    if (topWarrior && Number(topWarrior.dmg_taken) > 0) {
        tanks.push({
            boss_name: bossName,
            guid: topWarrior.guid,
            realm: topWarrior.realm,
            name: topWarrior.name,
            avg_item_lvl: topWarrior.avg_item_lvl,
            dmg_done: topWarrior.dmg_done,
            dps: topWarrior.dps,
        });
    }

    return tanks;
}

if (import.meta.main) {
    const bosskillId = process.argv[2] ?? 944440;
    const tanks = await getWarriorTanks(bosskillId);
    console.log(tanks);
}