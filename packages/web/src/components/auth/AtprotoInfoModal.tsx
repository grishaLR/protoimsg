import { useRef, useEffect, useCallback } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import styles from './AtprotoInfoModal.module.css';

interface AtprotoInfoModalProps {
  onClose: () => void;
}

const BLACKSKY_PDS = {
  nameKey: 'atprotoInfo.pds.blacksky.name',
  url: 'https://blacksky.community',
  descriptionKey: 'atprotoInfo.pds.blacksky.description',
  warningKey: 'atprotoInfo.pds.blacksky.warning',
};

const OPEN_PDS_PROVIDERS = [
  {
    nameKey: 'atprotoInfo.pds.bsky.name',
    url: 'https://bsky.app',
    descriptionKey: 'atprotoInfo.pds.bsky.description',
  },
  {
    nameKey: 'atprotoInfo.pds.fedbridgy.name',
    url: 'https://fed.brid.gy',
    descriptionKey: 'atprotoInfo.pds.fedbridgy.description',
  },
];

const COMMUNITY_PDS_PROVIDERS = [
  BLACKSKY_PDS,
  {
    nameKey: 'atprotoInfo.pds.myatproto.name',
    url: 'https://blacksky.community',
    descriptionKey: 'atprotoInfo.pds.myatproto.description',
  },
  {
    nameKey: 'atprotoInfo.pds.transrights.name',
    url: 'https://northsky.social',
    descriptionKey: 'atprotoInfo.pds.transrights.description',
  },
  {
    nameKey: 'atprotoInfo.pds.witchcraft.name',
    url: 'https://witchcraft.systems',
    descriptionKey: 'atprotoInfo.pds.witchcraft.description',
  },
  {
    nameKey: 'atprotoInfo.pds.selfhosted.name',
    url: 'https://selfhosted.social',
    descriptionKey: 'atprotoInfo.pds.selfhosted.description',
  },
];

export function AtprotoInfoModal({ onClose }: AtprotoInfoModalProps) {
  const { t } = useTranslation('auth');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    previousActiveRef.current = document.activeElement as HTMLElement | null;
    el.showModal();
  }, []);

  const handleClose = useCallback(() => {
    previousActiveRef.current?.focus();
    onClose();
  }, [onClose]);

  return (
    <dialog ref={dialogRef} className={styles.dialog} onClose={handleClose}>
      <div className={styles.titleBar}>{t('atprotoInfo.title')}</div>
      <div className={styles.content}>
        <section className={styles.section}>
          <h3 className={styles.heading}>{t('atprotoInfo.shortVersion.heading')}</h3>
          <p className={styles.text}>
            <Trans
              i18nKey="atprotoInfo.shortVersion.p1"
              ns="auth"
              components={{ strong: <strong /> }}
            />
          </p>
          <p className={styles.text}>
            {t('atprotoInfo.shortVersion.p2prefix')}
            <a
              className={styles.link}
              href="https://bsky.social/about/blog/02-22-2024-open-social-web"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('atprotoInfo.shortVersion.blogLinkText')}
            </a>
            {t('atprotoInfo.shortVersion.p2suffix')}
          </p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.heading}>{t('atprotoInfo.whyItMatters.heading')}</h3>
          <ul className={styles.list}>
            <li>
              <strong>{t('atprotoInfo.whyItMatters.ownIdentity.strong')}</strong>
              {t('atprotoInfo.whyItMatters.ownIdentity.text')}
            </li>
            <li>
              <strong>{t('atprotoInfo.whyItMatters.noLockIn.strong')}</strong>
              {t('atprotoInfo.whyItMatters.noLockIn.text')}
            </li>
            <li>
              <strong>{t('atprotoInfo.whyItMatters.openSource.strong')}</strong>
              {t('atprotoInfo.whyItMatters.openSource.text')}
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h3 className={styles.heading}>{t('atprotoInfo.createAccount.heading')}</h3>
          <p className={styles.text}>{t('atprotoInfo.createAccount.text')}</p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.heading}>{t('atprotoInfo.communityPds.heading')}</h3>
          <div className={styles.providers}>
            {COMMUNITY_PDS_PROVIDERS.map((provider) => (
              <a
                key={provider.nameKey}
                className={styles.providerCard}
                href={provider.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className={styles.providerName}>
                  {t(provider.nameKey as 'atprotoInfo.pds.bsky.name')}
                </span>
                <span className={styles.providerDesc}>
                  {t(provider.descriptionKey as 'atprotoInfo.pds.bsky.description')}
                </span>
              </a>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.heading}>{t('atprotoInfo.otherPds.heading')}</h3>
          <div className={styles.providers}>
            {OPEN_PDS_PROVIDERS.map((provider) => (
              <a
                key={provider.nameKey}
                className={styles.providerCard}
                href={provider.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className={styles.providerName}>
                  {t(provider.nameKey as 'atprotoInfo.pds.bsky.name')}
                </span>
                <span className={styles.providerDesc}>
                  {t(provider.descriptionKey as 'atprotoInfo.pds.bsky.description')}
                </span>
              </a>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <p className={styles.text}>{t('atprotoInfo.disclaimer')}</p>
        </section>

        <p className={styles.text}>
          <Trans i18nKey="atprotoInfo.signInHint" ns="auth" components={{ strong: <strong /> }} />
        </p>

        <button
          className={styles.closeButton}
          type="button"
          onClick={() => {
            dialogRef.current?.close();
          }}
        >
          {t('atprotoInfo.close')}
        </button>
      </div>
    </dialog>
  );
}
