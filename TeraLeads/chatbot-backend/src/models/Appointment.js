const pool = require('../config/database')

const ALLOWED_UPDATE_FIELDS = [
  'date',
  'time',
  'duration_minutes',
  'service_type',
  'status',
  'notes',
]

class Appointment {
  static async create({
    user_id,
    business_id,
    booking_request_id = null,
    date,
    time,
    duration_minutes = 60,
    service_type,
    status = 'pending',
    notes,
  }) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      if (booking_request_id) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `booking:${user_id}:${booking_request_id}`,
        ])
        const previous = await client.query(
          `
          SELECT *, (date = $3::date AND time = $4::time
            AND duration_minutes = $5
            AND service_type IS NOT DISTINCT FROM $6::varchar
            AND business_id IS NOT DISTINCT FROM $7::integer
            AND notes IS NOT DISTINCT FROM $8::text) AS same_request
          FROM appointments WHERE user_id = $1 AND booking_request_id = $2
        `,
          [
            user_id,
            booking_request_id,
            date,
            time,
            duration_minutes,
            service_type || null,
            business_id || null,
            notes || null,
          ]
        )
        if (previous.rows.length) {
          if (!previous.rows[0].same_request) {
            const error = new Error(
              'Booking key was already used for different appointment details'
            )
            error.code = 'IDEMPOTENCY_CONFLICT'
            throw error
          }
          const { same_request, ...appointment } = previous.rows[0]
          await client.query('COMMIT')
          return appointment
        }
      }
      const result = await client.query(
        `
        INSERT INTO appointments
          (user_id, business_id, date, time, duration_minutes, service_type, status, notes, booking_request_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
      `,
        [
          user_id,
          business_id || null,
          date,
          time,
          duration_minutes,
          service_type || null,
          status,
          notes || null,
          booking_request_id,
        ]
      )
      await client.query('COMMIT')
      return result.rows[0]
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  static async findById(id) {
    const query = 'SELECT * FROM appointments WHERE id = $1'
    const result = await pool.query(query, [id])
    return result.rows[0] || null
  }

  static async findByUserId(userId, businessId = null) {
    let query = 'SELECT * FROM appointments WHERE user_id = $1'
    const params = [userId]
    if (businessId) {
      query += ' AND business_id = $2'
      params.push(businessId)
    }
    query += ' ORDER BY date, time'
    const result = await pool.query(query, params)
    return result.rows
  }

  static async findByDateAndStatus(date, statuses = ['pending', 'confirmed']) {
    const placeholders = statuses.map((_, i) => `$${i + 2}`).join(', ')
    const query = `
      SELECT * FROM appointments
      WHERE date = $1 AND status IN (${placeholders})
      ORDER BY time
    `
    const result = await pool.query(query, [date, ...statuses])
    return result.rows
  }

  static async update(id, updateData) {
    const filtered = {}
    Object.keys(updateData).forEach((key) => {
      if (ALLOWED_UPDATE_FIELDS.includes(key)) {
        filtered[key] = updateData[key]
      }
    })
    if (Object.keys(filtered).length === 0) {
      return (await this.findById(id)) || null
    }
    const fields = []
    const values = []
    let paramCount = 1
    Object.keys(filtered).forEach((key) => {
      fields.push(`${key} = $${paramCount}`)
      values.push(filtered[key])
      paramCount++
    })
    values.push(id)
    const query = `
      UPDATE appointments
      SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${paramCount}
      RETURNING *
    `
    const result = await pool.query(query, values)
    return result.rows[0]
  }
}

module.exports = Appointment
