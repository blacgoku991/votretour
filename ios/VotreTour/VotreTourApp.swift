import SwiftUI

/// Application complète.
///
/// Apple impose que l'application sache traiter TOUTES les invocations
/// que l'App Clip traite : dès qu'elle est installée, elle le remplace et
/// reçoit à sa place chaque scan de plaque et chaque notification. Le
/// code d'expérience est donc strictement le même — c'est tout l'intérêt
/// de VotreTourKit.
@main
struct VotreTourApp: App {

    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var launchURL: URL?

    var body: some Scene {
        WindowGroup {
            RootView(initialURL: launchURL)
                .onAppear {
                    // Après installation depuis un App Clip, le ticket en
                    // cours est retrouvé via le groupe d'application
                    // partagé : le client ne perd pas sa place.
                    launchURL = SessionStore.shared.resume.invocationURL
                }
        }
    }
}
