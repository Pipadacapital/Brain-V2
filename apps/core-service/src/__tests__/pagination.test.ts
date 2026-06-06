import { describe, it, expect } from 'vitest'
import {
  boundedOffset,
  MAX_OFFSET,
  encodeCursor,
  decodeCursor,
  keysetPredicate,
} from '../application/shared/pagination.js'

describe('cursor encode/decode round-trip', () => {
  it('round-trips a non-null sort value + id', () => {
    const c = encodeCursor({ v: '2024-01-15 10:30:45.123456+00', id: 'a1b2' })
    expect(decodeCursor(c)).toEqual({ v: '2024-01-15 10:30:45.123456+00', id: 'a1b2' })
  })

  it('round-trips a null sort value (NULLS-LAST section)', () => {
    const c = encodeCursor({ v: null, id: 'x9' })
    expect(decodeCursor(c)).toEqual({ v: null, id: 'x9' })
  })

  it('returns null for absent / empty input (first page)', () => {
    expect(decodeCursor(undefined)).toBeNull()
    expect(decodeCursor(null)).toBeNull()
    expect(decodeCursor('')).toBeNull()
  })

  it('returns null (not throw) for malformed cursors', () => {
    expect(decodeCursor('not-base64-$$$')).toBeNull()
    expect(decodeCursor(Buffer.from('{"nope":1}').toString('base64url'))).toBeNull()
    expect(decodeCursor(Buffer.from('garbage').toString('base64url'))).toBeNull()
  })
})

describe('keysetPredicate', () => {
  it('DESC + non-null cursor: includes nulls + rows past the cursor', () => {
    const args: unknown[] = []
    const sql = keysetPredicate('processed_at', 'DESC', { v: '2024-01-01', id: 'o1' }, args, { valueCast: '::timestamptz' })
    expect(sql).toBe(
      '(processed_at IS NULL OR processed_at < $1::timestamptz OR (processed_at = $1::timestamptz AND id < $2::uuid))',
    )
    expect(args).toEqual(['2024-01-01', 'o1'])
  })

  it('DESC + null cursor: only further null rows by id', () => {
    const args: unknown[] = []
    const sql = keysetPredicate('last_seen_at', 'DESC', { v: null, id: 'c7' }, args, { valueCast: '::timestamptz' })
    expect(sql).toBe('(last_seen_at IS NULL AND id < $1::uuid)')
    expect(args).toEqual(['c7'])
  })

  it('ASC + non-null cursor: rows past the cursor + nulls last', () => {
    const args: unknown[] = []
    const sql = keysetPredicate('title', 'ASC', { v: 'Apple', id: 'p1' }, args)
    expect(sql).toBe('(title IS NULL OR title > $1 OR (title = $1 AND id > $2::uuid))')
    expect(args).toEqual(['Apple', 'p1'])
  })

  it('honours pre-existing args (placeholder offset)', () => {
    const args: unknown[] = ['%search%', 'paid']  // two filter binds already pushed
    const sql = keysetPredicate('processed_at', 'DESC', { v: '2024-01-01', id: 'o1' }, args, { valueCast: '::timestamptz' })
    expect(sql).toContain('$3::timestamptz')   // value bind is #3
    expect(sql).toContain('id < $4::uuid')     // id bind is #4
    expect(args).toEqual(['%search%', 'paid', '2024-01-01', 'o1'])
  })
})

describe('boundedOffset (retained for the ratified COGS bounded cap)', () => {
  it('returns the raw offset under the cap', () => {
    expect(boundedOffset(2, 25)).toEqual({ offset: 25, capped: false })
  })
  it('caps + flags pages beyond MAX_OFFSET', () => {
    const r = boundedOffset(10_000, 25)
    expect(r.capped).toBe(true)
    expect(r.offset).toBe(MAX_OFFSET)
  })
})
