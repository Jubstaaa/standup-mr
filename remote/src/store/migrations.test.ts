import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Database } from 'bun:sqlite'
import { describe, expect, spyOn, test } from 'bun:test'

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
        migrate(db, MIGRATIONS.slice(0, 1))
        db.exec('PRAGMA user_version = 0')
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

    test('rebuilding a parent table keeps the rows that reference it', () => {
        const db = new Database(':memory:')
        db.exec('PRAGMA foreign_keys = ON')
        migrate(db, [
            `CREATE TABLE parent (id TEXT PRIMARY KEY);
             CREATE TABLE child (id TEXT, parent_id TEXT REFERENCES parent(id) ON DELETE CASCADE);
             INSERT INTO parent VALUES ('p'); INSERT INTO child VALUES ('c', 'p');`,
        ])

        migrate(db, [
            `CREATE TABLE parent (id TEXT PRIMARY KEY);
             CREATE TABLE child (id TEXT, parent_id TEXT REFERENCES parent(id) ON DELETE CASCADE);
             INSERT INTO parent VALUES ('p'); INSERT INTO child VALUES ('c', 'p');`,
            `CREATE TABLE parent_new (id TEXT PRIMARY KEY, extra TEXT);
             INSERT INTO parent_new (id) SELECT id FROM parent;
             DROP TABLE parent;
             ALTER TABLE parent_new RENAME TO parent;`,
        ])

        expect(db.query('SELECT id FROM child').all()).toEqual([{ id: 'c' }])
        expect(
            db.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get()
        ).toEqual({ foreign_keys: 1 })
    })

    test('refuses a migration that leaves a dangling reference', () => {
        const db = new Database(':memory:')
        migrate(db, [
            `CREATE TABLE parent (id TEXT PRIMARY KEY);
             CREATE TABLE child (id TEXT, parent_id TEXT REFERENCES parent(id));`,
        ])
        expect(() =>
            migrate(db, [
                'SELECT 1',
                "INSERT INTO child VALUES ('c', 'missing')",
            ])
        ).toThrow(/foreign key: child row 1 -> parent/)
        expect(schemaVersion(db)).toBe(1)
        expect(db.query('SELECT * FROM child').all()).toEqual([])
    })

    test('leaves a database a newer release migrated untouched', () => {
        const db = new Database(':memory:')
        migrate(db, MIGRATIONS)
        db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`)
        migrate(db, MIGRATIONS)
        expect(schemaVersion(db)).toBe(MIGRATIONS.length + 1)
    })

    test('hands a shared instance to each connection signed in with it', () => {
        const db = new Database(':memory:')
        migrate(db, MIGRATIONS.slice(0, 1))
        db.exec(`
            INSERT INTO connections (id, created_at, last_used_at) VALUES
                ('alice', 1, 1), ('bob', 1, 1), ('carol', 1, 1);
            INSERT INTO accounts (id, connection_id, provider, host, username, source, access_token)
            VALUES ('a', 'alice', 'gitlab', 'git.example.com', 'alice', 'oauth', 't'),
                   ('b', 'bob', 'gitlab', 'git.example.com', 'bob', 'oauth', 't'),
                   ('c', 'carol', 'gitlab', 'git.example.com', 'carol', 'pat', 't');
            INSERT INTO instances (kind, host, client_id, client_secret, created_at, verified_at)
            VALUES ('gitlab', 'git.example.com', 'shared', 'sealed', 1, 2),
                   ('gitlab', 'unused.example.com', 'idle', 'sealed', 1, NULL);
        `)

        const logged = spyOn(console, 'error').mockImplementation(() => {})
        try {
            migrate(db, MIGRATIONS)
            expect(String(logged.mock.calls[0])).toContain(
                'dropped 1 self-hosted OAuth app'
            )
        } finally {
            logged.mockRestore()
        }

        expect(
            db
                .query(
                    'SELECT connection_id, host, client_id, verified_at FROM instances ORDER BY connection_id'
                )
                .all()
        ).toEqual([
            {
                connection_id: 'alice',
                host: 'git.example.com',
                client_id: 'shared',
                verified_at: 2,
            },
            {
                connection_id: 'bob',
                host: 'git.example.com',
                client_id: 'shared',
                verified_at: 2,
            },
        ])
        expect(db.query('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({
            n: 3,
        })
    })

    test('does not check references when no migration ran', () => {
        const db = new Database(':memory:')
        db.exec(`CREATE TABLE parent (id TEXT PRIMARY KEY);
                 CREATE TABLE child (id TEXT, parent_id TEXT REFERENCES parent(id));
                 INSERT INTO child VALUES ('c', 'missing');`)
        expect(() => migrate(db, [])).not.toThrow()
    })

    test('says when it cannot lock the database', () => {
        const dir = mkdtempSync(join(tmpdir(), 'standup-lock-'))
        const path = join(dir, 'db')
        const holder = new Database(path, { create: true })
        const waiting = new Database(path)
        try {
            holder.exec('BEGIN IMMEDIATE')
            expect(() => migrate(waiting, ['CREATE TABLE a (x)'])).toThrow(
                /lock the database/
            )
        } finally {
            holder.exec('ROLLBACK')
            holder.close()
            waiting.close()
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
