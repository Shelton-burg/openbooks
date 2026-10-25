import {bootstrap} from '../server/auth-core.mjs';
import {question} from './prompt.mjs';
const email = await question('Owner email: '),
  name = await question('Owner name: '),
  business = await question('Business name: '),
  password = await question('Password (14+ characters, hidden): ', true),
  confirm = await question('Confirm password (hidden): ', true);
if (password !== confirm) throw new Error('Passwords do not match.');
bootstrap({email, name, business, password});
console.log('Owner and business created. Start the app and sign in. No email was sent.');
