import SwiftUI

/// LE VOLET — le compteur signature, en version native.
///
/// Le chiffre ne se remplace pas : il tombe, comme la lamelle d'un
/// tableau d'affichage de gare. C'est le geste qui fait comprendre, sans
/// un mot, que la place vient d'avancer.
public struct FlapNumberView: View {

    private let value: Int
    private let size: CGFloat

    public init(value: Int, size: CGFloat = 108) {
        self.value = max(0, value)
        self.size = size
    }

    private var digits: [(index: Int, character: String)] {
        Array(String(value)).enumerated().map { ($0.offset, String($0.element)) }
    }

    public var body: some View {
        HStack(spacing: -size * 0.03) {
            ForEach(digits, id: \.index) { digit in
                FlapDigit(character: digit.character, size: size)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(value)"))
    }
}

private struct FlapDigit: View {
    let character: String
    let size: CGFloat

    var body: some View {
        Text(character)
            .font(VT.Type.flap(size))
            .monospacedDigit()
            .foregroundStyle(VT.Color.text)
            .frame(height: size * 1.02)
            .fixedSize()
            // La transition asymétrique donne la sensation mécanique :
            // l'ancien chiffre sort par le haut, le nouveau entre par le bas.
            .transition(.asymmetric(
                insertion: .move(edge: .bottom).combined(with: .opacity),
                removal: .move(edge: .top).combined(with: .opacity)
            ))
            .id(character)
            .clipped()
            .animation(VT.Motion.slat, value: character)
    }
}
