import UIKit

/// Même rôle que dans l'application complète : recevoir le jeton APNs.
///
/// Particularité App Clip : avec la clé Info.plist
/// `NSAppClipRequestEphemeralUserNotification`, iOS accorde une
/// autorisation `.ephemeral` valable 8 heures après CHAQUE lancement,
/// sans afficher d'alerte. On peut donc enregistrer l'appareil dès le
/// démarrage, sans rien demander au client.
final class ClipDelegate: NSObject, UIApplicationDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        Task { @MainActor in NotificationManager.shared.configure() }
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in NotificationManager.shared.didRegister(tokenData: deviceToken) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in NotificationManager.shared.didFailToRegister(error: error) }
    }
}
