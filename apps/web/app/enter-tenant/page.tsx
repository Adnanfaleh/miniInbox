import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { TenantButtons } from '../../components/TenantButtons';
import { enterTenant } from '../../lib/actions';
import { requireNoSession } from '../../lib/session';

/** DEV STAND-IN, NOT AUTHENTICATION: "Select tenant" opens one tenant's dashboard and stays locked to it. */
export default async function EnterTenantPage() {
  await requireNoSession();
  const t = await getTranslations('EnterTenant');
  return (
    <section className="pane narrow">
      <h1>{t('title')}</h1>
      <p className="muted">{t('intro')}</p>
      <TenantButtons action={enterTenant} />
      <p className="small">
        <Link href="/start">{t('back')}</Link>
      </p>
    </section>
  );
}