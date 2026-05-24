/**
 * HTTP route registrations for the Mastra service.
 *
 * Each route is a one-liner that wires a path + method to a handler exported
 * from `./handlers/` (Express-style controller). Add more routes here; keep
 * handler implementations out of this file.
 */
import { registerApiRoute } from '@mastra/core/server'
import { chatHandler } from './handlers/chat.handler'

export const chatRoute = registerApiRoute('/chat', {
  method: 'POST',
  handler: chatHandler,
})