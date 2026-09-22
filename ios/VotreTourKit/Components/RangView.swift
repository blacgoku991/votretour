import SwiftUI

/// LE RANG — la file, en natif.
///
/// Un rail vertical, une latte accrochée par personne. La latte du
/// client est deux fois plus haute et porte la couleur de signal.
/// Quand quelqu'un passe, la latte du haut se rétracte vers le rail et
/// tout le reste avance d'un cran.
///
/// Contrainte de confidentialité qui a façonné le composant : on ne sait
/// rien des autres personnes. On fabrique donc des jetons locaux stables,
/// uniquement pour que SwiftUI anime les bonnes lattes.
public struct RangView: View {

    private let ahead: Int
    private let selfLabel: String?
    private let selfHint: String?
    private let headIsServing: Bool
    private let accent: Color
    private let maxSlats: Int

    @State private var tokens: [UUID] = []
    @State private var pulse = false

    public init(
        ahead: Int,
        selfLabel: String? = nil,
        selfHint: String? = nil,
        headIsServing: Bool = false,
        accent: Color = VT.Color.signal,
        maxSlats: Int = 9
    ) {
        self.ahead = ahead
        self.selfLabel = selfLabel
        self.selfHint = selfHint
        self.headIsServing = headIsServing
        self.accent = accent
        self.maxSlats = maxSlats
    }

    private var visible: Int { min(max(ahead, 0), maxSlats) }
    private var overflow: Int { max(0, ahead - maxSlats) }

    public var body: some View {
        VStack(alignment: .leading, spacing: VT.Space.x2) {
            if overflow > 0 {
                Text("+ \(overflow) \(overflow == 1 ? "personne" : "personnes") plus haut dans la file")
                    .font(VT.Type.label(11))
                    .tracking(0.4)
                    .foregroundStyle(VT.Color.textFaint)
                    .padding(.leading, VT.Rang.notch)
            }

            ZStack(alignment: .topLeading) {
                // Le rail
                RoundedRectangle(cornerRadius: VT.Rang.railWidth)
                    .fill(VT.Color.rail)
                    .frame(width: VT.Rang.railWidth)
                    .padding(.vertical, 2)

                // Impulsion qui descend le rail quand la file avance
                if pulse {
                    RailPulse(accent: accent)
                }

                VStack(spacing: VT.Rang.gap) {
                    ForEach(Array(tokens.enumerated()), id: \.element) { index, token in
                        SlatView(
                            isHead: index == 0,
                            headIsServing: headIsServing,
                            accent: accent
                        )
                        .transition(.asymmetric(
                            insertion: .scale(scale: 0.02, anchor: .leading).combined(with: .opacity),
                            removal: .scale(scale: 0.02, anchor: .leading).combined(with: .opacity)
                        ))
                    }

                    SelfSlatView(label: selfLabel, hint: selfHint, accent: accent)
                }
                .padding(.leading, VT.Rang.notch)
            }
        }
        .onAppear { syncTokens(animated: false) }
        .onChange(of: ahead) { _ in
            syncTokens(animated: true)
        }
    }

    private func syncTokens(animated: Bool) {
        let target = visible
        guard tokens.count != target else { return }

        let apply = {
            if target > tokens.count {
                tokens.append(contentsOf: (0..<(target - tokens.count)).map { _ in UUID() })
            } else {
                // La file avance : ce sont les lattes DU HAUT qui partent,
                // celles des personnes qui viennent d'être servies.
                tokens.removeFirst(tokens.count - target)
            }
        }

        if animated {
            withAnimation(VT.Motion.slat) { apply() }
            pulse = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { pulse = false }
        } else {
            apply()
        }
    }
}

// MARK: - Latte anonyme

private struct SlatView: View {
    let isHead: Bool
    let headIsServing: Bool
    let accent: Color

    private var background: Color {
        guard isHead else { return VT.Color.slat }
        return headIsServing
            ? VT.Color.slat.mix(with: VT.Color.text, amount: 0.12)
            : VT.Color.slat.mix(with: VT.Color.text, amount: 0.07)
    }

    var body: some View {
        ZStack(alignment: .leading) {
            // L'encoche : le trait qui relie la latte au rail.
            NotchView(color: isHead && headIsServing ? accent : VT.Color.rail,
                      thickness: isHead && headIsServing ? 3 : 2)

            RoundedRectangle(cornerRadius: VT.Radius.slat, style: .continuous)
                .fill(background)
                .frame(height: VT.Rang.slatHeight)
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(isHead ? accent.opacity(0.9) : VT.Color.textMuted.opacity(0.35))
                        .frame(width: 18, height: 2)
                        .padding(.leading, VT.Space.x4)
                }
        }
    }
}

// MARK: - La latte du client

private struct SelfSlatView: View {
    let label: String?
    let hint: String?
    let accent: Color

    var body: some View {
        ZStack(alignment: .leading) {
            NotchView(color: accent, thickness: 4)

            RoundedRectangle(cornerRadius: VT.Radius.slat, style: .continuous)
                .fill(accent)
                .frame(height: VT.Rang.slatHeight * 2.1)
                .shadow(color: accent.opacity(0.42), radius: 18, x: 0, y: 8)
                .overlay(alignment: .leading) {
                    HStack(spacing: VT.Space.x3) {
                        Circle()
                            .fill(.white)
                            .frame(width: 8, height: 8)
                            .overlay(Circle().stroke(.white.opacity(0.35), lineWidth: 4))

                        VStack(alignment: .leading, spacing: 1) {
                            Text(label?.isEmpty == false ? label! : "Vous")
                                .font(VT.Type.strong(15))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                            if let hint {
                                Text(hint.uppercased())
                                    .font(VT.Type.label(10))
                                    .tracking(1.4)
                                    .foregroundStyle(.white.opacity(0.8))
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, VT.Space.x4)
                }
        }
    }
}

/// Le trait qui relie le rail à la latte : la forme signature.
private struct NotchView: View {
    let color: Color
    let thickness: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: thickness / 2)
            .fill(color)
            .frame(width: VT.Rang.notch, height: thickness)
            .offset(x: -VT.Rang.notch)
    }
}

/// Impulsion lumineuse qui descend le long du rail.
private struct RailPulse: View {
    let accent: Color
    @State private var offset: CGFloat = -60

    var body: some View {
        GeometryReader { proxy in
            RoundedRectangle(cornerRadius: 3)
                .fill(LinearGradient(
                    colors: [.clear, accent, accent, .clear],
                    startPoint: .top, endPoint: .bottom
                ))
                .frame(width: VT.Rang.railWidth * 3, height: 56)
                .offset(x: -VT.Rang.railWidth, y: offset)
                .onAppear {
                    withAnimation(.easeInOut(duration: 0.62)) {
                        offset = proxy.size.height
                    }
                }
        }
        .allowsHitTesting(false)
    }
}

extension Color {
    /// Mélange simple, pour éclaircir une latte sans virer au brun.
    func mix(with other: Color, amount: Double) -> Color {
        let clamped = min(max(amount, 0), 1)
        return Color(
            .sRGB,
            red: components.r * (1 - clamped) + other.components.r * clamped,
            green: components.g * (1 - clamped) + other.components.g * clamped,
            blue: components.b * (1 - clamped) + other.components.b * clamped,
            opacity: 1
        )
    }

    private var components: (r: Double, g: Double, b: Double) {
        #if canImport(UIKit)
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        UIColor(self).getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        return (Double(red), Double(green), Double(blue))
        #else
        return (0, 0, 0)
        #endif
    }
}
