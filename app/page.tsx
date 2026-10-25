import {redirect} from 'next/navigation';
import {signedIn} from '@/server/auth';
import Books from './books';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const user = await signedIn();
  if (!user) redirect('/login');
  return <Books displayName={user.name} accessRole={user.role} businessName={user.businessName} />;
}
