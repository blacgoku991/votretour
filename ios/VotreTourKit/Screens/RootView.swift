import SwiftUI

/// Racine partagée par l'App Clip et l'application complète.
///
/// Le même code sert les deux cibles : Apple exige que l'application
/// complète sache traiter TOUTES les invocations que l'App Clip traite,
/// puisqu'elle le remplace dès qu'elle est installée.
public struct RootView: View {

    @StateObject private var model = QueueModel()
    // Singleton partagé avec le délégué d'application : c'est lui qui
    // reçoit le jeton APNs. @ObservedObject, pas @StateObject — la vue
    // observe un objet qu'elle ne possède pas.
    @ObservedObject private var notifications = NotificationManager.shared
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL

    /// URL d'invocation initiale, si elle est déjà connue au lancement.
    private let initialURL: URL?

    public init(initialURL: URL? = nil) {
        self.initialURL = initialURL
    }

    public var body: some View {
        ZStack {
            VT.Color.surface.ignoresSafeArea()

            content
                .frame(maxWidth: 460)
                .frame(maxWidth: .infinity)
        }
        .preferredColorScheme(.dark)
        .tint(VT.Color.signal)
        .task { await model.start(url: initialURL) }
        // Invocation reçue après le lancement (NFC, QR, lien Messages).
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            Task { await model.start(url: activity.webpageURL) }
        }
        .onOpenURL { url in
            Task { await model.start(url: url) }
        }
        // Notification ouverte : l'App Clip démarre sans URL d'invocation,
        // c'est le target-content-id qui indique le bon commerce.
        .onChange(of: notifications.pendingTargetURL) { url in
            guard let url else { return }
            Task {
                await model.start(url: url)
                notifications.pendingTargetURL = nil
            }
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else { return }
            Task {
                await model.refresh()
                await openPendingReviewIfNeeded()
            }
        }
        .onChange(of: notifications.pendingAutoOpenReviewURL) { _ in
            Task { await openPendingReviewIfNeeded() }
        }
        .sheet(
            isPresented: Binding(
                get: {
                    notifications.pendingReviewURL != nil
                    && notifications.pendingAutoOpenReviewURL == nil
                    && model.phase != .done
                },
                set: { presented in
                    if !presented { notifications.pendingReviewURL = nil }
                }
            )
        ) {
            if let reviewURL = notifications.pendingReviewURL {
                ReviewPromptView(url: reviewURL)
            }
        }
    }

    @MainActor
    private func openPendingReviewIfNeeded() async {
        guard scenePhase == .active,
              let url = notifications.pendingAutoOpenReviewURL else { return }

        // Laisser le temps à l'App Clip de terminer son réveil avant
        // d'ouvrir Safari/Google Maps. Cela évite la fermeture brutale
        // observée sous TestFlight.
        try? await Task.sleep(nanoseconds: 350_000_000)
        openURL(url)
        notifications.pendingAutoOpenReviewURL = nil
        notifications.pendingReviewURL = nil
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            LoadingScreen()
        case .join:
            JoinScreen(model: model)
        case .queued, .turn:
            QueueScreen(model: model, notifications: notifications)
        case .done:
            DoneScreen(model: model, notifications: notifications)
        case .closed:
            ClosedScreen(model: model)
        case .unavailable(let message):
            UnavailableScreen(message: message)
        }
    }
}

// MARK: - Écrans d'attente et d'erreur

struct LoadingScreen: View {
    @State private var phase = 0

    var body: some View {
        VStack(spacing: VT.Space.x4) {
            // Trois lattes qui pulsent : on reconnaît le produit avant
            // même d'avoir vu la file.
            VStack(alignment: .leading, spacing: VT.Rang.gap) {
                ForEach(0..<3, id: \.self) { index in
                    RoundedRectangle(cornerRadius: VT.Radius.slat, style: .continuous)
                        .fill(VT.Color.slat)
                        .frame(width: CGFloat(150 - index * 34), height: VT.Rang.slatHeight)
                        .opacity(phase == index ? 1 : 0.4)
                }
            }
            Text("Un instant…")
                .font(VT.Type.label())
                .tracking(1.8)
                .foregroundStyle(VT.Color.textFaint)
        }
        .onAppear {
            Timer.scheduledTimer(withTimeInterval: 0.42, repeats: true) { _ in
                withAnimation(VT.Motion.quick) { phase = (phase + 1) % 3 }
            }
        }
    }
}

struct UnavailableScreen: View {
    let message: String

    var body: some View {
        VStack(spacing: VT.Space.x3) {
            VTLabel("Indisponible")
            Text(message)
                .font(VT.Type.title(20))
                .foregroundStyle(VT.Color.text)
                .multilineTextAlignment(.center)
        }
        .padding(VT.Space.x6)
    }
}

private struct ReviewPromptView: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: VT.Space.x5) {
            Spacer()

            Text("Merci pour votre visite")
                .font(VT.Type.display(28))
                .foregroundStyle(VT.Color.text)
                .multilineTextAlignment(.center)

            Text("Votre avis aide énormément l'établissement.")
                .font(VT.Type.body(16))
                .foregroundStyle(VT.Color.textMuted)
                .multilineTextAlignment(.center)

            Spacer()

            Link(destination: url) {
                Text("Laisser un avis Google")
                    .font(VT.Type.strong(17))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 58)
                    .background(
                        VT.Color.signal,
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                    )
            }

            Button("Plus tard") {
                NotificationManager.shared.pendingReviewURL = nil
                dismiss()
            }
            .font(VT.Type.body(14))
            .foregroundStyle(VT.Color.textFaint)
            .frame(minHeight: 44)
        }
        .padding(VT.Space.x5)
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
        .preferredColorScheme(.dark)
    }
}

struct ClosedScreen: View {
    @ObservedObject var model: QueueModel

    private var message: String {
        switch model.ticket?.entry.status {
        case .absent:
            return "Vous avez été noté absent. Présentez-vous au comptoir pour reprendre votre place."
        case .skipped:
            return "Vous avez été retiré de la file par le professionnel."
        case .expired:
            return "Votre place a expiré."
        default:
            return "Vous avez quitté la file."
        }
    }

    var body: some View {
        VStack(spacing: VT.Space.x5) {
            Spacer()
            Text(message)
                .font(VT.Type.title(22))
                .foregroundStyle(VT.Color.text)
                .multilineTextAlignment(.center)
            if let name = model.ticket?.location.name {
                Text(name)
                    .font(VT.Type.body())
                    .foregroundStyle(VT.Color.textMuted)
            }
            Spacer()
            VTPrimaryButton("Rejoindre à nouveau") {
                Task { await model.refresh() }
            }
        }
        .padding(VT.Space.x5)
    }
}
