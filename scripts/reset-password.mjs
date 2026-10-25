import {resetPassword} from '../server/auth-core.mjs';
import {question} from './prompt.mjs';
const email = await question('Account email to reset: '),
  password = await question('New password (14+ characters, hidden): ', true),
  confirm = await question('Confirm new password (hidden): ', true);
if (password !== confirm) throw new Error('Passwords do not match.');
resetPassword(email, password);
console.log('Password reset; existing sessions revoked.');
