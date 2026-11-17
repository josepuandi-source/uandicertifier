// Usage: npm run pin -- <id> <4-digit pin>
// Prints the PIN_<ID> value to store as a Vercel environment variable.
import { hashPin } from '../server/auth.js';
import { certifierById } from '../src/certifiers.js';

const [id, pin] = process.argv.slice(2);
if (!certifierById(id) || !/^\d{4}$/.test(pin || '')) {
  console.error('Usage: npm run pin -- <jose|gaselle|suzzy|lillian> <4-digit pin>');
  process.exit(1);
}
console.log(`PIN_${id.toUpperCase()}=${hashPin(pin)}`);
