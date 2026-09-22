/**
 * Types de l'API Web NFC.
 *
 * TypeScript ne les fournit pas : Web NFC n'est pas dans lib.dom, faute
 * d'être implémentée par tous les navigateurs. On les déclare donc ici,
 * d'après la spécification W3C Web NFC et la documentation MDN de
 * NDEFReader.
 *
 * Disponibilité réelle, vérifiée en septembre 2026 : Chrome pour Android
 * (depuis la 89), Edge, Opera Mobile (64+) et Samsung Internet (15+).
 * Aucun navigateur de bureau. Aucun navigateur sur iOS ou iPadOS —
 * WebKit n'implémente pas Web NFC, et ce n'est pas contournable : sur
 * iPhone, l'écriture d'un tag passe forcément par une application native.
 */

type NDEFRecordType =
  | 'absolute-url'
  | 'empty'
  | 'mime'
  | 'smart-poster'
  | 'text'
  | 'unknown'
  | 'url';

interface NDEFRecordInit {
  recordType: NDEFRecordType;
  data?: string | BufferSource;
  encoding?: string;
  id?: string;
  lang?: string;
  mediaType?: string;
}

interface NDEFMessageInit {
  records: NDEFRecordInit[];
}

interface NDEFRecord {
  readonly recordType: NDEFRecordType;
  readonly mediaType: string | null;
  readonly id: string | null;
  readonly encoding: string | null;
  readonly lang: string | null;
  readonly data: DataView | null;
  toRecords?(): NDEFRecord[];
}

interface NDEFMessage {
  readonly records: readonly NDEFRecord[];
}

interface NDEFReadingEvent extends Event {
  readonly serialNumber: string;
  readonly message: NDEFMessage;
}

interface NDEFWriteOptions {
  /** Remplacer les enregistrements déjà présents sur le tag. */
  overwrite?: boolean;
  signal?: AbortSignal;
}

interface NDEFScanOptions {
  signal?: AbortSignal;
}

interface NDEFMakeReadOnlyOptions {
  signal?: AbortSignal;
}

declare class NDEFReader extends EventTarget {
  constructor();
  onreading: ((this: NDEFReader, event: NDEFReadingEvent) => unknown) | null;
  onreadingerror: ((this: NDEFReader, event: Event) => unknown) | null;
  scan(options?: NDEFScanOptions): Promise<void>;
  write(
    message: string | BufferSource | NDEFMessageInit,
    options?: NDEFWriteOptions,
  ): Promise<void>;
  /** Passe le tag en lecture seule. DÉFINITIF. */
  makeReadOnly(options?: NDEFMakeReadOnlyOptions): Promise<void>;
  addEventListener(
    type: 'reading',
    listener: (event: NDEFReadingEvent) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: 'readingerror',
    listener: (event: Event) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

interface Window {
  NDEFReader?: typeof NDEFReader;
}
