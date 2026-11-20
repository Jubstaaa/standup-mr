import type { Database } from 'bun:sqlite'

import type { Schedule, ScheduleSettings } from './store.types'

interface ScheduleRow {
    connection_id: string
    days: string
    last_error: string | null
    last_sent_at: number | null
    last_warning: string | null
    next_run_at: number
    time: string
    timezone: string
}

function toSchedule(row: ScheduleRow): Schedule {
    return {
        connectionId: row.connection_id,
        days: row.days,
        lastError: row.last_error,
        lastSentAt: row.last_sent_at,
        lastWarning: row.last_warning,
        nextRunAt: row.next_run_at,
        time: row.time,
        timezone: row.timezone,
    }
}

export class ScheduleRepository {
    constructor(private readonly db: Database) {}

    get(connectionId: string): Schedule | undefined {
        const row = this.db
            .query<ScheduleRow, [string]>(
                'SELECT * FROM schedules WHERE connection_id = ?'
            )
            .get(connectionId)
        return row ? toSchedule(row) : undefined
    }

    // Changing the settings clears the last error: it belonged to the old ones.
    set(
        connectionId: string,
        settings: ScheduleSettings,
        nextRunAt: number
    ): void {
        this.db
            .query(
                `INSERT INTO schedules (connection_id, time, timezone, days, next_run_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (connection_id) DO UPDATE SET
                 time = excluded.time, timezone = excluded.timezone, days = excluded.days,
                 next_run_at = excluded.next_run_at, last_error = NULL`
            )
            .run(
                connectionId,
                settings.time,
                settings.timezone,
                settings.days,
                nextRunAt
            )
    }

    delete(connectionId: string): void {
        this.db
            .query('DELETE FROM schedules WHERE connection_id = ?')
            .run(connectionId)
    }

    listDue(now: number): Schedule[] {
        return this.db
            .query<ScheduleRow, [number]>(
                'SELECT * FROM schedules WHERE next_run_at <= ? ORDER BY next_run_at'
            )
            .all(now)
            .map(toSchedule)
    }

    // True only for the caller that moved the run off `due`.
    claim(connectionId: string, due: number, nextRunAt: number): boolean {
        return (
            this.db
                .query(
                    'UPDATE schedules SET next_run_at = ? WHERE connection_id = ? AND next_run_at = ?'
                )
                .run(nextRunAt, connectionId, due).changes === 1
        )
    }

    markSent(
        connectionId: string,
        sentAt: number,
        nextRunAt: number,
        warning: string | null
    ): void {
        this.db
            .query(
                `UPDATE schedules SET last_sent_at = ?, last_error = NULL,
                 last_warning = ?, next_run_at = ? WHERE connection_id = ?`
            )
            .run(sentAt, warning, nextRunAt, connectionId)
    }

    markFailed(connectionId: string, error: string, nextRunAt: number): void {
        this.db
            .query(
                'UPDATE schedules SET last_error = ?, next_run_at = ? WHERE connection_id = ?'
            )
            .run(error, nextRunAt, connectionId)
    }
}
