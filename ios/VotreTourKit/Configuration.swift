import Foundation

/// Configuration injectée depuis le `.xcconfig` via l'Info.plist.
///
/// Rien n'est codé en dur dans les sources : le domaine, l'URL de l'API
/// et le groupe d'application sont des réglages de build, ce qui permet
/// de viser un environnement de recette sans toucher au code.
public enum Configuration {

    /// Base de l'API — aussi le domaine associé (Associated Domains).
    public static let apiBaseURL: URL = {
        let value = info(for: "VTAPIBaseURL") ?? "https://votretour.app"
        return URL(string: value) ?? URL(string: "https://votretour.app")!
    }()

    /// Domaine déclaré dans les entitlements `applinks:` et `appclips:`.
    public static let associatedDomain: String = info(for: "VTAssociatedDomain") ?? "votretour.app"

    /// Groupe d'application partagé App Clip ↔ application complète.
    /// C'est lui qui permet, après installation de l'application, de
    /// retrouver le ticket ouvert depuis l'App Clip.
    public static let appGroup: String? = info(for: "VTAppGroup")

    /// Environnement APNs de la build courante.
    public static let apnsEnvironment: String = info(for: "VTAPNSEnvironment") ?? "development"

    public static let bundleIdentifier: String = Bundle.main.bundleIdentifier ?? "app.votretour.ios"

    /// Vrai lorsque le binaire courant est l'App Clip.
    public static let isAppClip: Bool = {
        #if APP_CLIP
        return true
        #else
        return Bundle.main.infoDictionary?["NSAppClip"] != nil
        #endif
    }()

    private static func info(for key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              !value.isEmpty, !value.hasPrefix("$(") else { return nil }
        return value
    }
}
