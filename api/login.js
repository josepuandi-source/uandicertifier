import { login, safe } from '../server/auth.js';

export default safe(login);
