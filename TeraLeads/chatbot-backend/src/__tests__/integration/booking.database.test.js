const crypto = require('node:crypto')
const pool = require('../../config/database')
const service = require('../../services/appointment.service')

const databaseTests = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip

databaseTests('booking constraints in PostgreSQL', () => {
  let userId
  beforeAll(async () => {
    const result = await pool.query(
      'INSERT INTO users (email,password,name) VALUES ($1,$2,$3) RETURNING id',
      [`booking-${crypto.randomUUID()}@example.test`, 'not-a-real-password', 'Booking test']
    )
    userId = result.rows[0].id
  })
  afterAll(async () => {
    if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId])
    await pool.end()
  })

  const book = (date, key, time = '10:00:00') =>
    service.createAppointment(userId, {
      date,
      time,
      duration_minutes: 60,
      service_type: 'Consultation',
      booking_request_id: key,
    })

  it('allows only one of two simultaneous overlapping requests', async () => {
    const outcomes = await Promise.allSettled([
      book('2098-01-10', crypto.randomUUID()),
      book('2098-01-10', crypto.randomUUID()),
    ])
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find((r) => r.status === 'rejected')
    expect(rejected.reason.statusCode).toBe(409)
    const count = await pool.query(
      'SELECT count(*)::int AS n FROM appointments WHERE user_id=$1 AND date=$2',
      [userId, '2098-01-10']
    )
    expect(count.rows[0].n).toBe(1)
  })

  it('returns one booking for concurrent retries and rejects a reused key with different data', async () => {
    const key = crypto.randomUUID()
    const [first, retry] = await Promise.all([book('2098-01-11', key), book('2098-01-11', key)])
    expect(first.id).toBe(retry.id)
    await expect(book('2098-01-11', key, '12:00:00')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('rejects overlapping reschedules and cancelled-to-active transitions', async () => {
    const first = await book('2098-01-12', crypto.randomUUID())
    const second = await book('2098-01-12', crypto.randomUUID(), '12:00:00')
    await expect(
      service.updateAppointment(second.id, userId, { time: '10:30:00' })
    ).rejects.toMatchObject({ statusCode: 409 })
    await service.cancelAppointment(first.id, userId)
    await service.updateAppointment(second.id, userId, { time: '10:30:00' })
    await expect(
      service.updateAppointment(first.id, userId, { status: 'confirmed' })
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})
