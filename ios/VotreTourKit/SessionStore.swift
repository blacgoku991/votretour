import Foundation
import Security

/// Mémoire locale de l'appareil.
///
/// Deux niveaux, pour deux besoins différents :
///
///  • le JETON de session vit dans le trousseau, dans un groupe d'accès
///    partagé entre l'App Clip et l'application complète. C'est un
///    porteur d'identité : il n'a rien à faire dans les préférences.
///
///  • l'ÉTAT de reprise (dernière URL d'invocation, identifiant de
///    ticket, organisation) vit dans le conteneur de groupe. Apple
///    prévient qu'un App Clip relancé DEPUIS UNE NOTIFICATION démarre
///    SANS URL d'invocation : sans cet état, l'écran serait vide au
///    moment précis où le client a besoin de savoir que c'est son tour.
public final class SessionStore: @unchecked Sendable {

    public static let shared = SessionStore()

    private let defaults: UserDefaults
    private let keychainService = "app.votretour.session"
    private let accessGroup: String?

    private init() {
        if let group = Configuration.appGroup, let shared = UserDefaults(suiteName: group) {
            self.defaults = shared
        } else {
            self.defaults = .standard
        }
        // Le groupe d'accès trousseau est préfixé par l'identifiant
        // d'équipe ; il est déclaré dans les deux fichiers .entitlements.
        self.accessGroup = Bundle.main.object(forInfoDictionaryKey: "VTKeychainGroup") as? String
    }

    // MARK: - Jeton de session (trousseau)

    /// Le jeton est cloisonné par organisation : un même téléphone chez
    /// deux commerces détient deux jetons indépendants.
    public func token(organizationId: String) -> String? {
        var query = baseQuery(account: organizationId)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        var status = SecItemCopyMatching(query as CFDictionary, &item)

        // Sans l'entitlement de groupe partagé, on retente en local.
        if status == errSecMissingEntitlement || status == errSecNoAccessForItem {
            var fallback = baseQuery(account: organizationId, ignoreAccessGroup: true)
            fallback[kSecReturnData as String] = true
            fallback[kSecMatchLimit as String] = kSecMatchLimitOne
            status = SecItemCopyMatching(fallback as CFDictionary, &item)
        }

        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func setToken(_ token: String, organizationId: String) {
        let data = Data(token.utf8)
        var query = baseQuery(account: organizationId)
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        var status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecMissingEntitlement || status == errSecNoAccessForItem {
            var fallback = baseQuery(account: organizationId, ignoreAccessGroup: true)
            SecItemDelete(fallback as CFDictionary)
            fallback[kSecValueData as String] = data
            fallback[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            status = SecItemAdd(fallback as CFDictionary, nil)
        }
        if status != errSecSuccess {
            // Le trousseau peut refuser (appareil verrouillé). On ne perd
            // pas la session pour autant : elle vaut pour ce lancement.
            setVolatileToken(token, for: organizationId)
        }
    }

    public func clearToken(organizationId: String) {
        SecItemDelete(baseQuery(account: organizationId) as CFDictionary)
        SecItemDelete(baseQuery(account: organizationId, ignoreAccessGroup: true) as CFDictionary)
        setVolatileToken(nil, for: organizationId)
    }

    // Repli en mémoire lorsque le trousseau refuse (appareil verrouillé
    // juste après un scan NFC, par exemple). Protégé : l'écriture vient
    // du fil principal, la lecture peut venir d'une tâche réseau.
    private let lock = NSLock()
    private var _volatileTokens: [String: String] = [:]
    private func volatileToken(_ organizationId: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        return _volatileTokens[organizationId]
    }

    private func setVolatileToken(_ token: String?, for organizationId: String) {
        lock.lock(); defer { lock.unlock() }
        _volatileTokens[organizationId] = token
    }

    /// Jeton effectif : trousseau, puis repli mémoire.
    public func effectiveToken(organizationId: String) -> String? {
        token(organizationId: organizationId) ?? volatileToken(organizationId)
    }

    private func baseQuery(account: String, ignoreAccessGroup: Bool = false) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
        ]
        if !ignoreAccessGroup, let accessGroup, !accessGroup.isEmpty {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        return query
    }

    // MARK: - État de reprise (groupe d'application)

    private enum Key {
        static let invocationURL = "vt.lastInvocationURL"
        static let organizationId = "vt.lastOrganizationId"
        static let locationId = "vt.lastLocationId"
        static let entryId = "vt.lastEntryId"
        static let slug = "vt.lastSlug"
        static let clientName = "vt.clientName"
    }

    public struct Resume: Equatable, Sendable {
        public let invocationURL: URL?
        public let organizationId: String?
        public let locationId: String?
        public let entryId: String?
        public let slug: String?
    }

    public var resume: Resume {
        Resume(
            invocationURL: defaults.string(forKey: Key.invocationURL).flatMap(URL.init(string:)),
            organizationId: defaults.string(forKey: Key.organizationId),
            locationId: defaults.string(forKey: Key.locationId),
            entryId: defaults.string(forKey: Key.entryId),
            slug: defaults.string(forKey: Key.slug)
        )
    }

    public func rememberInvocation(url: URL, slug: String) {
        defaults.set(url.absoluteString, forKey: Key.invocationURL)
        defaults.set(slug, forKey: Key.slug)
    }

    public func rememberContext(organizationId: String, locationId: String?) {
        defaults.set(organizationId, forKey: Key.organizationId)
        if let locationId { defaults.set(locationId, forKey: Key.locationId) }
    }

    public func rememberEntry(_ entryId: String?) {
        if let entryId { defaults.set(entryId, forKey: Key.entryId) }
        else { defaults.removeObject(forKey: Key.entryId) }
    }

    /// Le prénom est réutilisé d'une visite à l'autre : on ne le redemande
    /// pas à un habitué.
    public var clientName: String? {
        get { defaults.string(forKey: Key.clientName) }
        set {
            if let newValue, !newValue.isEmpty { defaults.set(newValue, forKey: Key.clientName) }
            else { defaults.removeObject(forKey: Key.clientName) }
        }
    }
}
