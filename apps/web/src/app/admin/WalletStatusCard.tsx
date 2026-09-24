import 'server-only';
import { X509Certificate } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatNumber } from '@/lib/format';
import admin from './admin.module.css';
import styles from './wallet-status.module.css';

/**
 * CARTE « PASSES WALLET » de la salle de contrôle.
 *
 * Côté client, un fournisseur Wallet qui n'est pas prêt n'affiche RIEN :
 * ni bouton grisé, ni mention. C'est voulu (aucune fausse
 * fonctionnalité), mais cela rend une panne silencieuse. Cette carte est
 * donc le seul endroit qui dit, pour Apple et pour Google :
 *   - non configuré (quelles variables manquent),
 *   - prêt,
 *   - erreur de configuration, avec la raison exacte du fournisseur ;
 * plus ce qui s'use ou se bascule : l'échéance du certificat Apple
 * (alerte à J-30, il se renouvelle chaque année) et le mode Google
 * (démo : bouton pour les membres connectés, enregistrement réservé aux
 * comptes de test ; production : tout le monde).
 *
 * Aucune valeur secrète n'est lue pour l'affichage : seulement la
 * présence des variables, et la date de fin du certificat public.
 */

export type WalletProviderId = 'apple' | 'google';

/** Même forme que ProviderStatus (server/wallet/types.ts, contrat § 3.1 du plan Wallet). */
export interface WalletProviderStatus {
  ready: boolean;
  reason: string | null;
  details?: Record<string, unknown>;
}

export type WalletState = 'unconfigured' | 'ready' | 'error';

interface ProviderCard {
  id: WalletProviderId;
  state: WalletState;
  reason: string | null;
  /** Variables à renseigner (noms seulement), quand rien n'est configuré. */
  missing: string[];
  /** Variables présentes, mais registre des fournisseurs pas encore branché. */
  awaitingCode: boolean;
  activePasses: number | null;
  alerts24h: number | null;
  dead7d: number | null;
}

export interface WalletCardData {
  /** L'exploitant a commencé la configuration (ou des passes existent) : carte dépliée. */
  engaged: boolean;
  apple: ProviderCard & { cert: { expiresAt: string; daysLeft: number } | null };
  google: ProviderCard & { mode: 'demo' | 'production' | null };
}

/* ====================================================================
   Branchement au registre des fournisseurs
   ==================================================================== */

/**
 * État des fournisseurs, lu dans le registre du socle Wallet
 * (server/wallet/providers.ts → walletStatuses(), mis en cache 5 min).
 * Import dynamique : la page d'accueil de /admin ne charge le code Wallet
 * que lorsqu'elle s'affiche. Le drapeau reste exporté pour le garde-fou de
 * tests/admin-wallet-card.test.ts.
 */
export const WALLET_REGISTRY_WIRED = true;

async function readWalletStatuses(): Promise<Record<WalletProviderId, WalletProviderStatus> | null> {
  const { walletStatuses } = await import('@/server/wallet/providers');
  return walletStatuses();
}

/* ====================================================================
   Lecture (fonctions pures : l'environnement est passé en paramètre
   pour être testées sans toucher à process.env)
   ==================================================================== */

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Variables présentes. Lues directement dans l'environnement plutôt que
 * dans lib/env.ts : ce dernier appartient au socle Wallet (lot W1) et
 * gagnera `integrationStatus().appleWalletConfigured` /
 * `googleWalletConfigured`, qui disent la même chose. Seule la PRÉSENCE
 * est testée ici.
 */
const REQUIRED_ENV: Record<WalletProviderId, readonly string[]> = {
  apple: [
    'APPLE_WALLET_PASS_TYPE_ID',
    'APPLE_WALLET_CERT_PEM',
    'APPLE_WALLET_KEY_PEM',
    'APPLE_WALLET_WWDR_PEM',
  ],
  google: ['GOOGLE_WALLET_ISSUER_ID', 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON'],
};

function missingEnv(id: WalletProviderId, env: Env): string[] {
  return REQUIRED_ENV[id].filter((name) => !env[name]?.trim());
}

/** Au moins une variable renseignée : l'exploitant a commencé la configuration. */
export function touched(id: WalletProviderId, env: Env = process.env): boolean {
  return missingEnv(id, env).length < REQUIRED_ENV[id].length;
}

export function classify(
  id: WalletProviderId,
  status: WalletProviderStatus | undefined,
  env: Env = process.env,
): Pick<ProviderCard, 'state' | 'reason' | 'missing' | 'awaitingCode'> {
  const missing = missingEnv(id, env);
  if (status?.ready) return { state: 'ready', reason: null, missing: [], awaitingCode: false };
  // Registre absent : « non configuré », même si les variables sont là.
  if (!status) {
    return { state: 'unconfigured', reason: null, missing, awaitingCode: missing.length === 0 };
  }
  // Rien de renseigné : pas une erreur, un choix (Wallet est facultatif).
  if (!touched(id, env)) return { state: 'unconfigured', reason: null, missing, awaitingCode: false };
  return {
    state: 'error',
    reason: status.reason?.trim()
      || (missing.length > 0 ? 'Variables manquantes : ' + missing.join(', ') : 'raison non précisée'),
    missing,
    awaitingCode: false,
  };
}

/** Date ISO (ou Date) lue dans `details`, sous l'un des noms usuels. */
function detailDate(details: Record<string, unknown> | undefined, keys: string[]): Date | null {
  for (const key of keys) {
    const value = details?.[key];
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  return null;
}

/**
 * Fin de validité du certificat Pass Type ID. Le fournisseur Apple la
 * donne normalement dans `details` ; à défaut, on la lit dans le
 * certificat PUBLIC (jamais dans la clé), pour que l'alerte à J-30
 * existe même quand le fournisseur est en erreur, par exemple parce
 * que le certificat vient justement d'expirer. Deux écritures acceptées,
 * comme côté fournisseur : PEM (éventuellement avec des `\n` littéraux,
 * forme d'une ligne .env) ou PEM encodé en base64.
 */
export function appleCertExpiry(
  details: Record<string, unknown> | undefined,
  env: Env = process.env,
): Date | null {
  const fromProvider = detailDate(details, ['certExpiresAt', 'expiresAt', 'notAfter']);
  if (fromProvider) return fromProvider;
  const raw = env.APPLE_WALLET_CERT_PEM?.trim();
  if (!raw) return null;
  try {
    const pem = raw.includes('BEGIN CERTIFICATE')
      ? raw.replace(/\\n/g, '\n')
      : Buffer.from(raw, 'base64').toString('utf8');
    if (!pem.includes('BEGIN CERTIFICATE')) return null;
    const date = new Date(new X509Certificate(pem).validTo);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null; // Certificat illisible : le fournisseur le dira dans sa raison.
  }
}

/**
 * Mode de l'émetteur Google. Tout ce qui n'est pas exactement
 * « production » vaut démo : c'est le mode sans risque (bouton réservé
 * aux membres, passes « [TEST ONLY] »), jamais l'inverse.
 */
export function googleMode(
  details: Record<string, unknown> | undefined,
  env: Env = process.env,
): 'demo' | 'production' {
  const value = String(details?.mode ?? env.GOOGLE_WALLET_MODE ?? '').trim().toLowerCase();
  return value === 'production' ? 'production' : 'demo';
}

/** Jours pleins restants avant `expiry` (négatif une fois passée). */
export function daysUntil(expiry: Date, now: Date): number {
  return Math.floor((expiry.getTime() - now.getTime()) / 86_400_000);
}

/** Un compte qui échoue (table absente d'une base pas encore migrée…) vaut « — », pas 0. */
async function countOrNull(
  query: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number | null> {
  try {
    const { count, error } = await query;
    return error ? null : (count ?? 0);
  } catch {
    return null;
  }
}

export async function loadWalletCard(db: SupabaseClient, now = new Date()): Promise<WalletCardData> {
  const since24h = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const statuses = await readWalletStatuses().catch(() => null);

  const counts = (provider: WalletProviderId) => Promise.all([
    // « Actif » : détenu par le fournisseur (appareil inscrit, objet
    // créé chez Google) et encore tenu à jour.
    countOrNull(db.from('wallet_passes').select('id', { count: 'exact', head: true })
      .eq('provider', provider).eq('state', 'active').eq('live', true)),
    // Alertes réellement acceptées par Apple ou Google (plan § 5.7).
    // Filtre sur created_at, pas sent_at : l'index existant est
    // (status, created_at desc), et sent_at n'est indexé nulle part —
    // on éviterait sinon de parcourir 30 jours de lignes « sent » à
    // chaque affichage. Une alerte Wallet part dans la minute de sa
    // création (cron) : l'écart entre les deux dates est négligeable.
    countOrNull(db.from('notification_deliveries').select('id', { count: 'exact', head: true })
      .eq('status', 'sent').gte('created_at', since24h)
      .eq('channel', provider === 'apple' ? 'apple_wallet' : 'google_wallet')),
    // Envois abandonnés ; la purge les efface après 7 jours.
    countOrNull(db.from('wallet_outbox').select('id', { count: 'exact', head: true })
      .eq('provider', provider).eq('status', 'dead')),
  ]);

  const [[appleActive, appleAlerts, appleDead], [googleActive, googleAlerts, googleDead]] =
    await Promise.all([counts('apple'), counts('google')]);

  const appleStatus = statuses?.apple;
  const googleStatus = statuses?.google;
  const apple = classify('apple', appleStatus);
  const google = classify('google', googleStatus);

  const expiry = apple.state === 'unconfigured' && !apple.awaitingCode ? null : appleCertExpiry(appleStatus?.details);

  return {
    // Replier la carte tant que l'exploitant n'a rien entrepris : Wallet
    // est facultatif, et une carte « 0/2 » de 800 px sur téléphone
    // repousserait la vraie exploitation (files, écrans) sans rien dire
    // d'utile. Dès qu'une variable est posée, ou qu'un pass existe, elle
    // se déplie d'elle-même : une panne ne doit jamais être repliée.
    engaged:
      touched('apple') || touched('google')
      || apple.state !== 'unconfigured' || google.state !== 'unconfigured'
      || (appleActive ?? 0) > 0 || (googleActive ?? 0) > 0,
    apple: {
      id: 'apple',
      ...apple,
      activePasses: appleActive,
      alerts24h: appleAlerts,
      dead7d: appleDead,
      cert: expiry ? { expiresAt: expiry.toISOString(), daysLeft: daysUntil(expiry, now) } : null,
    },
    google: {
      id: 'google',
      ...google,
      activePasses: googleActive,
      alerts24h: googleAlerts,
      dead7d: googleDead,
      mode: touched('google') ? googleMode(googleStatus?.details) : null,
    },
  };
}

/* ====================================================================
   Affichage
   ==================================================================== */

const STATE_LABEL: Record<WalletState, string> = {
  unconfigured: 'Non configuré',
  ready: 'Prêt',
  error: 'Erreur de configuration',
};

const PROVIDER_META: Record<WalletProviderId, { name: string; device: string; hidden: string }> = {
  apple: {
    name: 'Apple Wallet',
    device: 'iPhone · pass signé, mis à jour par APNs',
    hidden: 'Aucun bouton Apple Wallet n’est proposé aux clients.',
  },
  google: {
    name: 'Google Wallet',
    device: 'Android · objet tenu à jour par l’API Google',
    hidden: 'Aucun bouton Google Wallet n’est proposé aux clients.',
  },
};

/** Fenêtre de la jauge : un certificat Pass Type ID vaut un an. */
const CERT_WINDOW_DAYS = 365;
const CERT_WARN_DAYS = 30;

const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
});

export function WalletStatusCard({ data }: { data: WalletCardData }) {
  const ready = [data.apple, data.google].filter((p) => p.state === 'ready').length;
  const errors = [data.apple, data.google].filter((p) => p.state === 'error').length;
  const certWarn = data.apple.cert !== null && data.apple.cert.daysLeft <= CERT_WARN_DAYS;
  const chip = (
    <span className={errors > 0 || certWarn ? 'chip chip--copper' : ready > 0 ? 'chip chip--jade' : 'chip'}>
      {ready}/2 {ready > 1 ? 'prêts' : 'prêt'}
    </span>
  );
  const tickets = (
    <div className={styles.grid}>
      <ProviderTicket provider={data.apple} index={0}>
        {data.apple.cert && <CertGauge cert={data.apple.cert} />}
      </ProviderTicket>
      <ProviderTicket provider={data.google} index={1}>
        {data.google.mode && <ModeSwitch mode={data.google.mode} state={data.google.state} />}
      </ProviderTicket>
    </div>
  );

  // Rien d'entrepris : une seule ligne, dépliable (sans JavaScript) pour
  // lire ce qu'il faudrait renseigner.
  if (!data.engaged) {
    return (
      <details className={`${admin.adminCard} ${styles.card} ${styles.folded}`}>
        <summary className={styles.summary}>
          <span className={admin.cardKicker}>PASSES WALLET</span>
          <span className={styles.summaryText}>
            <strong>Apple Wallet et Google Wallet</strong>
            <span>Non configurés · aucun bouton côté client · SETUP.md&nbsp;§&nbsp;18</span>
          </span>
          {chip}
          <span className={styles.chevron} aria-hidden="true" />
        </summary>
        <div className={styles.foldedBody}>{tickets}</div>
      </details>
    );
  }

  return (
    <section className={`${admin.adminCard} ${styles.card}`} aria-labelledby="wallet-titre">
      <div className={admin.adminCardHead}>
        <div>
          <span className={admin.cardKicker}>PASSES WALLET</span>
          <h2 id="wallet-titre">Apple Wallet et Google Wallet</h2>
          <p className={styles.lead}>
            Un fournisseur qui n’est pas prêt n’affiche aucun bouton côté client.
            La raison exacte n’apparaît qu’ici.
          </p>
        </div>
        {chip}
      </div>
      {tickets}
    </section>
  );
}

function ProviderTicket({
  provider, index, children,
}: {
  provider: ProviderCard;
  index: number;
  children?: React.ReactNode;
}) {
  const meta = PROVIDER_META[provider.id];
  const showMetrics = provider.state !== 'unconfigured' || (provider.activePasses ?? 0) > 0;

  return (
    <article
      className={styles.ticket}
      data-state={provider.state}
      style={{ '--i': index } as React.CSSProperties}
      aria-label={`${meta.name} : ${STATE_LABEL[provider.state]}`}
    >
      <header className={styles.stub}>
        <div className={styles.stubText}>
          <h3>{meta.name}</h3>
          <p>{meta.device}</p>
        </div>
        <span className={styles.state} data-state={provider.state}>
          <i aria-hidden="true" />
          {STATE_LABEL[provider.state]}
        </span>
      </header>

      <div className={styles.perforation} aria-hidden="true"><i /></div>

      <div className={styles.body}>
        {provider.state === 'error' && (
          <div className={styles.reason} role="note">
            <span>Raison</span>
            <p>{provider.reason}</p>
          </div>
        )}

        {provider.state === 'unconfigured' && (
          <div className={styles.setup}>
            <p>{meta.hidden}</p>
            {provider.awaitingCode ? (
              <p className={styles.setupHint}>
                Variables présentes : l’intégration n’est pas encore branchée dans cette version.
              </p>
            ) : provider.missing.length > 0 ? (
              <>
                <p className={styles.setupHint}>À renseigner dans le fichier .env du serveur :</p>
                <ul className={styles.vars}>
                  {provider.missing.map((name) => <li key={name}><code>{name}</code></li>)}
                </ul>
              </>
            ) : null}
            <p className={styles.setupHint}>Mode d’emploi : SETUP.md, section 18.</p>
          </div>
        )}

        {showMetrics && (
          <div className={styles.metrics}>
            <div className={styles.hero}>
              <strong className="t-num">{metric(provider.activePasses)}</strong>
              <span>
                {(provider.activePasses ?? 0) <= 1 ? 'pass actif' : 'passes actifs'}
                <small>dans un Wallet, tenus à jour</small>
              </span>
            </div>
            <ol className={styles.slats}>
              <li>
                <span>Alertes · 24 h</span>
                <strong className="t-num">{metric(provider.alerts24h)}</strong>
              </li>
              <li data-alert={(provider.dead7d ?? 0) > 0 ? 'true' : undefined}>
                <span>Envois abandonnés · 7 j</span>
                <strong className="t-num">{metric(provider.dead7d)}</strong>
              </li>
            </ol>
          </div>
        )}

        {children}
      </div>
    </article>
  );
}

function metric(value: number | null): string {
  return value === null ? '—' : formatNumber(value);
}

function CertGauge({ cert }: { cert: { expiresAt: string; daysLeft: number } }) {
  const { daysLeft } = cert;
  const tone = daysLeft < 0 ? 'expired' : daysLeft <= CERT_WARN_DAYS ? 'warn' : 'ok';
  const ratio = Math.min(1, Math.max(0, daysLeft / CERT_WINDOW_DAYS));
  const date = dateFormat.format(new Date(cert.expiresAt));
  const sentence = daysLeft < 0
    ? `Expiré depuis ${formatNumber(-daysLeft)} jour${-daysLeft > 1 ? 's' : ''}`
    : daysLeft === 0
      ? 'Expire aujourd’hui'
      : `Encore ${formatNumber(daysLeft)} jour${daysLeft > 1 ? 's' : ''}`;

  return (
    <div className={styles.cert} data-tone={tone}>
      <div className={styles.certHead}>
        <span>Certificat Pass Type ID</span>
        <strong>{daysLeft < 0 ? 'expiré le ' : 'expire le '}{date}</strong>
      </div>
      <div
        className={styles.gauge}
        role="img"
        aria-label={`${sentence}. Alerte à 30 jours de l’échéance.`}
        style={{ '--ratio': ratio, '--warn': CERT_WARN_DAYS / CERT_WINDOW_DAYS } as React.CSSProperties}
      >
        <span className={styles.gaugeWarn} />
        <span className={styles.gaugeFill} />
        <span className={styles.gaugeMark}><i>J-30</i></span>
      </div>
      <p className={styles.certFoot}>
        <span>{sentence}</span>
        {tone !== 'ok' && (
          <span className={styles.certAction}>
            {tone === 'expired'
              ? 'Aucun pass Apple ne peut être signé : renouvelez le certificat.'
              : 'À renouveler dans le portail Apple Developer.'}
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * Mode Google. Le mode vient d'une variable (.env), pas d'un accord
 * vérifié auprès de Google : on ne dit donc ce qu'il PRODUIT que lorsque
 * le fournisseur est prêt. Avant, c'est un mode « déclaré », sans effet.
 */
function ModeSwitch({ mode, state }: { mode: 'demo' | 'production'; state: WalletState }) {
  const live = state === 'ready';
  const label = mode === 'demo' ? 'démo' : 'production';
  return (
    <div className={styles.mode} data-live={live ? 'true' : undefined}>
      <div className={styles.modeHead}>
        <span>{live ? 'Mode de l’émetteur' : 'Mode déclaré'}</span>
        <div
          className={styles.modeTrack}
          data-mode={mode}
          role="img"
          aria-label={live ? `Mode ${label}` : `Mode déclaré : ${label}, sans effet pour l’instant`}
        >
          <span className={styles.modeThumb} aria-hidden="true" />
          <span data-on={mode === 'demo' ? 'true' : undefined}>Démo</span>
          <span data-on={mode === 'production' ? 'true' : undefined}>Production</span>
        </div>
      </div>
      <p>
        {!live
          ? <>Lu dans <code>GOOGLE_WALLET_MODE</code>, sans effet pour l’instant : aucun bouton tant que Google Wallet n’est pas prêt.</>
          : mode === 'production'
            ? 'Le bouton est proposé à tous les clients Android.'
            : 'Bouton visible par les membres connectés de l’établissement et le super-admin ; seuls les comptes de test déclarés peuvent enregistrer le pass, marqué «\u00a0[TEST\u00a0ONLY]\u00a0».'}
      </p>
    </div>
  );
}
