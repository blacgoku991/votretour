import UIKit

/// Retour haptique.
///
/// Uniquement là où il apporte quelque chose : au moment précis où la
/// file avance. C'est ce qui permet de sentir sa place bouger sans
/// regarder l'écran — l'équivalent tactile du volet qui tombe.
@MainActor
public enum Haptics {

    public static func advance(reachedTurn: Bool) {
        if reachedTurn {
            // « C'est votre tour » : deux impacts nets, impossibles à manquer.
            let generator = UINotificationFeedbackGenerator()
            generator.prepare()
            generator.notificationOccurred(.success)
        } else {
            let generator = UIImpactFeedbackGenerator(style: .rigid)
            generator.prepare()
            generator.impactOccurred(intensity: 0.8)
        }
    }

    public static func light() {
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
    }

    public static func success() {
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.success)
    }

    public static func warning() {
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.warning)
    }
}
