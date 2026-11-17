import { logout, safe } from '../server/auth.js';

export default safe(logout);
