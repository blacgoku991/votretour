import Foundation
import UserNotifications
import UIKit

/// Notifications côté iOS.
///
/// Règles Apple appliquées ici, vérifiées dans la documentation
/// « Enabling notifications in App Clips » :
///
///  1. Un App Clip qui déclare `NSAppClipRequestEphemeralUserNotification`
///     peut recevoir des notifications pendant 8 HEURES après CHAQUE
///     lancement, SANS afficher d'alerte de permission. L'autorisation
///     correspondante vaut `.ephemeral`.
///
///  2. L'utilisateur peut la refuser depuis la carte App Clip. On vérifie
///     donc systématiquement `authorizationStatus` avant de promettre
///     quoi que ce soit à l'écran.
///
///  3. L'application complète, elle, demande une autorisation classique :
///     sa valeur n'expire pas au bout de 8 heures.
@MainActor
public final class NotificationManager: NSObject, ObservableObject {

    public static let shared = NotificationManager()

    /// Jeton APNs de l'appareil, une fois l'enregistrement abouti.
    @Published public private(set) var deviceToken: String?
    /// Statut d'autorisation, tel que rapporté par le système.
    @Published public private(set) var authorization: UNAuthorizationStatus = .notDetermined
    /// Le serveur a-t-il confirmé qu'il pourra réellement pousser ?
    @Published public private(set) var pushConfirmed = false

    /// URL portée par la dernière notification ouverte (`target-content-id`).
    @Published public var pendingTargetURL: URL?
    /// Lien d'avis Google transporté par la notification de fin de visite.
    @Published public var pendingReviewURL: URL?
    /// Si l'utilisateur a explicitement touché l'action "Laisser un avis Google"
    /// dans la notification, l'App Clip ouvre ce lien dès qu'il est actif.
    @Published public var pendingAutoOpenReviewURL: URL?
    /// Laisser-passer Event / Drop à ouvrir après réveil sûr de l'App Clip.
    @Published public var pendingEventPassURL: URL?

    private var tokenContinuations: [CheckedContinuation<String?, Never>] = []

    private override init() { super.init() }

    /// Identifiants de catégorie, à faire correspondre côté serveur.
    public enum Category {
        public static let queueUpdate = "QUEUE_UPDATE"
        public static let visitCompleted = "VISIT_COMPLETED"
        public static let reviewAction = "LEAVE_REVIEW"
    }

    public func configure() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self

        // La notification de fin de visite porte un bouton d'action :
        // « Laisser un avis Google ». Le lien voyage dans la charge utile.
        let review = UNNotificationAction(
            identifier: Category.reviewAction,
            title: "Laisser un avis Google",
            options: [.foreground]
        )
        center.setNotificationCategories([
            UNNotificationCategory(
                identifier: Category.visitCompleted,
                actions: [review],
                intentIdentifiers: [],
                options: []
            ),
            UNNotificationCategory(
                identifier: Category.queueUpdate,
                actions: [],
                intentIdentifiers: [],
                options: []
            ),
        ])
    }

    /// Demande l'autorisation adaptée à la cible et enregistre l'appareil.
    /// - Returns: le jeton APNs, ou `nil` si l'enregistrement n'aboutit pas.
    public func requestAuthorizationAndToken() async -> String? {
        let center = UNUserNotificationCenter.current()

        if Configuration.isAppClip {
            // Une invocation physique (NFC / QR / App Clip Code) accorde
            // normalement l'autorisation éphémère 8 h via la carte App Clip.
            // Les invocations TestFlight ne sont pas des invocations physiques :
            // elles peuvent rester en .notDetermined. Dans ce seul cas on
            // demande une autorisation classique afin de pouvoir valider APNs
            // avant la mise en production. En production NFC, .ephemeral est
            // déjà présent et aucun pop-up n'est affiché.
            var settings = await center.notificationSettings()
            authorization = settings.authorizationStatus

            if settings.authorizationStatus == .notDetermined {
                do {
                    _ = try await center.requestAuthorization(options: [.alert, .sound, .badge])
                } catch {
                    return nil
                }
                settings = await center.notificationSettings()
                authorization = settings.authorizationStatus
            }

            guard settings.authorizationStatus == .ephemeral
                    || settings.authorizationStatus == .authorized
                    || settings.authorizationStatus == .provisional else {
                return nil
            }
        } else {
            do {
                _ = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            } catch {
                return nil
            }
            authorization = await center.notificationSettings().authorizationStatus
            guard authorization == .authorized || authorization == .provisional else { return nil }
        }

        return await registerForRemoteNotifications()
    }

    private func registerForRemoteNotifications() async -> String? {
        if let deviceToken { return deviceToken }
        UIApplication.shared.registerForRemoteNotifications()

        // L'enregistrement est asynchrone : on attend le rappel du
        // délégué, avec un délai de garde pour ne jamais bloquer l'écran.
        return await withCheckedContinuation { continuation in
            tokenContinuations.append(continuation)
            Task {
                try? await Task.sleep(nanoseconds: 6_000_000_000)
                self.resumeTokenWaiters(with: self.deviceToken)
            }
        }
    }

    public func didRegister(tokenData: Data) {
        let token = tokenData.map { String(format: "%02x", $0) }.joined()
        deviceToken = token
        resumeTokenWaiters(with: token)
    }

    public func didFailToRegister(error: Error) {
        resumeTokenWaiters(with: nil)
    }

    public func markPushConfirmed(_ value: Bool) {
        pushConfirmed = value
    }

    private func resumeTokenWaiters(with token: String?) {
        guard !tokenContinuations.isEmpty else { return }
        let waiters = tokenContinuations
        tokenContinuations = []
        for waiter in waiters { waiter.resume(returning: token) }
    }

    /// Statut lisible, envoyé au serveur pour dater l'expiration.
    public var authorizationLabel: String {
        switch authorization {
        case .ephemeral: return "ephemeral"
        case .authorized: return "authorized"
        case .provisional: return "provisional"
        case .denied: return "denied"
        default: return "not_determined"
        }
    }

    /// Phrase honnête à afficher au client, selon ce qui est réellement possible.
    public var statusSentence: String {
        switch authorization {
        case .ephemeral:
            return pushConfirmed
                ? "Vous serez prévenu quand ce sera votre tour, même en quittant l'App Clip."
                : "Gardez un œil sur cet écran : votre position se met à jour toute seule."
        case .authorized, .provisional:
            return pushConfirmed
                ? "Vous serez prévenu quand ce sera votre tour."
                : "Gardez un œil sur cet écran : votre position se met à jour toute seule."
        case .denied:
            return "Notifications refusées. Gardez cet écran ouvert pour suivre votre position."
        default:
            return "Gardez un œil sur cet écran : votre position se met à jour toute seule."
        }
    }
}

// MARK: - Réception

extension NotificationManager: UNUserNotificationCenterDelegate {

    /// Affiche la notification même si l'App Clip est au premier plan :
    /// « c'est votre tour » ne doit jamais passer inaperçu.
    public nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    public nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let content = response.notification.request.content
        let payload = content.userInfo["vt"] as? [String: Any]
        let reviewURL = (payload?["reviewUrl"] as? String).flatMap(URL.init(string:))
        let eventURL = (payload?["eventUrl"] as? String).flatMap(URL.init(string:))
        let kind = payload?["kind"] as? String
        // `target-content-id` porte l'URL d'invocation : c'est ce qui
        // garantit qu'une notification d'un commerce ouvre bien CE
        // commerce, et pas un autre déjà lancé sur le même téléphone.
        let targetURL = content.targetContentIdentifier.flatMap(URL.init(string:))
        let isReviewAction = response.actionIdentifier == Category.reviewAction

        await MainActor.run {
            // L'iPhone doit d'abord réveiller Rangvia/App Clip. Si le client
            // a touché le bouton d'action "Laisser un avis Google", RootView
            // ouvrira ensuite le lien suivi vers Google dès que la scène est
            // active. Un tap normal sur la notification affiche le prompt.
            self.pendingTargetURL = targetURL
            self.pendingReviewURL = reviewURL
            self.pendingAutoOpenReviewURL = isReviewAction ? reviewURL : nil
            self.pendingEventPassURL = kind == "event_access" ? eventURL : nil
        }
    }
}
