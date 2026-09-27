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
    fight_length?: string;
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

export function extractFightLength(html: string): string | undefined {
    const match = html.match(/<td>Fight Length<\/td>\s*<td>([^<]+)<\/td>/i);
    return match ? match[1].trim() : undefined;
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

export function parseFightLengthMs(str: string | undefined | null): number | undefined {
    if (!str) return undefined;
    const trimmed = str.trim();
    const minSecMatch = trimmed.match(/^(?:(\d+)\s*min)?\s*(?:([\d.]+)\s*sec)?$/i);
    if (minSecMatch && (minSecMatch[1] || minSecMatch[2])) {
        const mins = minSecMatch[1] ? Number(minSecMatch[1]) : 0;
        const secs = minSecMatch[2] ? Number(minSecMatch[2]) : 0;
        return Math.round((mins * 60 + secs) * 1000);
    }
    const colonMatch = trimmed.match(/^(\d+):(\d+(?:\.\d+)?)$/);
    if (colonMatch) {
        const mins = Number(colonMatch[1]);
        const secs = Number(colonMatch[2]);
        return Math.round((mins * 60 + secs) * 1000);
    }
    return undefined;
}

export async function getTanks(bosskillId: number | string): Promise<Tank[]> {
    const html = await fetchHtml(
        `https://vanilla-twinhead.twinstar.cz/?boss-kill=${bosskillId}`,
        "https://vanilla-twinhead.twinstar.cz/?latest=bosskills"
    );

    const bossMatch = html.match(/<td>Boss<\/td>\s*<td><a[^>]*\?npc=[^>]*>([^<]+)<\/a><\/td>/i)
        ?? html.match(/<a[^>]*\?npc=\d+[^>]*>([^<]+)<\/a>/i);
    const bossName = bossMatch ? bossMatch[1].trim() : "Unknown";

    const fightLength = extractFightLength(html);

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
            ...(fightLength ? { fight_length: fightLength } : {}),
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