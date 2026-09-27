import { existsSync, readFileSync, writeFileSync } from "fs";
import { BOSS_KILLS_FILE, type StoredBosskill } from "./update-bosskills.ts";

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

export function generateHtml(
    bosskills: StoredBosskill[],
    options: { server?: string } = {}
): string {
    const generatedAt = new Date().toISOString().replace("T", " ").replace(/\..+/, " UTC");

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
        dps: string;
        dmg_done: string;
        avg_item_lvl: string;
        boss_name: string;
        bosskill_id: number;
        raid: string;
        guild: string;
        time: string;
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
            });
        }
    }

    // Sort each boss leaderboard by DPS descending and take top 10
    const bossLeaderboards: Array<{ boss_name: string; tanks: any[] }> = [];
    for (const [boss_name, tanks] of bossMap.entries()) {
        tanks.sort((a, b) => Number(b.dps) - Number(a.dps));
        bossLeaderboards.push({
            boss_name,
            tanks: tanks.slice(0, 10),
        });
    }
    bossLeaderboards.sort((a, b) => a.boss_name.localeCompare(b.boss_name));

    // Stats
    const totalKills = processedKills.length;
    let totalTanks = 0;
    let highestDpsRecord = { name: "N/A", dps: 0, boss: "N/A" };
    for (const k of processedKills) {
        totalTanks += k.topTanks.length;
        for (const t of k.topTanks) {
            const val = Number(t.dps);
            if (val > highestDpsRecord.dps) {
                highestDpsRecord = { name: t.name, dps: val, boss: k.boss_name };
            }
        }
    }

    const uniqueBosses = Array.from(bossMap.keys()).sort();
    const activeServerLabel = serverFilter ?? "All Servers";

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kronos Tank Logs - ${escapeHtml(activeServerLabel)}</title>
    <meta name="description" content="Top warrior tanks ranked by DPS per bosskill on ${escapeHtml(activeServerLabel)}">
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
            padding-bottom: 2rem;
            margin-bottom: 2rem;
        }

        .header-top {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            gap: 1rem;
            margin-bottom: 1rem;
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

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-top: 1.5rem;
        }

        .stat-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 0.75rem;
            padding: 1rem;
            display: flex;
            flex-direction: column;
        }

        .stat-label {
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-muted);
            margin-bottom: 0.25rem;
        }

        .stat-val {
            font-size: 1.4rem;
            font-weight: 700;
            color: #ffffff;
        }

        .stat-sub {
            font-size: 0.8rem;
            color: var(--warrior);
            margin-top: 0.2rem;
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
            color: var(--warrior);
            font-size: 0.95rem;
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
                    <div class="subtitle">Top warrior tanks ranked by DPS per boss encounter on ${escapeHtml(activeServerLabel)}</div>
                </div>
            </div>
            <div>
                <a href="bosskills.json" target="_blank" class="stat-sub">View Raw JSON (bosskills.json) &rarr;</a>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <span class="stat-label">Total Bosskills</span>
                <span class="stat-val">${totalKills}</span>
                <span class="stat-sub">${uniqueBosses.length} Bosses Tracked</span>
            </div>
            <div class="stat-card">
                <span class="stat-label">Tank Records</span>
                <span class="stat-val">${totalTanks}</span>
                <span class="stat-sub">Warrior Tanks (Class 1)</span>
            </div>
            <div class="stat-card">
                <span class="stat-label">Highest Tank DPS</span>
                <span class="stat-val">${highestDpsRecord.dps ? formatDps(highestDpsRecord.dps) : "0.0"}</span>
                <span class="stat-sub">${escapeHtml(highestDpsRecord.name)} (${escapeHtml(highestDpsRecord.boss)})</span>
            </div>
            <div class="stat-card">
                <span class="stat-label">Last Updated</span>
                <span class="stat-val" style="font-size: 1.1rem; padding-top: 0.25rem;">${generatedAt}</span>
                <span class="stat-sub">Auto-updated via GitHub Actions</span>
            </div>
        </div>
    </header>

    <div class="controls-card">
        <div class="view-tabs">
            <button class="tab-btn active" id="tab-per-kill" onclick="switchView('kills')">Bosskills Feed</button>
            <button class="tab-btn" id="tab-leaderboard" onclick="switchView('leaderboard')">Top 10 by Boss</button>
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
            <input type="text" class="input-control" id="search-input" placeholder="Search player, guild..." oninput="filterData()">
        </div>
    </div>

    <!-- VIEW 1: Per Bosskill Feed -->
    <div id="view-kills">
        ${processedKills.map((kill) => `
        <div class="bosskill-card" data-realm="${escapeHtml(kill.realm)}" data-boss="${escapeHtml(kill.boss_name)}" data-guild="${escapeHtml(kill.guild || '')}" data-players="${escapeHtml(kill.topTanks.map((t) => t.name).join(' '))}">
            <div class="card-header">
                <div class="boss-name">
                    <span>${escapeHtml(kill.boss_name)}</span>
                    <span class="raid-tag">${escapeHtml(kill.raid)}</span>
                </div>
                <div class="meta-info">
                    <span class="guild-tag">⚔️ ${escapeHtml(kill.guild || "No Guild")}</span>
                    <span class="realm-tag">${escapeHtml(kill.realm)}</span>
                    <span>${escapeHtml(kill.time)}</span>
                    <a href="https://vanilla-twinhead.twinstar.cz/?boss-kill=${kill.id}" target="_blank">Kill #${kill.id} ↗</a>
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
                            <th>Item Level</th>
                            <th>Profile</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${kill.topTanks.length === 0 ? `
                        <tr>
                            <td colspan="6" class="no-data">No qualifying warrior tanks detected for this fight.</td>
                        </tr>
                        ` : kill.topTanks.map((tank, idx) => `
                        <tr>
                            <td><span class="rank-badge rank-${idx + 1}">#${idx + 1}</span></td>
                            <td>
                                <a href="https://vanilla-twinhead.twinstar.cz/?character=${tank.guid}" target="_blank" class="player-link">
                                    ${escapeHtml(tank.name)}
                                </a>
                            </td>
                            <td class="dps-cell">${formatDps(tank.dps)}</td>
                            <td class="dmg-cell">${formatDmg(tank.dmg_done)}</td>
                            <td><span class="ilvl-badge">iLvl ${formatIlvl(tank.avg_item_lvl)}</span></td>
                            <td>
                                <a href="https://vanilla-twinhead.twinstar.cz/?character=${tank.guid}" target="_blank" style="font-size: 0.8rem; color: var(--text-muted);">
                                    GUID ${escapeHtml(tank.guid)} ↗
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

    <!-- VIEW 2: Top 10 Tanks per Boss Leaderboard -->
    <div id="view-leaderboard" style="display: none;">
        ${bossLeaderboards.map((b) => `
        <div class="bosskill-card" data-boss="${escapeHtml(b.boss_name)}">
            <div class="card-header">
                <div class="boss-name">
                    <span>${escapeHtml(b.boss_name)}</span>
                    <span class="raid-tag">Top 10 Tanks Leaderboard</span>
                </div>
                <div class="meta-info">
                    <span>${b.tanks.length} Tank Record(s)</span>
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
                            <th>Item Level</th>
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
                                <a href="https://vanilla-twinhead.twinstar.cz/?character=${tank.guid}" target="_blank" class="player-link">
                                    ${escapeHtml(tank.name)}
                                </a>
                            </td>
                            <td class="dps-cell">${formatDps(tank.dps)}</td>
                            <td class="dmg-cell">${formatDmg(tank.dmg_done)}</td>
                            <td><span class="ilvl-badge">iLvl ${formatIlvl(tank.avg_item_lvl)}</span></td>
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

    <footer>
        <p>Kronos Vanilla Tank Logs &bull; Data scraped from <a href="https://vanilla-twinhead.twinstar.cz/?latest=bosskills" target="_blank">Twinhead</a> &bull; Generated: ${generatedAt}</p>
    </footer>
</div>

<script>
    let currentView = 'kills';

    function switchView(view) {
        currentView = view;
        const killsView = document.getElementById('view-kills');
        const leadView = document.getElementById('view-leaderboard');
        const tabKills = document.getElementById('tab-per-kill');
        const tabLead = document.getElementById('tab-leaderboard');

        if (view === 'kills') {
            killsView.style.display = 'block';
            leadView.style.display = 'none';
            tabKills.classList.add('active');
            tabLead.classList.remove('active');
        } else {
            killsView.style.display = 'none';
            leadView.style.display = 'block';
            tabKills.classList.remove('active');
            tabLead.classList.add('active');
        }
        filterData();
    }

    function filterData() {
        const serverFilter = (document.getElementById('server-select')?.value || '').toLowerCase();
        const bossFilter = (document.getElementById('boss-select')?.value || '').toLowerCase();
        const searchFilter = (document.getElementById('search-input')?.value || '').toLowerCase().trim();

        if (currentView === 'kills') {
            const cards = document.getElementById('view-kills').querySelectorAll('.bosskill-card');
            cards.forEach(card => {
                const realm = (card.getAttribute('data-realm') || '').toLowerCase();
                const boss = (card.getAttribute('data-boss') || '').toLowerCase();
                const guild = (card.getAttribute('data-guild') || '').toLowerCase();
                const players = (card.getAttribute('data-players') || '').toLowerCase();

                const matchesServer = !serverFilter || realm === serverFilter;
                const matchesBoss = !bossFilter || boss === bossFilter;
                const matchesSearch = !searchFilter || 
                    boss.includes(searchFilter) || 
                    guild.includes(searchFilter) || 
                    players.includes(searchFilter) ||
                    realm.includes(searchFilter);

                if (matchesServer && matchesBoss && matchesSearch) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            });
        } else {
            const cards = document.getElementById('view-leaderboard').querySelectorAll('.bosskill-card');
            cards.forEach(card => {
                const boss = (card.getAttribute('data-boss') || '').toLowerCase();
                const matchesBoss = !bossFilter || boss === bossFilter;

                const rows = card.querySelectorAll('.leaderboard-row');
                let visibleRows = 0;
                rows.forEach(row => {
                    const realm = (row.getAttribute('data-realm') || '').toLowerCase();
                    const text = row.textContent.toLowerCase();

                    const matchesServer = !serverFilter || realm === serverFilter;
                    const matchesSearch = !searchFilter || text.includes(searchFilter);

                    if (matchesServer && matchesSearch) {
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
        }
    }
</script>

</body>
</html>
`;
}

export function render(
    bosskillsFile = BOSS_KILLS_FILE,
    outputFile = "index.html",
    options: { server?: string } = { server: "KronosV" }
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
    render(jsonFile, outFile, { server });
}
