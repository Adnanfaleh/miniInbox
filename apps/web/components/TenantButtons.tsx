import { getTranslations } from 'next-intl/server';
import { api } from '../lib/api';

/**
 * DEV STAND-IN: one button per tenant (names from the API's development tenant list). The form posts to the given
 * server action, which re-checks the role and the tenant on the server before storing anything.
 */
export async function TenantButtons({ action }: { action: (formData: FormData) => Promise<void> }) {
  const t = await getTranslations('SelectTenant');
  const tenants = await api.devTenants().catch(() => null);
  return (
    <>
      {tenants === null && <p className="error">{t('unavailable')}</p>}
      {tenants?.length === 0 && <p className="muted">{t('none')}</p>}
      <ul className="tenant-list">
        {tenants?.map((tenant) => (
          <li key={tenant.id}>
            <form action={action}>
              <input type="hidden" name="tenantId" value={tenant.id} />
              <button type="submit" className="tenant-choice">
                <bdi>{tenant.name}</bdi>
                <span className="muted small">{t('choose')}</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </>
  );
}
