import SwiftUI

/// Le système de design « Le Rang », porté sur iOS.
///
/// Mêmes jetons que le web, mêmes couleurs, même géométrie. La seule
/// différence assumée est la typographie : le web utilise Archivo et ses
/// axes de graisse et de chasse ; iOS utilise SF Pro, dont l'axe de
/// chasse (`Font.width`) joue exactement le même rôle depuis iOS 16.
/// Embarquer une police dans un App Clip coûterait du poids là où Apple
/// en plafonne strictement la taille, pour un gain nul en lisibilité.
public enum VT {

    // MARK: - Couleurs

    public enum Color {
        // Encre — jamais de noir pur.
        public static let ink1000 = SwiftUI.Color(hex: 0x05070A)
        public static let ink900  = SwiftUI.Color(hex: 0x0B0E13)
        public static let ink800  = SwiftUI.Color(hex: 0x11151B)
        public static let ink700  = SwiftUI.Color(hex: 0x181D25)
        public static let ink600  = SwiftUI.Color(hex: 0x222833)

        // Os
        public static let bone100 = SwiftUI.Color(hex: 0xFAF9F6)

        // Signal — le vermillon du « maintenant ».
        public static let signal      = SwiftUI.Color(hex: 0xFF4B1F)
        public static let signalLight = SwiftUI.Color(hex: 0xFF6B45)

        public static let jade   = SwiftUI.Color(hex: 0x1FA97A)
        public static let copper = SwiftUI.Color(hex: 0xD9903A)
        public static let brique = SwiftUI.Color(hex: 0xA8453C)
        public static let cobalt = SwiftUI.Color(hex: 0x3A63D8)

        // Rôles (l'expérience client est en thème sombre : un objet
        // dans la main, pas une page web).
        public static let surface       = ink900
        public static let surfaceRaised = ink800
        public static let surfaceSunken = ink1000
        public static let slat          = ink600
        public static let text          = bone100
        public static let textMuted     = SwiftUI.Color(hex: 0x9AA3AF)
        public static let textFaint     = SwiftUI.Color(hex: 0x69737F)
        public static let line          = SwiftUI.Color.white.opacity(0.10)
        public static let lineStrong    = SwiftUI.Color.white.opacity(0.20)
        public static let rail          = SwiftUI.Color.white.opacity(0.26)

        /// Teinte d'accent par professionnel ou par marque.
        public static func accent(_ name: String) -> SwiftUI.Color {
            switch name {
            case "copper": return copper
            case "jade": return jade
            case "cobalt": return cobalt
            case "brique": return brique
            case "ardoise": return SwiftUI.Color(hex: 0x5A6675)
            default: return signal
            }
        }
    }

    // MARK: - Rythme

    public enum Space {
        public static let x1: CGFloat = 4
        public static let x2: CGFloat = 8
        public static let x3: CGFloat = 12
        public static let x4: CGFloat = 16
        public static let x5: CGFloat = 20
        public static let x6: CGFloat = 24
        public static let x7: CGFloat = 32
        public static let x8: CGFloat = 40
        public static let x9: CGFloat = 56
    }

    public enum Radius {
        public static let slat: CGFloat = 10
        public static let card: CGFloat = 18
        public static let field: CGFloat = 12
        public static let pill: CGFloat = 999
    }

    /// Géométrie de la file : un « cran » vaut une latte plus son écart.
    public enum Rang {
        public static let slatHeight: CGFloat = 34
        public static let gap: CGFloat = 8
        public static let railWidth: CGFloat = 2
        public static let notch: CGFloat = 20
        public static var step: CGFloat { slatHeight + gap }
    }

    // MARK: - Typographie

    public enum Type {
        /// Grand chiffre de position : très large, très gras. On le lit
        /// à bout de bras, dans un salon bruyant.
        public static func flap(_ size: CGFloat) -> Font {
            .system(size: size, weight: .heavy, design: .default).width(.expanded)
        }

        public static func display(_ size: CGFloat) -> Font {
            .system(size: size, weight: .bold, design: .default).width(.expanded)
        }

        public static func title(_ size: CGFloat = 22) -> Font {
            .system(size: size, weight: .bold).width(.standard)
        }

        public static func body(_ size: CGFloat = 16) -> Font {
            .system(size: size, weight: .regular)
        }

        public static func strong(_ size: CGFloat = 16) -> Font {
            .system(size: size, weight: .semibold)
        }

        /// Étiquette de signalétique : petite, très espacée, en capitales.
        public static func label(_ size: CGFloat = 11) -> Font {
            .system(size: size, weight: .bold).width(.condensed)
        }
    }

    public enum Motion {
        /// Courbe signature : décidée, sans rebond mou.
        public static let slat = SwiftUI.Animation.timingCurve(0.22, 0.92, 0.20, 1, duration: 0.62)
        public static let quick = SwiftUI.Animation.timingCurve(0.16, 1, 0.3, 1, duration: 0.24)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

// MARK: - Éléments réutilisables

/// Étiquette en capitales espacées, l'accent typographique du produit.
public struct VTLabel: View {
    private let text: String
    private let color: Color

    public init(_ text: String, color: Color = VT.Color.textMuted) {
        self.text = text
        self.color = color
    }

    public var body: some View {
        Text(text.uppercased())
            .font(VT.Type.label())
            .tracking(1.8)
            .foregroundStyle(color)
    }
}

/// Bouton principal : large, épais, à portée de pouce.
public struct VTPrimaryButton: View {
    private let title: String
    private let isLoading: Bool
    private let action: () -> Void

    public init(_ title: String, isLoading: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.isLoading = isLoading
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            ZStack {
                Text(isLoading ? "Un instant…" : title)
                    .font(VT.Type.strong(17))
                    .foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity, minHeight: 58)
            .background(VT.Color.signal, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: VT.Color.signal.opacity(0.45), radius: 22, x: 0, y: 10)
        }
        .buttonStyle(PressableStyle())
        .disabled(isLoading)
    }
}

public struct VTSecondaryButton: View {
    private let title: String
    private let role: ButtonRole?
    private let action: () -> Void

    public init(_ title: String, role: ButtonRole? = nil, action: @escaping () -> Void) {
        self.title = title
        self.role = role
        self.action = action
    }

    public var body: some View {
        Button(role: role, action: action) {
            Text(title)
                .font(VT.Type.strong(15))
                .foregroundStyle(role == .destructive ? VT.Color.brique : VT.Color.text)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(
                    RoundedRectangle(cornerRadius: VT.Radius.field, style: .continuous)
                        .stroke(role == .destructive
                                ? VT.Color.brique.opacity(0.4)
                                : VT.Color.lineStrong, lineWidth: 1)
                )
        }
        .buttonStyle(PressableStyle())
    }
}

public struct PressableStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.975 : 1)
            .animation(VT.Motion.quick, value: configuration.isPressed)
    }
}

/// Point d'état : file ouverte, connexion temps réel.
public struct VTPip: View {
    public enum Kind { case live, warn, off }
    private let kind: Kind
    @State private var pulse = false

    public init(_ kind: Kind) { self.kind = kind }

    private var color: Color {
        switch kind {
        case .live: return VT.Color.jade
        case .warn: return VT.Color.copper
        case .off: return VT.Color.textFaint
        }
    }

    public var body: some View {
        Circle()
            .fill(color)
            .frame(width: 7, height: 7)
            .overlay(
                Circle()
                    .stroke(color.opacity(pulse ? 0 : 0.55), lineWidth: pulse ? 6 : 0)
                    .scaleEffect(pulse ? 2.2 : 1)
            )
            .onAppear {
                guard kind == .live else { return }
                withAnimation(.easeOut(duration: 2.2).repeatForever(autoreverses: false)) {
                    pulse = true
                }
            }
    }
}
