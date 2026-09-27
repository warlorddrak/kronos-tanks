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

export type WarriorTank = Tank;

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

    // Filter for tanks who didn't die (death counter 0), allow any class,
    // and rank by total mitigated damage (dmg_taken + dmg_absorbed)
    const survivingCandidates = bosskillData
        .filter((player: any) => {
            const deaths = deathCounts.get(String(player.name).trim().toLowerCase()) ?? 0;
            return deaths === 0;
        })
        .map((player: any) => {
            const taken = Number(player.dmg_taken) || 0;
            const absorbed = Number(player.dmg_absorbed) || 0;
            return {
                player,
                dmg_taken: taken,
                dmg_absorbed: absorbed,
                total_mitigated: taken + absorbed,
            };
        })
        .filter((c) => c.total_mitigated > 0)
        .sort((a, b) => b.total_mitigated - a.total_mitigated);

    const tanks: Tank[] = [];
    const topCandidate = survivingCandidates[0];
    if (topCandidate) {
        tanks.push({
            boss_name: bossName,
            guid: topCandidate.player.guid,
            realm: topCandidate.player.realm,
            name: topCandidate.player.name,
            class: String(topCandidate.player.class ?? ""),
            avg_item_lvl: topCandidate.player.avg_item_lvl,
            dmg_done: topCandidate.player.dmg_done,
            dmg_taken: topCandidate.player.dmg_taken,
            dmg_absorbed: topCandidate.player.dmg_absorbed ?? String(topCandidate.dmg_absorbed),
            dps: topCandidate.player.dps,
            deaths: 0,
        });
    }

    return tanks;
}

export const getWarriorTanks = getTanks;

if (import.meta.main) {
    const bosskillId = process.argv[2] ?? 944440;
    const tanks = await getTanks(bosskillId);
    console.log(tanks);
}