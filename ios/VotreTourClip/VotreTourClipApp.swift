import SwiftUI

/// L'APP CLIP.
///
/// Un seul App Clip pour TOUS les établissements. Ce n'est pas une
/// variante par commerce : c'est l'URL d'invocation qui détermine où l'on
/// se trouve.
///
///     https://votre-domaine/e/barber-house    → Barber House
///     https://votre-domaine/e/garage-92       → Garage 92
///
/// Chaque commerce est déclaré comme « expérience App Clip avancée »
/// dans App Store Connect, et la même URL sert de `target-content-id`
/// dans les notifications : iOS route ainsi chaque push vers la bonne
/// instance, sans qu'un commerce puisse jamais notifier à la place d'un
/// autre.
@main
struct VotreTourClipApp: App {

    @UIApplicationDelegateAdaptor(ClipDelegate.self) private var clipDelegate

    var body: some Scene {
        WindowGroup {
            // Aucune URL au lancement : le système la remettra via
            // onContinueUserActivity. Si l'App Clip a été rouvert depuis
            // une notification, Apple ne fournit AUCUNE URL — RootView
            // repart alors de la dernière invocation mémorisée.
            RootView(initialURL: nil)
        }
    }
}
