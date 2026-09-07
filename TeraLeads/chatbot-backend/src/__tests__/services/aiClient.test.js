jest.mock('../../utils/jwt', () => ({ generateToken: jest.fn(() => 'temporary-user-token') }))
const { sendMessage } = require('../../services/aiClient')

afterEach(() => jest.restoreAllMocks())

it('keeps service and user authorization in headers and reads booking metadata', async () => {
  process.env.AI_SERVICE_TOKEN = 'test-service-token'
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ response: 'Booked', metadata: { appointment_data: { id: 42 } } }),
  })
  const result = await sendMessage({ sessionId: '7', message: 'yes', userId: 1 })
  const options = fetch.mock.calls[0][1]
  expect(options.headers.Authorization).toBe('Bearer temporary-user-token')
  expect(options.headers['X-Service-Token']).toBe('test-service-token')
  expect(options.body).not.toContain('temporary-user-token')
  expect(options.body).not.toContain('test-service-token')
  expect(result.appointmentData).toEqual({ id: 42 })
})

it('fails explicitly when service authentication is missing', async () => {
  const token = process.env.AI_SERVICE_TOKEN
  delete process.env.AI_SERVICE_TOKEN
  try {
    await expect(sendMessage({ sessionId: '7', message: 'yes', userId: 1 })).rejects.toThrow(
      'AI_SERVICE_TOKEN'
    )
  } finally {
    process.env.AI_SERVICE_TOKEN = token
  }
})
