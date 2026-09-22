import SwiftUI

/// Fin de passage.
///
/// Le professionnel a cliqué TERMINER : le client sort de la file, reçoit
/// un remerciement et se voit proposer l'avis Google DE CET établissement.
/// Le lien n'est révélé par le serveur qu'une fois la prestation
/// réellement terminée, et il est proposé à tout le monde — on ne filtre
/// pas sur la satisfaction supposée.
struct DoneScreen: View {

    @ObservedObject var model: QueueModel
    @ObservedObject var notifications: NotificationManager
    @State private var appeared = false

    private var reviewURL: URL? {
        // Pour un passage terminé affiché dans l'App Clip, on passe par
        // Rangvia avant Google afin de mesurer un clic unique par visite.
        if model.ticket?.location.googleReviewUrl != nil,
           let entryId = model.ticket?.entry.id {
            var components = URLComponents(
                url: Configuration.apiBaseURL.appendingPathComponent("api/client/review/click"),
                resolvingAgainstBaseURL: false
            )
            components?.queryItems = [
                URLQueryItem(name: "entry", value: entryId),
                URLQueryItem(name: "source", value: "appclip_done"),
            ]
            if let url = components?.url { return url }
        }
        return notifications.pendingReviewURL
    }

    var body: some View {
        VStack(spacing: VT.Space.x5) {
            Spacer()

            VStack(spacing: VT.Space.x4) {
                CheckMark()
                    .frame(width: 64, height: 64)
                    .scaleEffect(appeared ? 1 : 0.7)
                    .opacity(appeared ? 1 : 0)

                Text("Merci pour votre visite")
                    .font(VT.Type.display(30))
                    .foregroundStyle(VT.Color.text)
                    .multilineTextAlignment(.center)

                if let name = model.ticket?.location.name {
                    Text(name)
                        .font(VT.Type.body(16))
                        .foregroundStyle(VT.Color.textMuted)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, VT.Space.x9)
            .padding(.horizontal, VT.Space.x5)
            .background(
                RoundedRectangle(cornerRadius: VT.Radius.card, style: .continuous)
                    .fill(VT.Color.surfaceRaised)
                    .overlay(
                        RoundedRectangle(cornerRadius: VT.Radius.card, style: .continuous)
                            .stroke(VT.Color.line, lineWidth: 1)
                    )
            )

            Spacer()

            if let reviewURL {
                Link(destination: reviewURL) {
                    Text("Laisser un avis Google")
                        .font(VT.Type.strong(17))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 58)
                        .background(
                            VT.Color.signal,
                            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                        )
                        .shadow(color: VT.Color.signal.opacity(0.45), radius: 22, x: 0, y: 10)
                }
            }

            Button("Revenir plus tard") {
                notifications.pendingReviewURL = nil
                model.dismissCompleted()
            }
            .font(VT.Type.body(14))
            .foregroundStyle(VT.Color.textFaint)
            .frame(minHeight: 44)
        }
        .padding(VT.Space.x5)
        .onAppear {
            withAnimation(VT.Motion.slat) { appeared = true }
        }
    }
}

/// Coche dessinée dans la géométrie du produit.
private struct CheckMark: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(VT.Color.jade.opacity(0.28), lineWidth: 2)
            Path { path in
                path.move(to: CGPoint(x: 18, y: 33))
                path.addLine(to: CGPoint(x: 27, y: 42))
                path.addLine(to: CGPoint(x: 45, y: 23))
            }
            .stroke(VT.Color.jade, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
        }
    }
}
