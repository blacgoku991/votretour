import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';
import styles from './auth.module.css';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className={styles.screen}>
      {/* Le motif de lattes, très en retrait : on reconnaît le produit
          avant même d'avoir vu une file. */}
      <span className={styles.rails} aria-hidden="true" />
      <div className={styles.panel}>
        <Link href="/" className={styles.brand}>
          <Wordmark />
        </Link>
        {children}
      </div>
    </main>
  );
}
