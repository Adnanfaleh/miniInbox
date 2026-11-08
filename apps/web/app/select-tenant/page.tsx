import { getTranslations } from 'next-intl/server';
import { TenantButtons } from '../../components/TenantButtons';
import { creatorSelectTenant } from '../../lib/actions';
import { requireCreator } from '../../lib/session';

/** DEV STAND-IN, NOT AUTHENTICATION: the Inboxes creator picks (and later switches) the tenant to open. */
export default async function SelectTenantPage() {
  await requireCreator();
  const t = await getTranslations('SelectTenant');
  return (
    <section className="pane narrow">
      <h1>{t('title')}</h1>
      <p className="muted">{t('intro')}</p>
      <TenantButtons action={creatorSelectTenant} />
    </section>
  );
}
