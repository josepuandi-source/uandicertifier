import { me, safe } from '../server/auth.js';

export default safe(me);
