import forge from 'node-forge';

/**
 * Signature du manifest : CMS (PKCS#7) SignedData DÉTACHÉ, en DER.
 *
 *  - signataire : certificat Pass Type ID + clé privée RSA ;
 *  - certificats joints : le signataire ET l'intermédiaire WWDR (Wallet
 *    reconstruit la chaîne jusqu'à Apple Root CA avec eux) ;
 *  - attributs authentifiés : contentType = data, messageDigest (condensat
 *    du manifest), signingTime (Wallet l'exige) ;
 *  - détaché : le manifest n'est pas recopié dans la signature, il est à
 *    côté dans l'archive.
 *
 * node-forge sert UNIQUEMENT à fabriquer la structure et à signer
 * (createSignedData). Aucune vérification par forge : les tests vérifient
 * avec node:crypto et OpenSSL.
 *
 * Condensat du SignerInfo : SHA-256 (défaut d'OpenSSL, accepté en
 * pratique). Si la recette sur iPhone le refusait, la constante suffit à
 * repasser en SHA-1, comme passkit-generator [à vérifier en recette].
 */
export const SIGNER_DIGEST: 'sha256' | 'sha1' = 'sha256';

export interface PassSigner {
  certificate: forge.pki.Certificate;
  privateKey: forge.pki.rsa.PrivateKey;
  wwdr: forge.pki.Certificate;
}

export function signManifest(
  manifest: Buffer,
  signer: PassSigner,
  options: { signingTime?: Date; digest?: 'sha256' | 'sha1' } = {},
): Buffer {
  const digest = options.digest ?? SIGNER_DIGEST;
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifest.toString('binary'));
  p7.addCertificate(signer.certificate);
  p7.addCertificate(signer.wwdr);
  p7.addSigner({
    key: signer.privateKey,
    certificate: signer.certificate,
    digestAlgorithm: digest === 'sha1' ? forge.pki.oids.sha1! : forge.pki.oids.sha256!,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType!, value: forge.pki.oids.data },
      // Valeur calculée par forge à partir du contenu.
      { type: forge.pki.oids.messageDigest! },
      // forge accepte une date ISO et l'encode en UTCTime.
      { type: forge.pki.oids.signingTime!, value: (options.signingTime ?? new Date()).toISOString() },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
}
