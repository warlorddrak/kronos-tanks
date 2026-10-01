import { existsSync, readFileSync, writeFileSync } from "fs";
import { BOSS_KILLS_FILE, type StoredBosskill } from "./scrape-bosskill.ts";

export interface Top50Placement {
    boss_name: string;
    rank: number;
    points: number;
    dps: string;
    bosskill_id: number;
    time?: string;
}

export interface Top50Tank {
    name: string;
    realm: string;
    class?: string;
    guild?: string;
    totalPoints: number;
    placements: Top50Placement[];
    topDps: number;
    avgItemLvl?: number;
    rank1Count: number;
    rank2Count: number;
    rank3Count: number;
    bestRank: number;
}

function escapeHtml(str: string | number | undefined | null): string {
    if (str == null) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatDps(dps: string | number): string {
    const n = Number(dps);
    return isNaN(n) ? "0.0" : n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatDmg(dmg: string | number): string {
    const n = Number(dmg);
    return isNaN(n) ? "0" : n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatIlvl(ilvl: string | number): string {
    const n = Number(ilvl);
    return isNaN(n) ? "0.0" : n.toFixed(1);
}

export const WOW_CLASS_COLORS: Record<string, string> = {
    "1": "#C79C6E", // Warrior
    "2": "#F58CBA", // Paladin
    "3": "#ABD473", // Hunter
    "4": "#FFF569", // Rogue
    "5": "#FFFFFF", // Priest
    "6": "#C41E3A", // Death Knight
    "7": "#0070DE", // Shaman
    "8": "#40C7EB", // Mage
    "9": "#9482C9", // Warlock
    "11": "#FF7D0A", // Druid
};

export const WOW_CLASS_NAMES: Record<string, string> = {
    "1": "Warrior",
    "2": "Paladin",
    "3": "Hunter",
    "4": "Rogue",
    "5": "Priest",
    "6": "Death Knight",
    "7": "Shaman",
    "8": "Mage",
    "9": "Warlock",
    "11": "Druid",
};

export function getClassColor(classIdOrName?: string | number): string {
    if (!classIdOrName) return "#cbd5e1";
    const key = String(classIdOrName).trim().toLowerCase();
    if (WOW_CLASS_COLORS[key]) return WOW_CLASS_COLORS[key];
    const nameMap: Record<string, string> = {
        warrior: "#C79C6E",
        paladin: "#F58CBA",
        hunter: "#ABD473",
        rogue: "#FFF569",
        priest: "#FFFFFF",
        "death knight": "#C41E3A",
        deathknight: "#C41E3A",
        shaman: "#0070DE",
        mage: "#40C7EB",
        warlock: "#9482C9",
        druid: "#FF7D0A",
    };
    return nameMap[key] || "#cbd5e1";
}

export function getClassName(classIdOrName?: string | number): string {
    if (!classIdOrName) return "Unknown";
    const key = String(classIdOrName).trim().toLowerCase();
    if (WOW_CLASS_NAMES[key]) return WOW_CLASS_NAMES[key];
    return String(classIdOrName);
}

export function formatInlineMarkdown(text: string): string {
    let result = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    result = result.replace(/`([^`]+)`/g, "<code>$1</code>");

    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
        const safeUrl = url.trim().replace(/"/g, "&quot;");
        if (/^(https?:\/\/|mailto:|\/|#)/i.test(safeUrl)) {
            return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
        }
        return linkText;
    });

    result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    result = result.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    result = result.replace(/(^|[^\*])\*([^*\s][^*]*[^*\s]|[^*\s])\*(?!\*)/g, "$1<em>$2</em>");
    result = result.replace(/(^|[^_])_([^_\s][^_]*[^_\s]|[^_\s])_(?!_)/g, "$1<em>$2</em>");

    return result;
}

export function renderMarkdown(markdown: string): string {
    if (!markdown) return "";
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const htmlBlocks: string[] = [];
    let currentParagraph: string[] = [];
    let currentList: { type: "ul" | "ol"; items: string[] } | null = null;

    const flushParagraph = () => {
        if (currentParagraph.length > 0) {
            const text = currentParagraph.join(" ").trim();
            if (text) {
                htmlBlocks.push(`<p>${formatInlineMarkdown(text)}</p>`);
            }
            currentParagraph = [];
        }
    };

    const flushList = () => {
        if (currentList) {
            const tag = currentList.type;
            const itemsHtml = currentList.items
                .map((item) => `<li>${formatInlineMarkdown(item)}</li>`)
                .join("");
            htmlBlocks.push(`<${tag}>${itemsHtml}</${tag}>`);
            currentList = null;
        }
    };

    const flushAll = () => {
        flushParagraph();
        flushList();
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed) {
            flushAll();
            continue;
        }

        const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            flushAll();
            const level = headingMatch[1].length;
            const content = formatInlineMarkdown(headingMatch[2].trim());
            htmlBlocks.push(`<h${level}>${content}</h${level}>`);
            continue;
        }

        const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
        if (olMatch) {
            flushParagraph();
            if (!currentList || currentList.type !== "ol") {
                flushList();
                currentList = { type: "ol", items: [] };
            }
            currentList.items.push(olMatch[1]);
            continue;
        }

        const ulMatch = trimmed.match(/^[-*+]\s+(.*)$/);
        if (ulMatch) {
            flushParagraph();
            if (!currentList || currentList.type !== "ul") {
                flushList();
                currentList = { type: "ul", items: [] };
            }
            currentList.items.push(ulMatch[1]);
            continue;
        }

        const bqMatch = trimmed.match(/^>\s*(.*)$/);
        if (bqMatch) {
            flushAll();
            htmlBlocks.push(`<blockquote>${formatInlineMarkdown(bqMatch[1])}</blockquote>`);
            continue;
        }

        if (currentList) {
            flushList();
        }
        currentParagraph.push(trimmed);
    }

    flushAll();
    return htmlBlocks.join("\n");
}

export function loadFaqHtml(faqPath = "faq.md"): string {
    let resolvedPath = faqPath;
    if (!existsSync(resolvedPath)) {
        try {
            const scriptDir = new URL(".", import.meta.url).pathname;
            const fallbackPath = `${scriptDir}/${faqPath}`.replace(/\/+/g, "/");
            if (existsSync(fallbackPath)) {
                resolvedPath = fallbackPath;
            }
        } catch {
            // ignore
        }
    }

    if (existsSync(resolvedPath)) {
        try {
            const content = readFileSync(resolvedPath, "utf-8");
            return renderMarkdown(content);
        } catch (err) {
            console.warn(`Warning: Could not read FAQ file at ${resolvedPath}:`, err);
        }
    }
    return "";
}

export function generateHtml(
    bosskills: StoredBosskill[],
    options: { server?: string; faqFile?: string; faqHtml?: string } = {}
): string {
    const generatedAt = new Date().toISOString().replace("T", " ").replace(/\..+/, " UTC");

    const faqHtml = options.faqHtml !== undefined
        ? options.faqHtml
        : loadFaqHtml(options.faqFile ?? "faq.md");

    // All available servers in the dataset
    const allServers = Array.from(new Set(bosskills.map((k) => k.realm))).filter(Boolean).sort();

    // Server filtering
    const serverFilter = options.server && options.server.toLowerCase() !== "all"
        ? options.server
        : undefined;

    const filteredKills = serverFilter
        ? bosskills.filter((k) => k.realm.toLowerCase() === serverFilter.toLowerCase())
        : bosskills;

    // 1. Process each bosskill: sort tanks by DPS descending (takes the top tanks, up to 10)
    const processedKills = filteredKills.map((k) => {
        const sortedTanks = [...k.tanks]
            .sort((a, b) => Number(b.dps) - Number(a.dps))
            .slice(0, 10);
        return {
            ...k,
            topTanks: sortedTanks,
        };
    });

    // 2. Compute Top 10 Tanks per Boss (Leaderboard) across all recorded fights
    const bossMap = new Map<string, Array<{
        name: string;
        guid: string;
        realm: string;
        class?: string;
        dps: string;
        dmg_done: string;
        dmg_taken: string;
        dmg_absorbed?: string;
        avg_item_lvl: string;
        boss_name: string;
        bosskill_id: number;
        raid: string;
        guild: string;
        time: string;
        fight_length?: string;
    }>>();

    for (const k of processedKills) {
        if (!bossMap.has(k.boss_name)) {
            bossMap.set(k.boss_name, []);
        }
        for (const t of k.topTanks) {
            bossMap.get(k.boss_name)!.push({
                ...t,
                bosskill_id: k.id,
                raid: k.raid,
                guild: k.guild,
                time: k.time,
                fight_length: k.fight_length,
            });
        }
    }

    // Sort each boss leaderboard by DPS descending and take top 10 unique tanks
    const bossLeaderboards: Array<{ boss_name: string; tanks: any[] }> = [];
    for (const [boss_name, tanks] of bossMap.entries()) {
        tanks.sort((a, b) => Number(b.dps) - Number(a.dps));
        const uniqueTanks: typeof tanks = [];
        const seen = new Set<string>();
        for (const t of tanks) {
            const tankKey = `${t.name.toLowerCase()}@${t.realm.toLowerCase()}`;
            if (!seen.has(tankKey)) {
                seen.add(tankKey);
                uniqueTanks.push(t);
            }
        }
        bossLeaderboards.push({
            boss_name,
            tanks: uniqueTanks.slice(0, 10),
        });
    }
    bossLeaderboards.sort((a, b) => a.boss_name.localeCompare(b.boss_name));

    // 3. Compute Top 50 Leaderboard based on points from Top 10 by Boss lists
    // Rank #1 grants 10 points, Rank #2 grants 9 points, ..., Rank #10 grants 1 point.
    const tankScoreMap = new Map<string, Top50Tank>();

    for (const b of bossLeaderboards) {
        b.tanks.forEach((tank, idx) => {
            const rank = idx + 1; // 1 to 10
            const points = 11 - rank; // 10 down to 1
            const key = `${tank.name.toLowerCase()}@${tank.realm.toLowerCase()}`;

            if (!tankScoreMap.has(key)) {
                tankScoreMap.set(key, {
                    name: tank.name,
                    realm: tank.realm,
                    class: tank.class,
                    guild: tank.guild,
                    totalPoints: 0,
                    placements: [],
                    topDps: 0,
                    rank1Count: 0,
                    rank2Count: 0,
                    rank3Count: 0,
                    bestRank: 999,
                });
            }

            const entry = tankScoreMap.get(key)!;
            entry.totalPoints += points;
            entry.placements.push({
                boss_name: b.boss_name,
                rank,
                points,
                dps: tank.dps,
                bosskill_id: tank.bosskill_id,
                time: tank.time,
            });

            if (rank === 1) entry.rank1Count++;
            if (rank === 2) entry.rank2Count++;
            if (rank === 3) entry.rank3Count++;
            if (rank < entry.bestRank) entry.bestRank = rank;

            const dpsNum = Number(tank.dps) || 0;
            if (dpsNum > entry.topDps) entry.topDps = dpsNum;

            const ilvlNum = Number(tank.avg_item_lvl) || 0;
            if (ilvlNum > (entry.avgItemLvl || 0)) entry.avgItemLvl = ilvlNum;

            if (tank.guild && (!entry.guild || entry.guild === "No Guild")) {
                entry.guild = tank.guild;
            }
        });
    }

    // Sort placements for each tank by rank ascending, then boss name
    for (const entry of tankScoreMap.values()) {
        entry.placements.sort((a, b) => a.rank - b.rank || a.boss_name.localeCompare(b.boss_name));
    }

    const top50Leaderboard: Top50Tank[] = Array.from(tankScoreMap.values())
        .sort((a, b) => {
            if (b.totalPoints !== a.totalPoints) {
                return b.totalPoints - a.totalPoints;
            }
            // Tie-breaker 1: most #1 ranks, then #2 ranks, etc.
            for (let r = 1; r <= 10; r++) {
                const countA = a.placements.filter((p) => p.rank === r).length;
                const countB = b.placements.filter((p) => p.rank === r).length;
                if (countB !== countA) {
                    return countB - countA;
                }
            }
            // Tie-breaker 2: highest peak DPS recorded
            if (b.topDps !== a.topDps) {
                return b.topDps - a.topDps;
            }
            // Tie-breaker 3: alphabetical
            return a.name.localeCompare(b.name);
        })
        .slice(0, 50);


    const uniqueBosses = Array.from(bossMap.keys()).sort();
    const activeServerLabel = serverFilter ?? "All Servers";

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kronos Tank Logs - ${escapeHtml(activeServerLabel)}</title>
    <meta name="description" content="Top tanks ranked by DPS per bosskill on ${escapeHtml(activeServerLabel)}">
    <style>
        :root {
            --bg-base: #090d16;
            --bg-card: #131b2e;
            --bg-card-hover: #1a243d;
            --bg-subtle: #1e293b;
            --border: #24324d;
            --text-main: #f1f5f9;
            --text-muted: #94a3b8;
            --accent: #f59e0b;
            --accent-glow: rgba(245, 158, 11, 0.15);
            --warrior: #c69b6d;
            --rank-1: #fbbf24;
            --rank-2: #cbd5e1;
            --rank-3: #d97706;
            --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            background-color: var(--bg-base);
            color: var(--text-main);
            font-family: var(--font-family);
            line-height: 1.5;
            padding: 0;
            margin: 0;
        }

        a {
            color: var(--accent);
            text-decoration: none;
            transition: color 0.15s ease;
        }

        a:hover {
            color: #fbbf24;
            text-decoration: underline;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem 1rem;
        }

        header {
            border-bottom: 1px solid var(--border);
            padding-bottom: 1.5rem;
            margin-bottom: 2rem;
        }

        .header-top {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            gap: 1rem;
        }

        .brand-title {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        .shield-icon {
            font-size: 2rem;
            background: linear-gradient(135deg, #f59e0b, #b45309);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        h1 {
            font-size: 1.85rem;
            font-weight: 800;
            letter-spacing: -0.025em;
            color: #ffffff;
        }

        .subtitle {
            color: var(--text-muted);
            font-size: 0.95rem;
            margin-top: 0.25rem;
        }

        .server-badge {
            display: inline-block;
            background: rgba(245, 158, 11, 0.2);
            color: var(--accent);
            border: 1px solid rgba(245, 158, 11, 0.4);
            padding: 0.15rem 0.6rem;
            border-radius: 9999px;
            font-size: 0.8rem;
            font-weight: 700;
            margin-left: 0.5rem;
            vertical-align: middle;
        }



        .stat-sub {
            font-size: 0.8rem;
            color: var(--accent);
            margin-top: 0.2rem;
        }

        /* FAQ Details Section */
        .faq-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 0.75rem;
            margin-top: 2rem;
            margin-bottom: 2rem;
            overflow: hidden;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .faq-card:hover {
            border-color: rgba(245, 158, 11, 0.4);
        }

        .faq-card summary {
            padding: 0.85rem 1.25rem;
            font-size: 0.95rem;
            font-weight: 600;
            color: var(--text-main);
            cursor: pointer;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 0.6rem;
            list-style: none;
            transition: background-color 0.15s ease, color 0.15s ease;
        }

        .faq-card summary::-webkit-details-marker {
            display: none;
        }

        .faq-card summary::marker {
            display: none;
        }

        .faq-card summary:hover {
            color: #ffffff;
            background: rgba(255, 255, 255, 0.02);
        }

        .faq-icon-arrow {
            display: inline-block;
            font-size: 0.75rem;
            color: var(--accent);
            transition: transform 0.2s ease;
        }

        .faq-card[open] .faq-icon-arrow {
            transform: rotate(90deg);
        }

        .faq-card[open] summary {
            border-bottom: 1px solid var(--border);
            background: var(--bg-subtle);
        }

        .faq-content {
            padding: 1.25rem 1.5rem;
            color: #cbd5e1;
            font-size: 0.95rem;
            line-height: 1.65;
            background: rgba(15, 23, 42, 0.3);
        }

        .faq-content h1,
        .faq-content h2,
        .faq-content h3 {
            color: #ffffff;
            font-size: 1.15rem;
            font-weight: 700;
            margin-top: 1.25rem;
            margin-bottom: 0.6rem;
        }

        .faq-content h1:first-child,
        .faq-content h2:first-child,
        .faq-content h3:first-child {
            margin-top: 0;
        }

        .faq-content p {
            margin-bottom: 0.85rem;
        }

        .faq-content p:last-child {
            margin-bottom: 0;
        }

        .faq-content ol,
        .faq-content ul {
            margin-left: 1.5rem;
            margin-bottom: 0.85rem;
        }

        .faq-content li {
            margin-bottom: 0.35rem;
        }

        .faq-content strong {
            color: #ffffff;
            font-weight: 600;
        }

        .faq-content code {
            background: var(--bg-subtle);
            border: 1px solid var(--border);
            padding: 0.15rem 0.4rem;
            border-radius: 0.25rem;
            font-size: 0.85rem;
            color: #e2e8f0;
        }

        .faq-content a {
            color: var(--accent);
            text-decoration: underline;
        }

        /* Controls */
        .controls-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 0.75rem;
            padding: 1rem;
            margin-bottom: 2rem;
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            gap: 1rem;
        }

        .view-tabs {
            display: flex;
            background: var(--bg-base);
            padding: 0.25rem;
            border-radius: 0.5rem;
            border: 1px solid var(--border);
            gap: 0.25rem;
        }

        .tab-btn {
            background: transparent;
            border: none;
            color: var(--text-muted);
            padding: 0.5rem 1rem;
            font-size: 0.875rem;
            font-weight: 600;
            border-radius: 0.375rem;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .tab-btn:hover {
            color: #ffffff;
        }

        .tab-btn.active {
            background: var(--bg-subtle);
            color: #ffffff;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }

        .filters {
            display: flex;
            flex-wrap: wrap;
            gap: 0.75rem;
            align-items: center;
        }

        .input-control {
            background: var(--bg-base);
            border: 1px solid var(--border);
            color: var(--text-main);
            padding: 0.5rem 0.85rem;
            border-radius: 0.5rem;
            font-size: 0.875rem;
            outline: none;
            transition: border-color 0.2s;
        }

        .input-control:focus {
            border-color: var(--accent);
        }

        /* Bosskill Cards */
        .bosskill-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 0.75rem;
            margin-bottom: 1.5rem;
            overflow: hidden;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
            transition: transform 0.15s ease, border-color 0.15s ease;
        }

        .bosskill-card:hover {
            border-color: #3b4d75;
        }

        .card-header {
            background: rgba(30, 41, 59, 0.5);
            border-bottom: 1px solid var(--border);
            padding: 0.85rem 1.25rem;
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            gap: 0.5rem;
        }

        .boss-name {
            font-size: 1.15rem;
            font-weight: 700;
            color: #ffffff;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .raid-tag {
            font-size: 0.75rem;
            background: rgba(245, 158, 11, 0.15);
            color: var(--accent);
            padding: 0.15rem 0.5rem;
            border-radius: 0.25rem;
            font-weight: 600;
        }

        .meta-info {
            display: flex;
            align-items: center;
            gap: 0.85rem;
            font-size: 0.85rem;
            color: var(--text-muted);
        }

        .guild-tag {
            color: #cbd5e1;
            font-weight: 500;
        }

        .realm-tag {
            background: rgba(148, 163, 184, 0.1);
            color: #94a3b8;
            padding: 0.15rem 0.5rem;
            border-radius: 0.25rem;
            font-size: 0.75rem;
            font-weight: 600;
        }

        .duration-tag {
            color: #93c5fd;
            font-size: 0.85rem;
            font-weight: 500;
        }

        /* Table */
        .table-responsive {
            overflow-x: auto;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
            font-size: 0.875rem;
        }

        th {
            background: rgba(15, 23, 42, 0.4);
            color: var(--text-muted);
            font-weight: 600;
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding: 0.75rem 1.25rem;
            border-bottom: 1px solid var(--border);
        }

        td {
            padding: 0.85rem 1.25rem;
            border-bottom: 1px solid rgba(36, 50, 77, 0.5);
            vertical-align: middle;
        }

        tr:last-child td {
            border-bottom: none;
        }

        tr:hover td {
            background: rgba(255, 255, 255, 0.02);
        }

        .rank-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 1.75rem;
            height: 1.75rem;
            border-radius: 0.375rem;
            font-weight: 700;
            font-size: 0.75rem;
            background: var(--bg-subtle);
            color: var(--text-muted);
        }

        .rank-1 { background: rgba(251, 191, 36, 0.2); color: var(--rank-1); border: 1px solid rgba(251, 191, 36, 0.3); }
        .rank-2 { background: rgba(203, 213, 225, 0.2); color: var(--rank-2); border: 1px solid rgba(203, 213, 225, 0.3); }
        .rank-3 { background: rgba(217, 119, 6, 0.2); color: var(--rank-3); border: 1px solid rgba(217, 119, 6, 0.3); }

        .player-link {
            font-weight: 600;
            color: #cbd5e1;
            font-size: 0.95rem;
            transition: filter 0.15s ease, text-decoration 0.15s ease;
        }

        .player-link:hover {
            filter: brightness(1.25);
            text-decoration: underline;
        }

        .dps-cell {
            font-weight: 700;
            font-size: 1rem;
            color: #38bdf8;
        }

        .dmg-cell {
            color: #cbd5e1;
        }

        .ilvl-badge {
            background: rgba(148, 163, 184, 0.1);
            color: #94a3b8;
            padding: 0.2rem 0.5rem;
            border-radius: 0.25rem;
            font-size: 0.75rem;
            font-weight: 500;
        }

        .no-data {
            padding: 2rem;
            text-align: center;
            color: var(--text-muted);
            font-style: italic;
        }

        /* Top 50 Leaderboard Styles */
        .points-badge {
            display: inline-flex;
            align-items: center;
            background: rgba(245, 158, 11, 0.15);
            color: #fbbf24;
            border: 1px solid rgba(245, 158, 11, 0.35);
            padding: 0.2rem 0.65rem;
            border-radius: 9999px;
            font-size: 0.85rem;
            font-weight: 700;
            white-space: nowrap;
        }

        .medals-cell {
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 0.35rem;
        }

        .medal-tag {
            display: inline-flex;
            align-items: center;
            gap: 0.15rem;
            padding: 0.1rem 0.4rem;
            border-radius: 0.25rem;
            font-size: 0.75rem;
            font-weight: 600;
        }

        .medal-tag.gold {
            background: rgba(251, 191, 36, 0.15);
            color: #fbbf24;
            border: 1px solid rgba(251, 191, 36, 0.3);
        }

        .medal-tag.silver {
            background: rgba(203, 213, 225, 0.15);
            color: #cbd5e1;
            border: 1px solid rgba(203, 213, 225, 0.3);
        }

        .medal-tag.bronze {
            background: rgba(217, 119, 6, 0.15);
            color: #d97706;
            border: 1px solid rgba(217, 119, 6, 0.3);
        }

        .best-rank-tag {
            color: var(--text-muted);
            font-size: 0.8rem;
            font-style: italic;
        }

        .placements-tag {
            color: #cbd5e1;
            font-weight: 500;
            cursor: help;
            border-bottom: 1px dotted var(--text-muted);
        }

        /* Bosskills Feed Table Layout & Column Alignment */
        #view-kills table {
            table-layout: fixed;
            width: 100%;
            min-width: 760px;
        }

        #view-kills th,
        #view-kills td {
            white-space: nowrap;
        }

        #view-kills td {
            font-variant-numeric: tabular-nums;
        }

        #view-kills .col-tank {
            width: 20%;
            text-align: left;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        #view-kills .col-dps {
            width: 12%;
            text-align: right;
        }

        #view-kills .col-dmg-done {
            width: 16%;
            text-align: right;
        }

        #view-kills .col-dmg-taken {
            width: 16%;
            text-align: right;
        }

        #view-kills .col-dmg-absorbed {
            width: 22%;
            text-align: right;
        }

        #view-kills .col-ilvl {
            width: 14%;
            text-align: right;
        }

        #view-kills td.no-data {
            padding: 0.85rem 1.25rem;
            line-height: 1.5rem;
            text-align: center;
            white-space: normal;
        }

        footer {
            margin-top: 3rem;
            padding-top: 1.5rem;
            border-top: 1px solid var(--border);
            text-align: center;
            font-size: 0.8rem;
            color: var(--text-muted);
        }

        @media (max-width: 640px) {
            .header-top {
                flex-direction: column;
                align-items: flex-start;
            }
            .controls-card {
                flex-direction: column;
                align-items: stretch;
            }
            .filters {
                flex-direction: column;
            }
            .input-control {
                width: 100%;
            }
        }
    </style>
</head>
<body>

<div class="container">
    <header>
        <div class="header-top">
            <div class="brand-title">
                <span class="shield-icon">🛡️</span>
                <div>
                    <h1>Kronos Tank Logs <span class="server-badge">${escapeHtml(activeServerLabel)}</span></h1>
                    <div class="subtitle">Top tanks ranked by DPS per boss encounter on ${escapeHtml(activeServerLabel)}</div>
                </div>
            </div>
        </div>
    </header>

    <div class="controls-card">
        <div class="view-tabs">
            <button class="tab-btn active" id="tab-per-kill" onclick="switchView('kills')">Bosskills Feed</button>
            <button class="tab-btn" id="tab-leaderboard" onclick="switchView('leaderboard')">Top 10 by Boss</button>
            <button class="tab-btn" id="tab-top50" onclick="switchView('top50')">Top 50 Leaderboard</button>
        </div>

        <div class="filters">
            <select class="input-control" id="server-select" onchange="filterData()">
                <option value="">All Servers</option>
                ${allServers.map((s) => `
                    <option value="${escapeHtml(s)}" ${serverFilter && s.toLowerCase() === serverFilter.toLowerCase() ? "selected" : ""}>
                        ${escapeHtml(s)}
                    </option>
                `).join("")}
            </select>
            <select class="input-control" id="boss-select" onchange="filterData()">
                <option value="">All Bosses</option>
                ${uniqueBosses.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("")}
            </select>
        </div>
    </div>

    <!-- VIEW 1: Per Bosskill Feed -->
    <div id="view-kills">
        ${processedKills.map((kill) => `
        <div class="bosskill-card" data-realm="${escapeHtml(kill.realm)}" data-boss="${escapeHtml(kill.boss_name)}">
            <div class="card-header">
                <div class="boss-name">
                    <span>${escapeHtml(kill.boss_name)}</span>
                    <span class="raid-tag">${escapeHtml(kill.raid)}</span>
                </div>
                <div class="meta-info">
                    <span class="guild-tag">⚔️ ${escapeHtml(kill.guild || "No Guild")}</span>
                    <span class="realm-tag">${escapeHtml(kill.realm)}</span>
                    ${kill.fight_length ? `<span class="duration-tag" title="Fight Length">⏱️ ${escapeHtml(kill.fight_length)}</span>` : ""}
                    <span>${escapeHtml(kill.time)}</span>
                    <a href="https://vanilla-twinhead.twinstar.cz/?boss-kill=${kill.id}" target="_blank">Kill #${kill.id} ↗</a>
                </div>
            </div>

            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th class="col-tank">Tank</th>
                            <th class="col-dps">DPS</th>
                            <th class="col-dmg-done">Damage Done</th>
                            <th class="col-dmg-taken">Damage Taken</th>
                            <th class="col-dmg-absorbed">Damage Absorbed</th>
                            <th class="col-ilvl">Item Level</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${kill.topTanks.length === 0 ? `
                        <tr>
                            <td colspan="6" class="no-data">No qualifying tank detected for this fight.</td>
                        </tr>
                        ` : kill.topTanks.map((tank) => `
                        <tr>
                            <td class="col-tank">
                                <a href="https://armory.twinstar-wow.com/character?name=${encodeURIComponent(tank.name)}&realm=${encodeURIComponent(tank.realm)}" target="_blank" class="player-link" style="color: ${getClassColor(tank.class)};" title="${escapeHtml(getClassName(tank.class))}">
                                    ${escapeHtml(tank.name)}
                                </a>
                            </td>
                            <td class="col-dps dps-cell">${formatDps(tank.dps)}</td>
                            <td class="col-dmg-done dmg-cell">${formatDmg(tank.dmg_done)}</td>
                            <td class="col-dmg-taken dmg-cell">${formatDmg(tank.dmg_taken)}</td>
                            <td class="col-dmg-absorbed dmg-cell">${formatDmg(tank.dmg_absorbed || 0)}</td>
                            <td class="col-ilvl"><span class="ilvl-badge">iLvl ${formatIlvl(tank.avg_item_lvl)}</span></td>
                        </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        </div>
        `).join("")}
    </div>

    <!-- VIEW 2: Top 10 Tanks per Boss Leaderboard -->
    <div id="view-leaderboard" style="display: none;">
        ${bossLeaderboards.map((b) => `
        <div class="bosskill-card" data-boss="${escapeHtml(b.boss_name)}">
            <div class="card-header">
                <div class="boss-name">
                    <span>${escapeHtml(b.boss_name)}</span>
                </div>
            </div>

            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th style="width: 4rem;">Rank</th>
                            <th>Tank</th>
                            <th>DPS</th>
                            <th>Damage Done</th>
                            <th>Damage Taken</th>
                            <th>Damage Absorbed</th>
                            <th>Item Level</th>
                            <th>Fight Length</th>
                            <th>Server</th>
                            <th>Guild</th>
                            <th>Date</th>
                            <th>Log</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${b.tanks.map((tank, idx) => `
                        <tr class="leaderboard-row" data-realm="${escapeHtml(tank.realm)}">
                            <td><span class="rank-badge rank-${idx + 1}">#${idx + 1}</span></td>
                            <td>
                                <a href="https://armory.twinstar-wow.com/character?name=${encodeURIComponent(tank.name)}&realm=${encodeURIComponent(tank.realm)}" target="_blank" class="player-link" style="color: ${getClassColor(tank.class)};" title="${escapeHtml(getClassName(tank.class))}">
                                    ${escapeHtml(tank.name)}
                                </a>
                            </td>
                            <td class="dps-cell">${formatDps(tank.dps)}</td>
                            <td class="dmg-cell">${formatDmg(tank.dmg_done)}</td>
                            <td class="dmg-cell">${formatDmg(tank.dmg_taken)}</td>
                            <td class="dmg-cell">${formatDmg(tank.dmg_absorbed || 0)}</td>
                            <td><span class="ilvl-badge">iLvl ${formatIlvl(tank.avg_item_lvl)}</span></td>
                            <td style="color: var(--text-muted); font-size: 0.85rem;">${escapeHtml(tank.fight_length || "-")}</td>
                            <td><span class="realm-tag">${escapeHtml(tank.realm)}</span></td>
                            <td>${escapeHtml(tank.guild || "No Guild")}</td>
                            <td style="color: var(--text-muted); font-size: 0.8rem;">${escapeHtml(tank.time ? tank.time.split(' ')[0] : "")}</td>
                            <td>
                                <a href="https://vanilla-twinhead.twinstar.cz/?boss-kill=${tank.bosskill_id}" target="_blank">
                                    #${tank.bosskill_id} ↗
                                </a>
                            </td>
                        </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        </div>
        `).join("")}
    </div>

    <!-- VIEW 3: Top 50 Tank Leaderboard -->
    <div id="view-top50" style="display: none;">
        <div class="bosskill-card">
            <div class="card-header">
                <div class="boss-name">
                    <span>🏆 Top 50 Tanks</span>
                </div>
            </div>

            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th style="width: 4rem;">Rank</th>
                            <th>Tank</th>
                            <th>Points</th>
                            <th>Top 10 Finishes</th>
                            <th>Podiums</th>
                            <th>Top DPS</th>
                            <th>Item Level</th>
                            <th>Guild</th>
                            <th>Server</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${top50Leaderboard.length === 0 ? `
                        <tr id="top50-no-data">
                            <td colspan="9" class="no-data">No qualifying tanks found.</td>
                        </tr>
                        ` : `
                        <tr id="top50-no-data" style="display: none;">
                            <td colspan="9" class="no-data">No qualifying tanks found.</td>
                        </tr>
                        ` + top50Leaderboard.map((tank, idx) => `
                        <tr class="top50-row" data-realm="${escapeHtml(tank.realm)}">
                            <td><span class="rank-badge${idx === 0 ? " rank-1" : idx === 1 ? " rank-2" : idx === 2 ? " rank-3" : ""}">#${idx + 1}</span></td>
                            <td>
                                <a href="https://armory.twinstar-wow.com/character?name=${encodeURIComponent(tank.name)}&realm=${encodeURIComponent(tank.realm)}" target="_blank" class="player-link" style="color: ${getClassColor(tank.class)};" title="${escapeHtml(getClassName(tank.class))}">
                                    ${escapeHtml(tank.name)}
                                </a>
                            </td>
                            <td>
                                <span class="points-badge" title="${escapeHtml(tank.placements.map(p => `${p.boss_name}: #${p.rank} (${p.points} pts - ${formatDps(p.dps)} DPS)`).join('\n'))}">
                                    ${tank.totalPoints} pts
                                </span>
                            </td>
                            <td>
                                <span class="placements-tag" title="${escapeHtml(tank.placements.map(p => `${p.boss_name}: #${p.rank} (${p.points} pts - ${formatDps(p.dps)} DPS)`).join('\n'))}">
                                    ${tank.placements.length} / ${uniqueBosses.length} Bosses
                                </span>
                            </td>
                            <td>
                                <div class="medals-cell">
                                    ${tank.rank1Count > 0 ? `<span class="medal-tag gold" title="${tank.rank1Count}x Rank 1">🥇 ${tank.rank1Count}</span>` : ""}
                                    ${tank.rank2Count > 0 ? `<span class="medal-tag silver" title="${tank.rank2Count}x Rank 2">🥈 ${tank.rank2Count}</span>` : ""}
                                    ${tank.rank3Count > 0 ? `<span class="medal-tag bronze" title="${tank.rank3Count}x Rank 3">🥉 ${tank.rank3Count}</span>` : ""}
                                    ${tank.rank1Count === 0 && tank.rank2Count === 0 && tank.rank3Count === 0 ? `<span class="best-rank-tag">Best: #${tank.bestRank}</span>` : ""}
                                </div>
                            </td>
                            <td class="dps-cell">${formatDps(tank.topDps)}</td>
                            <td><span class="ilvl-badge">iLvl ${formatIlvl(tank.avgItemLvl)}</span></td>
                            <td>${escapeHtml(tank.guild || "No Guild")}</td>
                            <td><span class="realm-tag">${escapeHtml(tank.realm)}</span></td>
                        </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    ${faqHtml ? `
    <details class="faq-card">
        <summary>
            <span class="faq-icon-arrow">▶</span>
            <span>Frequently Asked Questions (FAQ)</span>
        </summary>
        <div class="faq-content">
            ${faqHtml}
        </div>
    </details>
    ` : ""}

    <footer>
        <p>Kronos Tank Logs by <a href="https://www.vanillawar.com/" target="_blank">Warlord Drak</a> &bull; Data scraped from <a href="https://vanilla-twinhead.twinstar.cz/?latest=bosskills" target="_blank">Twinhead</a> &bull; <a href="bosskills.json" target="_blank">View Raw JSON (bosskills.json)</a> &bull; Generated: ${generatedAt}</p>
    </footer>
</div>

<script>
    let currentView = 'kills';

    function switchView(view) {
        currentView = view;
        const killsView = document.getElementById('view-kills');
        const leadView = document.getElementById('view-leaderboard');
        const top50View = document.getElementById('view-top50');
        const tabKills = document.getElementById('tab-per-kill');
        const tabLead = document.getElementById('tab-leaderboard');
        const tabTop50 = document.getElementById('tab-top50');
        const bossSelect = document.getElementById('boss-select');

        if (view === 'kills') {
            killsView.style.display = 'block';
            leadView.style.display = 'none';
            if (top50View) top50View.style.display = 'none';
            tabKills.classList.add('active');
            tabLead.classList.remove('active');
            if (tabTop50) tabTop50.classList.remove('active');
            if (bossSelect) bossSelect.style.display = '';
        } else if (view === 'leaderboard') {
            killsView.style.display = 'none';
            leadView.style.display = 'block';
            if (top50View) top50View.style.display = 'none';
            tabKills.classList.remove('active');
            tabLead.classList.add('active');
            if (tabTop50) tabTop50.classList.remove('active');
            if (bossSelect) bossSelect.style.display = '';
        } else if (view === 'top50') {
            killsView.style.display = 'none';
            leadView.style.display = 'none';
            if (top50View) top50View.style.display = 'block';
            tabKills.classList.remove('active');
            tabLead.classList.remove('active');
            if (tabTop50) tabTop50.classList.add('active');
            if (bossSelect) bossSelect.style.display = 'none';
        }
        if (history.replaceState) {
            history.replaceState(null, '', '#' + view);
        }
        filterData();
    }

    function filterData() {
        const serverFilter = (document.getElementById('server-select')?.value || '').toLowerCase();
        const bossFilter = (document.getElementById('boss-select')?.value || '').toLowerCase();

        if (currentView === 'kills') {
            const cards = document.getElementById('view-kills').querySelectorAll('.bosskill-card');
            cards.forEach(card => {
                const realm = (card.getAttribute('data-realm') || '').toLowerCase();
                const boss = (card.getAttribute('data-boss') || '').toLowerCase();

                const matchesServer = !serverFilter || realm === serverFilter;
                const matchesBoss = !bossFilter || boss === bossFilter;

                if (matchesServer && matchesBoss) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            });
        } else if (currentView === 'leaderboard') {
            const cards = document.getElementById('view-leaderboard').querySelectorAll('.bosskill-card');
            cards.forEach(card => {
                const boss = (card.getAttribute('data-boss') || '').toLowerCase();
                const matchesBoss = !bossFilter || boss === bossFilter;

                const rows = card.querySelectorAll('.leaderboard-row');
                let visibleRows = 0;
                rows.forEach(row => {
                    const realm = (row.getAttribute('data-realm') || '').toLowerCase();

                    const matchesServer = !serverFilter || realm === serverFilter;

                    if (matchesServer) {
                        row.style.display = '';
                        visibleRows++;
                    } else {
                        row.style.display = 'none';
                    }
                });

                if (matchesBoss && visibleRows > 0) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            });
        } else if (currentView === 'top50') {
            const top50 = document.getElementById('view-top50');
            if (top50) {
                const rows = top50.querySelectorAll('.top50-row');
                let visibleRows = 0;
                rows.forEach(row => {
                    const realm = (row.getAttribute('data-realm') || '').toLowerCase();
                    const matchesServer = !serverFilter || realm === serverFilter;
                    if (matchesServer) {
                        row.style.display = '';
                        visibleRows++;
                    } else {
                        row.style.display = 'none';
                    }
                });
                const noDataRow = document.getElementById('top50-no-data');
                if (noDataRow) {
                    noDataRow.style.display = visibleRows === 0 ? '' : 'none';
                }
            }
        }
    }

    const initialHash = window.location.hash.replace('#', '');
    if (initialHash === 'kills' || initialHash === 'leaderboard' || initialHash === 'top50') {
        switchView(initialHash);
    }
</script>

</body>
</html>
`;
}

export function render(
    bosskillsFile = BOSS_KILLS_FILE,
    outputFile = "index.html",
    options: { server?: string; faqFile?: string; faqHtml?: string } = { server: "KronosV" }
): void {
    if (!existsSync(bosskillsFile)) {
        console.error(`Error: Data file ${bosskillsFile} not found.`);
        process.exit(1);
    }

    const raw = readFileSync(bosskillsFile, "utf-8");
    const bosskills: StoredBosskill[] = JSON.parse(raw);
    const serverLabel = options.server ?? "all";
    console.log(`Rendering bosskills from ${bosskillsFile} (server: ${serverLabel}) into ${outputFile}...`);

    const html = generateHtml(bosskills, options);
    writeFileSync(outputFile, html, "utf-8");
    console.log(`Successfully generated ${outputFile} (${Buffer.byteLength(html, "utf-8")} bytes).`);
}

if (import.meta.main) {
    const jsonFile = process.argv[2] ?? BOSS_KILLS_FILE;
    const outFile = process.argv[3] ?? "index.html";
    const server = process.argv[4] ?? "KronosV";
    const faqFile = process.argv[5] ?? "faq.md";
    render(jsonFile, outFile, { server, faqFile });
}
