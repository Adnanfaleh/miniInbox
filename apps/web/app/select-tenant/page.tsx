import { getTranslations } from 'next-intl/server';
import { selectTenant } from '../../lib/actions';
import { api } from '../../lib/api';

/** DEV STAND-IN, NOT AUTHENTICATION: pick the tenant whose inbox to open. Replaced by staff login later. */
export default async function SelectTenantPage() {
  const t = await getTranslations('SelectTenant');
  const tenants = await api.devTenants().catch(() => null);
  return (
    <section className="pane narrow">
      <h1>{t('title')}</h1>
      <p className="muted">{t('intro')}</p>
      {tenants === null && <p className="error">{t('unavailable')}</p>}
      {tenants?.length === 0 && <p className="muted">{t('none')}</p>}
      <ul className="tenant-list">
        {tenants?.map((tenant) => (
          <li key={tenant.id}>
            <form action={selectTenant}>
              <input type="hidden" name="tenantId" value={tenant.id} />
              <button type="submit" className="tenant-choice">
                <bdi>{tenant.name}</bdi>
                <span className="muted small">{t('choose')}</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
