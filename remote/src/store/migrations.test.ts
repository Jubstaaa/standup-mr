import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { migrate, MIGRATIONS, schemaVersion } from './migrations'

function tables(db: Database): string[] {
    return db
        .query<{ name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        )
        .all()
        .map(row => row.name)
}

describe('migrate', () => {
    test('brings a fresh database to the latest version', () => {
        const db = new Database(':memory:')
        migrate(db, MIGRATIONS)
        expect(schemaVersion(db)).toBe(MIGRATIONS.length)
        expect(tables(db)).toEqual([
            'accounts',
            'clients',
            'codes',
            'connections',
            'instances',
            'pending',
            'schedules',
            'tokens',
        ])
    })

    test('adopts a database built before versioning without losing rows', () => {
        const db = new Database(':memory:')
        // What every release before versioning ran on open: the first
        // migration's SQL, with user_version left at 0.
        db.exec(MIGRATIONS[0]!)
        db.query(
            'INSERT INTO connections (id, created_at, last_used_at) VALUES (?, ?, ?)'
        ).run('live', 1, 2)
        expect(schemaVersion(db)).toBe(0)

        migrate(db, MIGRATIONS)

        expect(schemaVersion(db)).toBe(MIGRATIONS.length)
        expect(
            db.query<{ id: string }, []>('SELECT id FROM connections').all()
        ).toEqual([{ id: 'live' }])
    })

    test('is a no-op when the database is already current', () => {
        const db = new Database(':memory:')
        migrate(db, MIGRATIONS)
        db.query(
            'INSERT INTO connections (id, created_at, last_used_at) VALUES (?, ?, ?)'
        ).run('live', 1, 2)

        migrate(db, MIGRATIONS)

        expect(schemaVersion(db)).toBe(MIGRATIONS.length)
        expect(db.query('SELECT COUNT(*) AS n FROM connections').get()).toEqual(
            { n: 1 }
        )
    })

    test('applies only the migrations past the current version', () => {
        const db = new Database(':memory:')
        migrate(db, ['CREATE TABLE a (x INTEGER)'])
        migrate(db, [
            'CREATE TABLE a (x INTEGER)',
            'ALTER TABLE a ADD COLUMN y INTEGER',
        ])
        expect(schemaVersion(db)).toBe(2)
        db.query('INSERT INTO a (x, y) VALUES (1, 2)').run()
    })

    test('rolls back every step of a failing run and keeps the version', () => {
        const db = new Database(':memory:')
        migrate(db, ['CREATE TABLE a (x INTEGER)'])

        expect(() =>
            migrate(db, [
                'CREATE TABLE a (x INTEGER)',
                'CREATE TABLE b (x INTEGER)',
                'ALTER TABLE missing ADD COLUMN y INTEGER',
            ])
        ).toThrow(/migration 3/)

        expect(schemaVersion(db)).toBe(1)
        expect(tables(db)).toEqual(['a'])
    })
})
