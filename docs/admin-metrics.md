# Admin metric definitions


All days are UTC calendar days; today is partial. Windows are 7, 30 or 90
days, and every headline number shows the same measure over the equal window
before it ("no baseline" when the data doesn't reach back that far). A
"player" is an account or a guest; guests are counted by their guest id.

Code: `src/server/admin/metrics/`. Each section's file opens with these
definitions as a comment, beside the queries that compute them.

### Where the numbers come from

Some sources are pruned (`game_time_metrics_daily` keeps this month and last,
`anti_cheat_logs` keeps 14 days, `game_sessions` 6 hours) and some are large
(`currency_ledger`, `arcade_round_history`). A rollup copies what the metrics
need into small per-day tables (migration 0061):

| Table | One row per | From |
| --- | --- | --- |
| `admin_play_days` | day, game, player | `game_time_metrics_daily` (scored runs and their time), `arcade_round_history` (machine rounds), finished chess, connect four and 8-ball matches (one run per player, bots left out) |
| `admin_ledger_days` | day, ledger, bucket | `currency_ledger` (earned tickets) and `store_credit_ledger` (bought tickets), bucketed by source |
| `admin_machine_days` | day, machine | `arcade_round_history`: rounds, players, wagered, paid, and the sums of squares the z score needs |
| `admin_trust_days` | day, game, result | `anti_cheat_logs` |
| `admin_funnel_days` | day, game | `product_analytics_events`: sessions that started and finished |

The rollup is idempotent per day (delete and insert in one transaction, under
an advisory lock). Any metrics read refreshes today if its copy is over 5
minutes old, finalises yesterday after 00:15 UTC, and fills up to 31 missing
days. A cron call at 00:20 UTC (`/api/cron/admin/metrics-rollup`) does the same for the last 3 days, and
`npm run admin-metrics:rollup -- --days=400` backfills history once. History
only reaches as far back as each source does: play time goes back about two
months on a new install, machine rounds and the ledgers to the start.

### Players

| Metric | Definition |
| --- | --- |
| players today | Distinct players in `admin_play_days` today: anyone with a recorded run, machine round or finished match. |
| players a day | The mean of daily players over the window's complete days. |
| weekly, monthly players | Distinct players over the 7 or 30 days ending today, against the 7 or 30 before. |
| stickiness | Players yesterday ÷ distinct players in the 30 days ending yesterday. |
| new player | A player whose first day in `admin_play_days` is that day. The first rolled days overstate it, since everyone looks new then. |
| returning | Players that day minus new players. |
| signups | Accounts created per day. |
| day N back | Of accounts that signed up in the window and whose signup day + N has passed, the share active on exactly that day. N is 1, 7 and 30. |
| cohort week N | Of a signup week's accounts, the share active at least once in week N after it. Blank until that week is over. |

### Games

| Metric | Definition |
| --- | --- |
| runs | Server-recorded plays: finished scored runs, machine rounds, finished matches. |
| starts, finished | Browser sessions that sent `game_started` or `game_completed` (Odom's product analytics), one per session per day. Finished = finishes ÷ starts. |
| average run | Play time ÷ runs, over runs that record time. Machines record none. |
| share of runs | The game's runs ÷ all runs in the window. Floor games (`isOnFloor()`) are listed first, in floor order. |

### Economy

| Metric | Definition |
| --- | --- |
| minted | Earned tickets created: game rewards, daily claim, quests (daily, weekly, season quests and the weekly card), season tiers, level milestones, achievements, monthly boards, machine payouts, refunds, and admin adjustments on days they net positive. |
| spent | Earned tickets destroyed: counter purchases, machine stakes net of refunded stakes, continues, and admin adjustments on days they net negative. |
| net | Minted minus spent: the change in all wallet balances. |
| in wallets | The sum of `wallets.credits` now, and how many accounts hold any. |
| daily cap hit | Player-game-days in `game_daily_earnings` at or over the cap (300), ÷ player-game-days that earned anything. |
| balances | Accounts by balance band; median, 90th and 99th percentile over holders; the share of all tickets the top 1% of holders hold. |
| bought tickets | Stripe packs and ad rewards in, counter purchases out, refunds and disputes reversed, from `store_credit_ledger`. They never reach machines. |

### Machines

| Metric | Definition |
| --- | --- |
| actual return | Paid ÷ wagered over the window's rounds. |
| set return | `ARCADE_RTP` for the machine, or, where that is 1.0 because the edge sits in the rules or the pay table, the documented theoretical return (21: 99.5% with basic strategy; video poker: 97.3%, 8/5 jacks or better; roulette: 36/37; and the others in `MACHINE_THEORETICAL_RTP`). |
| gap | Actual minus set, in percentage points. |
| z | (paid − set × wagered) ÷ (sd × √rounds), with sd the per-round spread of payout − set × wager. Blank under 30 rounds. Past 3 either way is unlikely by chance and is marked red. |
| biggest wins | The ten rounds with the largest payout minus wager in the window. |

### Counter

| Metric | Definition |
| --- | --- |
| items bought, buyers | Distinct purchases (by purchase id) and distinct buyers at the counter, across both ticket kinds. |
| owners | Every holder of the item, however they got it. |
| pack revenue | `amount_total` of fulfilled, unreversed `ticket_purchases` created in the window, in cents. Read from what the app recorded; Stripe is never called. While no purchase is recorded, the tile says "none" and the pack panel says so in one line. |
| paying players | Distinct accounts with a fulfilled, unreversed pack in the window. |
| bought an item, bought a pack | Of accounts active in the window, the share who bought at the counter or bought a pack. First-time payers are payers whose first fulfilled pack is in the window. |
| checkouts | Every checkout started in the window, by how it ended. Shown only once a purchase is recorded. |

### Progression

| Metric | Definition |
| --- | --- |
| level | Each account's level from `user_account_xp` through the levels module's own `levelFromXp`, with its level floor. |
| season tier | The live season's tier each player's season XP reaches, read from that season's config by whatever key it has (`currentSeason()`); nothing names a season key. |
| daily quests done, claimed | Daily quests assigned in the window that reached their goal, and of those, the share claimed. Weekly quests and the weekly card count by creation date; season quests over the whole season. |
| rerolled | Player quest days with at least one reroll ÷ player quest days. |
| achievements earned | Unlocks in the window; most held from `achievement_unlock_counts`. |

### Trust

| Metric | Definition |
| --- | --- |
| flagged, rejected runs | Anti-cheat results by day and game. A flagged run paid and is marked for review; a rejected run paid nothing. Passing runs are logged only when `ANTI_CHEAT_LOG_PASSES` is on, so there is usually no reject rate. |
| game bans | Bans that are indefinite or still running; bans issued in the window. |
| suspended accounts | Accounts with status suspended. |
| rate limited | Requests the auth, read and admin limiters refused, by rule, counted in memory since the server started. |

### Live

| Metric | Definition |
| --- | --- |
| online, playing | Accounts whose presence was seen in the last 2 minutes and isn't offline; playing is the ones in a game. Guests have no presence. |
| active sessions | Game sessions, guests included, with an action in the last 5 minutes. |
| last 15 minutes | Score events, machine rounds and faucet tickets in the last 15 minutes. |

